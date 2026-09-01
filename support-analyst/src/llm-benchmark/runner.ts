import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContextBuilder, buildDeterministicDossier } from '../dossiers/index.js';
import { IncidentGrouper } from '../incidents/index.js';
import type { NormalizedEvent } from '../types.js';
import { assertLoopbackUrl, chatOllama } from './client.js';
import { buildPrompt } from './prompt-v1.js';
import { CANDIDATES, LLM_BENCHMARK_SCHEMA_VERSION, PROMPT_VERSION, type BenchmarkScenario, type CandidateModel, type LlmBenchmarkInteraction, type LlmBenchmarkSettings, type ScenarioName } from './types.js';
import { parseBenchmarkOutput, validateBenchmarkOutput } from './validator.js';

export const DEFAULT_SETTINGS: LlmBenchmarkSettings = { numCtx: 8192, temperature: 0.1, seed: 42, numPredict: 800, timeoutMs: 60_000, think: false };
export const QUALIFICATION_SCENARIOS: ScenarioName[] = ['DATABASE_FAILURE', 'DATABASE_SLOW', 'APPLICATION_ERROR', 'AUTH_FAILURE', 'UNKNOWN', 'SOURCE_FAILURE'];
export const FINALIST_SCENARIOS: ScenarioName[] = ['DATABASE_FAILURE', 'DATABASE_SLOW', 'APPLICATION_ERROR', 'AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE', 'TELEMETRY_FAILURE', 'UNKNOWN', 'SOURCE_FAILURE', 'TRUNCATED_CONTEXT', 'MULTIPLE_TENANTS', 'MULTIPLE_RELEASES'];

type OllamaModel = { name: string; digest?: string; details?: { quantization_level?: string } };
type OllamaPsModel = { name: string; size_vram?: number; context_length?: number; processor?: string };
export type BenchmarkRunOptions = { runtimeDir: string; endpoint?: string; models: readonly CandidateModel[]; scenarios: readonly ScenarioName[]; repetitions: number; settings?: LlmBenchmarkSettings; now?: () => Date; fetchImpl?: typeof fetch };

