import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readLocalLlmConfig, type LocalLlmConfig } from '../config.js';
import { EnrichmentStore, InteractionStore, LocalLlmAnalyzer, type LlmInteraction, type LlmValidationStatus } from '../local-llm/index.js';
import { getModelInfo } from '../local-llm/client.js';
import { buildSyntheticScenarios } from '../llm-benchmark/runner.js';
import type { ScenarioName } from '../llm-benchmark/types.js';
import { DeterministicBriefRenderer } from './renderer.js';
import { GOLDEN_SCENARIOS, GOLDEN_SET_VERSION, type BlindMapping, type QualityEvaluationRun, type QualityInteraction, type QualityReview } from './types.js';

export type QualityRunOptions = { runtimeDir: string; config: LocalLlmConfig; reviewSeed?: number; repeats?: number; now?: () => Date; fetchImpl?: typeof fetch; gitSha?: string };
const defaults = { reviewSeed: 42, repeats: 2 } as const;
const expectedClass: Readonly<Record<ScenarioName, string>> = { DATABASE_FAILURE: 'DATABASE_FAILURE', DATABASE_SLOW: 'DATABASE_SLOW', APPLICATION_ERROR: 'APPLICATION_ERROR', AUTH_FAILURE: 'AUTH_FAILURE', AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED', REALTIME_AUTH_FAILURE: 'REALTIME_AUTH_FAILURE', TELEMETRY_FAILURE: 'TELEMETRY_FAILURE', UNKNOWN: 'UNKNOWN', SOURCE_FAILURE: 'UNKNOWN', TRUNCATED_CONTEXT: 'UNKNOWN', MULTIPLE_TENANTS: 'UNKNOWN', MULTIPLE_RELEASES: 'UNKNOWN' };

export async function runQualityEvaluation(options: QualityRunOptions): Promise<{ run: QualityEvaluationRun; directory: string; interactions: QualityInteraction[] }> {
  if (!options.config.enabled) throw new Error('SUPPORT_ANALYST_LLM_ENABLED=true is required for the quality run.');
  if (options.config.model !== 'gemma4:12b') throw new Error('SA-08 only permits the frozen model gemma4:12b.');
  const reviewSeed = options.reviewSeed ?? defaults.reviewSeed; const repeats = options.repeats ?? defaults.repeats;
  if (repeats !== 2) throw new Error('SA-08 requires exactly two inferences per golden scenario.');
  const scenarios = buildGoldenSet(); const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const runId = `quality-${timestamp.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`; const directory = join(options.runtimeDir, 'quality', runId);
  await mkdir(directory, { recursive: true });
  const model = await getModelInfo(options.config.endpoint, options.config.model, options.fetchImpl).catch(() => undefined);
  const run: QualityEvaluationRun = { schemaVersion: 1, runId, timestamp, ...(options.gitSha ? { gitSha: options.gitSha } : {}), model: options.config.model, ...(model?.digest ? { digest: model.digest } : {}), ...(model?.quantization ? { quantization: model.quantization } : {}), promptVersion: 'prompt-v1', settings: { numCtx: options.config.numCtx, temperature: 0.1, seed: 42, numPredict: 800, timeoutMs: options.config.timeoutMs, think: false, keepAlive: options.config.keepAlive }, goldenSetVersion: GOLDEN_SET_VERSION, scenarioCount: scenarios.length, repeats, reviewSeed, status: 'TECHNICAL_RUN_COMPLETE_HUMAN_REVIEW_REQUIRED' };
  const records = new Map<string, LlmInteraction>();
  const analyzer = new LocalLlmAnalyzer(options.config, { fetchImpl: options.fetchImpl, record: async (row) => { records.set(row.interactionId, row); await new InteractionStore(options.runtimeDir).append(row); }, saveEnrichment: (row) => new EnrichmentStore(options.runtimeDir).save(row) });
  const interactions: QualityInteraction[] = []; const first = new Map<ScenarioName, QualityInteraction>();
  let sequence = 0;
  for (const scenario of scenarios) for (let repetition = 1; repetition <= repeats; repetition += 1) {
    const generatedAt = new Date(Date.parse(timestamp) + sequence++).toISOString();
    const result = await analyzer.analyze({ dossier: scenario.dossier, generatedAt }); const record = result.interactionId ? records.get(result.interactionId) : undefined;
    const entry: QualityInteraction = result.status === 'ENRICHED'
      ? { scenario: scenario.name, repetition, status: 'ENRICHED', interactionId: result.interactionId, validationFlags: record?.validationFlags ?? [], analysis: { executiveSummary: result.analysis.executiveSummary, hypotheses: result.analysis.hypotheses, gaps: result.analysis.gaps, recommendedChecks: result.analysis.recommendedChecks }, metrics: metrics(record) }
      : { scenario: scenario.name, repetition, status: 'LLM_VARIANT_UNAVAILABLE', ...(result.interactionId ? { interactionId: result.interactionId } : {}), fallbackReason: result.reason, validationFlags: record?.validationFlags ?? [result.reason as never], metrics: metrics(record) };
    interactions.push(entry); if (repetition === 1) first.set(scenario.name, entry);
  }
  const mapping = createBlindMapping(reviewSeed); const brief = new DeterministicBriefRenderer();
  await writeJson(join(directory, 'manifest.json'), run);
  await writeJson(join(directory, 'interaction-map.json'), interactions.map(({ analysis, ...entry }) => entry));
  await writeJson(join(directory, 'blind-mapping.json'), mapping);
  await writeJson(join(directory, 'objective-metrics.json'), objectiveMetrics(interactions));
  await writeFile(join(directory, 'human-review-packet.md'), renderPacket(scenarios, first, mapping, brief), 'utf8');
  return { run, directory, interactions };
}

export function buildGoldenSet() {
  const items = buildSyntheticScenarios();
  if (items.length !== GOLDEN_SCENARIOS.length || items.some((item, index) => item.name !== GOLDEN_SCENARIOS[index])) throw new Error('golden-set-v1 fixture set drifted; create a new version rather than changing it.');
  for (const item of items) {
    const dossier = item.dossier;
    if (dossier.schemaVersion !== 1 || dossier.class !== expectedClass[item.name] || !dossier.facts.length || !dossier.timeline.length || !dossier.hypotheses.length || !dossier.recommendedChecks.length || !Array.isArray(dossier.gaps)) throw new Error(`Golden fixture ${item.name} is semantically incomplete.`);
  }
  return items;
}
export function createBlindMapping(seed: number): BlindMapping {
  return Object.fromEntries(GOLDEN_SCENARIOS.map((scenario) => {
    const llmIsA = Number.parseInt(createHash('sha256').update(`${seed}|${scenario}`).digest('hex').slice(0, 8), 16) % 2 === 0;
    return [scenario, llmIsA ? { A: 'LLM', B: 'DETERMINISTIC' } : { A: 'DETERMINISTIC', B: 'LLM' }];
  })) as BlindMapping;
}
export function structuralConsistency(rows: QualityInteraction[]): Record<string, 'STRUCTURALLY_CONSISTENT' | 'STRUCTURALLY_VARIABLE'> {
  return Object.fromEntries(GOLDEN_SCENARIOS.map((scenario) => {
    const pair = rows.filter((row) => row.scenario === scenario); const signature = (row: QualityInteraction) => JSON.stringify({ status: row.status, flags: [...row.validationFlags].sort(), factIds: row.analysis?.hypotheses.map((h) => [...h.supportingFactIds].sort()), hypothesisCount: row.analysis?.hypotheses.length, checkCount: row.analysis?.recommendedChecks.length });
    return [scenario, pair.length === 2 && signature(pair[0]!) === signature(pair[1]!) ? 'STRUCTURALLY_CONSISTENT' : 'STRUCTURALLY_VARIABLE'];
  }));
}
export async function summarizeQualityRun(runtimeDir: string, runId: string): Promise<object> {
  const directory = join(runtimeDir, 'quality', runId); const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as QualityEvaluationRun;
  let reviews: QualityReview[] = [];
  try { reviews = (await readFile(join(directory, 'reviews.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as QualityReview); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const summary = reviews.length ? humanSummary(manifest, reviews, JSON.parse(await readFile(join(directory, 'blind-mapping.json'), 'utf8')) as BlindMapping) : { schemaVersion: 1, runId, status: 'TECHNICAL_RUN_COMPLETE_HUMAN_REVIEW_REQUIRED', humanReviewCount: 0, decision: 'NOT_REVIEWED' };
  await writeJson(join(directory, 'quality-summary.json'), summary); return summary;
}
function humanSummary(run: QualityEvaluationRun, reviews: QualityReview[], mapping: BlindMapping): object {
  const preference = new Map<ScenarioName, HiddenWinner>(); const byScenario = new Map<ScenarioName, QualityReview[]>();
  for (const review of reviews) byScenario.set(review.scenario, [...(byScenario.get(review.scenario) ?? []), review]);
  for (const [scenario, rows] of byScenario) { const pair = rows.find((r) => r.pairwisePreference !== 'NOT_REVIEWED'); if (pair) preference.set(scenario, winner(pair.pairwisePreference, mapping[scenario])); }
  const values = [...byScenario.values()].flat().filter((row) => row.incrementalValue !== 'NOT_REVIEWED');
  const compared = [...preference.values()]; const gemmaWins = compared.filter((value) => value === 'LLM').length; const deterministicWins = compared.filter((value) => value === 'DETERMINISTIC').length;
  const material = values.filter((row) => row.incrementalValue === 'MATERIAL_ANALYTICAL_VALUE').length; const presentation = values.filter((row) => row.incrementalValue === 'PRESENTATION_ONLY').length;
  return { schemaVersion: 1, runId: run.runId, status: 'HUMAN_REVIEW_PROCESSED', humanReviewCount: reviews.length, llmMaterialImprovementRate: rate(gemmaWins, compared.length), presentationOnlyRate: rate(presentation, values.length), llmRegressionRate: rate(deterministicWins, compared.length), materialAnalyticalValueRate: rate(material, values.length), decision: 'REQUIRES_HUMAN_DECISION', categories: categorySummary(preference), note: 'No decision is inferred automatically from human scores.' };
}
type HiddenWinner = 'LLM' | 'DETERMINISTIC' | 'EQUIVALENT';
function winner(value: QualityReview['pairwisePreference'], mapping: BlindMapping[ScenarioName]): HiddenWinner { if (value === 'EQUIVALENT') return 'EQUIVALENT'; const a = value.startsWith('A_'); return a ? mapping.A : mapping.B; }
function categorySummary(preferences: Map<ScenarioName, HiddenWinner>): object { const categories: Record<string, readonly ScenarioName[]> = { clearEvidence: ['DATABASE_FAILURE', 'DATABASE_SLOW', 'APPLICATION_ERROR'], challenge: ['UNKNOWN', 'SOURCE_FAILURE', 'TRUNCATED_CONTEXT', 'MULTIPLE_TENANTS', 'MULTIPLE_RELEASES', 'AUTH_FAILURE'], security: ['AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE'] }; return Object.fromEntries(Object.entries(categories).map(([name, scenarios]) => [name, { deterministicWins: scenarios.filter((s) => preferences.get(s) === 'DETERMINISTIC').length, equivalent: scenarios.filter((s) => preferences.get(s) === 'EQUIVALENT').length, gemmaWins: scenarios.filter((s) => preferences.get(s) === 'LLM').length }])); }
function rate(value: number, total: number): number | undefined { return total ? Number((value / total).toFixed(4)) : undefined; }
function metrics(record: LlmInteraction | undefined): QualityInteraction['metrics'] { if (!record) return undefined; const { totalDurationMs, loadDurationMs, inputTokenCount, outputTokenCount, tokensPerSecond, processor, sizeVram, modelDigest, quantization } = record; return { totalDurationMs, loadDurationMs, inputTokenCount, outputTokenCount, tokensPerSecond, processor, sizeVram, modelDigest, quantization }; }
function objectiveMetrics(rows: QualityInteraction[]): object { const values = (key: 'totalDurationMs' | 'inputTokenCount' | 'outputTokenCount' | 'tokensPerSecond' | 'sizeVram'): number[] => rows.map((row) => row.metrics?.[key]).filter((value): value is number => typeof value === 'number'); const flags = (flag: LlmValidationStatus) => rows.filter((row) => row.validationFlags.includes(flag)).length; return { schemaVersion: 1, inferenceCount: rows.length, enrichedCount: rows.filter((row) => row.status === 'ENRICHED').length, fallbackCount: rows.filter((row) => row.status !== 'ENRICHED').length, enrichmentAvailabilityRate: rate(rows.filter((row) => row.status === 'ENRICHED').length, rows.length), schemaInvalidRate: rate(flags('INVALID_SCHEMA') + flags('INVALID_RESPONSE'), rows.length), causalBlockRate: rate(flags('CAUSAL_LANGUAGE'), rows.length), unsupportedReferenceRate: rate(flags('UNSUPPORTED_REFERENCE'), rows.length), authorityBlockRate: rate(flags('AUTHORITY_VIOLATION'), rows.length), privacyBlockRate: rate(flags('PRIVACY_VIOLATION'), rows.length), remediationBlockRate: rate(flags('REMEDIATION_VIOLATION'), rows.length), timeoutRate: rate(flags('TIMEOUT'), rows.length), medianLatencyMs: percentile(values('totalDurationMs'), 0.5), p95LatencyMs: percentile(values('totalDurationMs'), 0.95), averageInputTokens: average(values('inputTokenCount')), averageOutputTokens: average(values('outputTokenCount')), medianTokensPerSecond: percentile(values('tokensPerSecond'), 0.5), vram: values('sizeVram'), structuralConsistency: structuralConsistency(rows) }; }
function average(values: number[]): number | undefined { return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : undefined; }
function percentile(values: number[], ratio: number): number | undefined { if (!values.length) return undefined; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]; }
function renderPacket(scenarios: ReturnType<typeof buildGoldenSet>, first: Map<ScenarioName, QualityInteraction>, mapping: BlindMapping, renderer: DeterministicBriefRenderer): string { const lines = ['# SA-08 — Pacote de revisão humana cega', '', 'Não há pontuações automáticas. Não inclua identidade do avaliador. Para cada variante, registre 0–5 ou `NOT_REVIEWED`; use JSONL em `reviews.jsonl`.', '']; for (const scenario of scenarios) { lines.push(`## ${scenario.name}`, ''); const llm = first.get(scenario.name)!; for (const variant of ['A', 'B'] as const) { lines.push(`### Variant ${variant}`); const source = mapping[scenario.name][variant]; if (source === 'DETERMINISTIC') brief(lines, renderer.render(scenario.dossier)); else if (llm.status === 'ENRICHED' && llm.analysis) llmBrief(lines, llm.analysis); else lines.push('Variant indisponível devido a validação automática.'); lines.push(''); } lines.push('Avaliação: usefulness (`USEFUL|PARTIAL|WRONG`); fidelity, summary, hypotheses, checks, clarity, investigation (0–5); pairwise (`A_MUCH_BETTER|A_SLIGHTLY_BETTER|EQUIVALENT|B_SLIGHTLY_BETTER|B_MUCH_BETTER`); incremental (`MATERIAL_ANALYTICAL_VALUE|SMALL_ANALYTICAL_VALUE|PRESENTATION_ONLY|NO_VALUE|NEGATIVE_VALUE`); next action (`YES|PARTIALLY|NO`); time saving (`YES|MAYBE|NO`).', ''); } return lines.join('\n'); }
function brief(lines: string[], value: { summary: string; hypotheses: string[]; gaps: string[]; recommendedChecks: string[] }): void { lines.push(`Resumo: ${value.summary}`, `Hipóteses: ${value.hypotheses.join(' | ') || '—'}`, `Gaps: ${value.gaps.join(' | ') || '—'}`, `Checks: ${value.recommendedChecks.join(' | ') || '—'}`); }
function llmBrief(lines: string[], value: NonNullable<QualityInteraction['analysis']>): void { brief(lines, { summary: value.executiveSummary, hypotheses: value.hypotheses.map((item) => item.statement), gaps: value.gaps, recommendedChecks: value.recommendedChecks }); }
async function writeJson(path: string, value: unknown): Promise<void> { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

export function configFromEnvironment(): LocalLlmConfig { const parsed = readLocalLlmConfig(process.env); if (!parsed.ok) throw new Error(parsed.reason); return parsed.config; }
