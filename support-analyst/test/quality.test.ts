import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildGoldenSet, createBlindMapping, DeterministicBriefRenderer, GOLDEN_SCENARIOS, QualityReviewStore, runQualityEvaluation, structuralConsistency, summarizeQualityRun, validateQualityReview } from '../src/quality/index.js';
import { readLocalLlmConfig } from '../src/config.js';

const parsed = readLocalLlmConfig({ SUPPORT_ANALYST_LLM_ENABLED: 'true' });
if (!parsed.ok) throw new Error(parsed.reason);
const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const valid = { executiveSummary: 'Resumo factual.', analysis: 'A evidência disponível deve ser revisada.', hypotheses: [], gaps: [], recommendedChecks: [] };
const fetchMock: typeof fetch = async (input) => {
  const path = new URL(input.toString()).pathname;
  if (path === '/api/tags') return response({ models: [{ name: 'gemma4:12b', digest: 'digest', details: { quantization_level: 'Q4_K_M' } }] });
  if (path === '/api/chat') return response({ message: { content: JSON.stringify(valid), thinking: 'not stored' }, total_duration: 2_000_000, load_duration: 0, prompt_eval_count: 8, eval_count: 4, eval_duration: 400_000 });
  if (path === '/api/ps') return response({ models: [{ name: 'gemma4:12b', processor: 'GPU', size_vram: 123 }] });
  throw new Error(`Unexpected ${path}`);
};
const baseReview = (runId: string) => ({ schemaVersion: 1, evaluationRunId: runId, scenario: 'DATABASE_FAILURE', variant: 'A', usefulness: 'USEFUL', factualFidelity: 5, summaryQuality: 4, hypothesisQuality: 4, checkQuality: 4, clarity: 5, investigationValue: 4, nextActionHelp: 'YES', timeSaving: 'MAYBE', pairwisePreference: 'A_SLIGHTLY_BETTER', incrementalValue: 'MATERIAL_ANALYTICAL_VALUE', comment: 'email human@example.test token=unsafe\n ok' });

test('golden-set-v1 has exactly the frozen twelve semantically complete scenarios', () => {
  const scenarios = buildGoldenSet();
  assert.deepEqual(scenarios.map((item) => item.name), GOLDEN_SCENARIOS);
  assert.equal(scenarios.length, 12);
  for (const scenario of scenarios) assert.ok(scenario.dossier.class);
});

test('deterministic renderer is a template projection and blind mapping is reproducible', () => {
  const dossier = buildGoldenSet()[0]!.dossier; const value = new DeterministicBriefRenderer().render(dossier);
  assert.equal(value.summary, `Incidente ${dossier.class}, severidade ${dossier.severity}, confiança ${dossier.confidence}, com ${dossier.occurrences} ocorrência(s) no serviço ${dossier.service}.`);
  assert.deepEqual(createBlindMapping(42), createBlindMapping(42));
  assert.notDeepEqual(createBlindMapping(42), createBlindMapping(43));
});

test('quality run creates blind packet, normal interactions, metrics and unavailable fallback representation', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-quality-'));
  try {
    const result = await runQualityEvaluation({ runtimeDir: runtime, config: parsed.config, fetchImpl: fetchMock, now: () => new Date('2026-09-01T12:00:00.000Z'), gitSha: 'abc' });
    assert.equal(result.interactions.length, 24); assert.equal(result.interactions.filter((row) => row.status === 'ENRICHED').length, 24);
    const packet = await readFile(join(result.directory, 'human-review-packet.md'), 'utf8');
    assert.match(packet, /Variant A/); assert.doesNotMatch(packet, /gemma|\bllm\b|deterministic|latency|token/i);
    assert.ok((await readFile(join(result.directory, 'blind-mapping.json'), 'utf8')).includes('LLM'));
    assert.match(await readFile(join(runtime, 'llm', 'interactions.jsonl'), 'utf8'), /llmi1:/);
    const metrics = JSON.parse(await readFile(join(result.directory, 'objective-metrics.json'), 'utf8')); assert.equal(metrics.inferenceCount, 24); assert.equal(metrics.enrichedCount, 24); assert.equal(metrics.medianLatencyMs, 2);
    const unavailable = result.interactions.map((row, index) => index === 0 ? { ...row, status: 'LLM_VARIANT_UNAVAILABLE' as const } : row); assert.equal(structuralConsistency(unavailable).DATABASE_FAILURE, 'STRUCTURALLY_VARIABLE');
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('review store is append-only, sanitizes comments, rejects identity, and summary never invents scores', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-quality-review-')); const runId = 'quality-test';
  try {
    const review = await new QualityReviewStore(runtime, runId).append(baseReview(runId));
    assert.equal(review.comment, 'email [REDACTED] [REDACTED] ok');
    assert.throws(() => validateQualityReview({ ...baseReview(runId), reviewerEmail: 'x@y.test' }, runId), /identity/);
    const directory = join(runtime, 'quality', runId); const manifest = { schemaVersion: 1, runId, timestamp: '2026-09-01T00:00:00.000Z', model: 'gemma4:12b', promptVersion: 'prompt-v1', settings: {}, goldenSetVersion: 'golden-set-v1', scenarioCount: 12, repeats: 2, reviewSeed: 42, status: 'TECHNICAL_RUN_COMPLETE_HUMAN_REVIEW_REQUIRED' };
    await (await import('node:fs/promises')).writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await (await import('node:fs/promises')).writeFile(join(directory, 'blind-mapping.json'), JSON.stringify(createBlindMapping(42)));
    const summary = await summarizeQualityRun(runtime, runId) as { humanReviewCount: number; decision: string };
    assert.equal(summary.humanReviewCount, 1); assert.equal(summary.decision, 'REQUIRES_HUMAN_DECISION');
  } finally { await rm(runtime, { recursive: true, force: true }); }
});