export async function runBenchmark(options: BenchmarkRunOptions): Promise<{ runId: string; interactions: LlmBenchmarkInteraction[]; directory: string }> {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const endpoint = options.endpoint ?? 'http://127.0.0.1:11434';
  assertLoopbackUrl(endpoint);
  const fetchImpl = options.fetchImpl ?? fetch;
  const available = await getJson<{ models?: OllamaModel[] }>(endpoint, '/api/tags', fetchImpl);
  const installed = new Map((available.models ?? []).map((model) => [model.name, model]));
  const runId = `llm-benchmark-${(options.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = join(options.runtimeDir, 'benchmarks', runId); await mkdir(directory, { recursive: true });
  const scenarios = buildSyntheticScenarios().filter((scenario) => options.scenarios.includes(scenario.name));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: LLM_BENCHMARK_SCHEMA_VERSION, runId, endpoint: 'loopback', settings, models: options.models, scenarios: scenarios.map((item) => item.name), promptVersion: PROMPT_VERSION, thinkingStored: false, rawElasticStored: false }, null, 2));
  await writeFile(join(directory, 'inputs.json'), JSON.stringify(scenarios, null, 2));
  const interactions: LlmBenchmarkInteraction[] = [];
  for (const model of options.models) {
    const details = installed.get(model);
    if (!details) continue;
    for (const scenario of scenarios) for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      const interaction = await runOne({ endpoint, fetchImpl, model, details, scenario, settings, runId, timestamp: (options.now ?? (() => new Date()))().toISOString() });
      interactions.push(interaction);
      await appendFile(join(directory, 'interactions.jsonl'), `${JSON.stringify(interaction)}\n`, 'utf8');
    }
    await unload(endpoint, model, fetchImpl);
  }
  const summary = summarize(interactions);
  await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(directory, 'human-review-samples.md'), renderHumanReviewSamples(interactions));
  return { runId, interactions, directory };
}

async function runOne(input: { endpoint: string; fetchImpl: typeof fetch; model: CandidateModel; details: OllamaModel; scenario: BenchmarkScenario; settings: LlmBenchmarkSettings; runId: string; timestamp: string }): Promise<LlmBenchmarkInteraction> {
  const base: Omit<LlmBenchmarkInteraction, 'schemaValid' | 'validationFlags' | 'status'> = { schemaVersion: 1, runId: input.runId, interactionId: `llmi1:${createHash('sha256').update(`${input.runId}|${input.model}|${input.scenario.name}|${input.timestamp}`).digest('hex')}`, timestamp: input.timestamp, scenario: input.scenario.name, model: input.model, modelDigest: input.details.digest, quantization: input.details.details?.quantization_level, promptVersion: PROMPT_VERSION, contextHash: input.scenario.dossier.contextHash, settings: input.settings };
  try {
    const response = await chatOllama(input.endpoint, input.model, buildPrompt(input.scenario.dossier), input.settings, input.fetchImpl);
    const ps = await getJson<{ models?: OllamaPsModel[] }>(input.endpoint, '/api/ps', input.fetchImpl);
    const loaded = ps.models?.find((item) => item.name === input.model);
    const metrics = response.metrics;
    const measured = { ...base, inputTokenCount: metrics.promptEvalCount, outputTokenCount: metrics.evalCount, totalDurationMs: nsToMs(metrics.totalDuration), loadDurationMs: nsToMs(metrics.loadDuration), promptEvalDurationMs: nsToMs(metrics.promptEvalDuration), evalDurationMs: nsToMs(metrics.evalDuration), tokensPerSecond: metrics.evalCount && metrics.evalDuration ? Number((metrics.evalCount / (metrics.evalDuration / 1_000_000_000)).toFixed(3)) : undefined, processor: loaded?.processor, sizeVram: loaded?.size_vram };
    let parsed: unknown;
    try { parsed = parseBenchmarkOutput(response.content); } catch { return { ...measured, schemaValid: false, validationFlags: ['MALFORMED_RESPONSE'], status: 'INVALID_OUTPUT' }; }
    const validation = validateBenchmarkOutput(parsed, input.scenario.dossier);
    const unsafe = validation.flags.includes('PRIVACY_VIOLATION');
    return { ...measured, ...(unsafe ? {} : { output: validation.output }), schemaValid: Boolean(validation.output), validationFlags: validation.flags, status: unsafe ? 'UNSAFE_OUTPUT' : validation.flags.length ? 'INVALID_OUTPUT' : 'OK' };
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'AbortError';
    return { ...base, schemaValid: false, validationFlags: [], status: timeout ? 'TIMEOUT' : 'ERROR' };
  }
}

async function getJson<T>(endpoint: string, path: string, fetchImpl: typeof fetch): Promise<T> { const response = await fetchImpl(new URL(path, endpoint)); if (!response.ok) throw new Error(`Ollama request failed with HTTP ${response.status}.`); return response.json() as Promise<T>; }
async function unload(endpoint: string, model: CandidateModel, fetchImpl: typeof fetch): Promise<void> { await fetchImpl(new URL('/api/generate', endpoint), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }); }
function nsToMs(value: number | undefined): number | undefined { return value === undefined ? undefined : Number((value / 1_000_000).toFixed(3)); }

export function buildSyntheticScenarios(): BenchmarkScenario[] {
  const timestamp = '2026-08-31T12:00:00.000Z';
  return FINALIST_SCENARIOS.map((name) => {
    const events = scenarioEvents(name, timestamp); const sourceFailures = name === 'SOURCE_FAILURE' ? [{ source: 'audit' as const, kind: 'timeout' as const }] : [];
    const incident = new IncidentGrouper().group({ events, relations: [], existingIncidents: [], sourceFailures, referenceTime: timestamp }).incidents[0]!;
    const context = new ContextBuilder().build({ incident, events, relations: [], sourceFailures });
    return { name, dossier: buildDeterministicDossier({ context, generatedAt: timestamp }) };
  });
}

function scenarioEvents(name: ScenarioName, timestamp: string): NormalizedEvent[] {
  const base = (id: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent => ({ schemaVersion: 1, eventId: `${name.toLowerCase()}-${id}`, timestamp, source: 'technical', eventType: 'unmapped.signal', service: 'quiver-api', releaseSha: 'release-a', tenantId: 'tenant-a', rawRef: { index: 'synthetic', id: `${name.toLowerCase()}-${id}` }, ...extra });
  if (name === 'DATABASE_FAILURE') return [base('1', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } }), base('2', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })];
  if (name === 'DATABASE_SLOW') return [base('1', { eventType: 'db.operation.slow', db: { category: 'TIMEOUT', durationMs: 1_000 } })];
  if (name === 'APPLICATION_ERROR') return [base('1', { eventType: 'http.request.failed', http: { route: '/api/comandas', statusCode: 500 } })];
  if (name === 'AUTH_FAILURE') return [base('1', { source: 'audit', action: 'auth.login', outcome: 'failure', reasonCode: 'INVALID_CREDENTIALS' })];
  if (name === 'AUTHORIZATION_DENIED') return [base('1', { source: 'audit', eventType: 'authorization.denied', http: { statusCode: 403 } })];
  if (name === 'REALTIME_AUTH_FAILURE') return [base('1', { eventType: 'realtime.auth.failed', realtime: { reasonCode: 'SESSION_REJECTED' } })];
  if (name === 'TELEMETRY_FAILURE') return [base('1', { eventType: 'telemetry.delivery.failed' })];
  if (name === 'SOURCE_FAILURE') return [base('1')];
  if (name === 'TRUNCATED_CONTEXT') return Array.from({ length: 41 }, (_item, index) => base(String(index).padStart(2, '0'), { timestamp: `2026-08-31T12:${String(index).padStart(2, '0')}:00.000Z` }));
  if (name === 'MULTIPLE_TENANTS') return [base('1'), base('2', { tenantId: 'tenant-b' }), base('3', { tenantId: 'tenant-c' })];
  if (name === 'MULTIPLE_RELEASES') return [base('1'), base('2', { releaseSha: 'release-b' })];
  return [base('1', { service: undefined, releaseSha: undefined, tenantId: undefined })];
}

function summarize(interactions: LlmBenchmarkInteraction[]): object {
  return { schemaVersion: 1, interactionCount: interactions.length, models: CANDIDATES.map((model) => { const rows = interactions.filter((item) => item.model === model); const warm = rows.filter((item) => item.loadDurationMs === 0 || item.loadDurationMs === undefined).map((item) => item.totalDurationMs).filter((item): item is number => item !== undefined).sort((a, b) => a - b); return { model, inferenceCount: rows.length, schemaValidityRate: rows.length ? rows.filter((item) => item.schemaValid).length / rows.length : undefined, authorityViolations: rows.filter((item) => item.validationFlags.includes('AUTHORITY_VIOLATION')).length, unsupportedFlags: rows.filter((item) => item.validationFlags.includes('UNKNOWN_FACT_ID') || item.validationFlags.includes('UNSUPPORTED_HYPOTHESIS') || item.validationFlags.includes('UNSUPPORTED_REFERENCE')).length, privacyViolations: rows.filter((item) => item.validationFlags.includes('PRIVACY_VIOLATION')).length, remediationViolations: rows.filter((item) => item.validationFlags.includes('REMEDIATION')).length, timeoutOrErrorRate: rows.length ? rows.filter((item) => item.status === 'TIMEOUT' || item.status === 'ERROR').length / rows.length : undefined, medianWarmLatencyMs: median(warm), tokensPerSecond: median(rows.map((item) => item.tokensPerSecond).filter((item): item is number => item !== undefined)) }; }) };
}
function median(values: number[]): number | undefined { if (!values.length) return undefined; const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : Number(((values[middle - 1]! + values[middle]!) / 2).toFixed(3)); }

function renderHumanReviewSamples(interactions: LlmBenchmarkInteraction[]): string {
  const scenarios: ScenarioName[] = ['DATABASE_FAILURE', 'AUTH_FAILURE', 'UNKNOWN'];
  const lines = ['# Amostras para revisão humana', '', 'Campos de avaliação: summary, hypotheses, recommended checks, Portuguese clarity e faithfulness = `NOT_REVIEWED`.', ''];
  for (const scenario of scenarios) {
    lines.push(`## ${scenario}`, '');
    for (const interaction of interactions.filter((item) => item.scenario === scenario)) {
      lines.push(`### ${interaction.model} — ${interaction.status}`);
      if (!interaction.output) { lines.push(`Sem conteúdo persistido. Flags: ${interaction.validationFlags.join(', ') || 'nenhuma'}.`, ''); continue; }
      lines.push(`Resumo: ${compact(interaction.output.executiveSummary)}`, `Hipóteses: ${interaction.output.hypotheses.map((item) => compact(item.statement)).join(' | ') || '—'}`, `Checks: ${interaction.output.recommendedChecks.map(compact).join(' | ') || '—'}`, '');
    }
  }
  return lines.join('\n');
}
function compact(value: string): string { return value.replace(/\s+/g, ' ').replace(/[|]/g, '\\|').slice(0, 600); }
