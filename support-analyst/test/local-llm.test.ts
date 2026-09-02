import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readLocalLlmConfig } from '../src/config.js';
import { LocalLlmAnalyzer, LlmInputBuilder, InteractionStore, assertLlmInputPrivacy, validateLlmOutput } from '../src/local-llm/index.js';
import { buildSyntheticScenarios } from '../src/llm-benchmark/index.js';

const dossier = buildSyntheticScenarios().find((item) => item.name === 'DATABASE_FAILURE')!.dossier;
const valid = { executiveSummary: 'Resumo factual.', analysis: 'A evidência disponível deve ser revisada.', hypotheses: [{ statement: 'A conectividade pode estar contribuindo.', supportingFactIds: ['fact:db_failures'] }], gaps: [], recommendedChecks: ['Verificar logs técnicos no intervalo.'] };
const config = readLocalLlmConfig({ SUPPORT_ANALYST_LLM_ENABLED: 'true' });
if (!config.ok) throw new Error(config.reason);
const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fetchMock: typeof fetch = async (input) => {
  const path = new URL(input.toString()).pathname;
  if (path === '/api/tags') return response({ models: [{ name: 'gemma4:12b', digest: 'digest', details: { quantization_level: 'Q4_K_M' } }] });
  if (path === '/api/chat') return response({ message: { content: JSON.stringify(valid), thinking: 'never persist' }, total_duration: 2_000_000, prompt_eval_count: 8, prompt_eval_duration: 100_000, eval_count: 4, eval_duration: 400_000 });
  if (path === '/api/ps') return response({ models: [{ name: 'gemma4:12b', processor: 'GPU', size_vram: 123 }] });
  throw new Error(`unexpected ${path}`);
};

test('local LLM configuration is disabled by default and rejects non-loopback endpoints', () => {
  assert.equal(readLocalLlmConfig({}).ok && readLocalLlmConfig({}).config.enabled, false);
  assert.deepEqual(readLocalLlmConfig({ SUPPORT_ANALYST_LLM_ENDPOINT: 'https://example.test' }), { ok: false, reason: 'SUPPORT_ANALYST_LLM_ENDPOINT must be an HTTP loopback URL' });
});

test('input builder minimizes dossier context and removes raw references', () => {
  const input = new LlmInputBuilder().build(dossier);
  assert.doesNotMatch(input.serialized, /rawRef|synthetic|eventId|tenant-a/i);
  assert.match(input.serialized, /fact:db_failures/);
  assert.match(input.serialized, /DATABASE_FAILURE/);
});

test('input builder permits the allowlisted AUTHORIZATION_DENIED class while rejecting Authorization headers', () => {
  const authorizationDossier = buildSyntheticScenarios().find((item) => item.name === 'AUTHORIZATION_DENIED')!.dossier;
  assert.match(new LlmInputBuilder().build(authorizationDossier).serialized, /AUTHORIZATION_DENIED/);
  assert.throws(() => assertLlmInputPrivacy({ header: 'Authorization: Bearer unsafe' }), /privacy/);
});

test('disabled local analyzer makes no Ollama call', async () => {
  const disabled = readLocalLlmConfig({}); if (!disabled.ok) throw new Error(disabled.reason);
  const analyzer = new LocalLlmAnalyzer(disabled.config, { fetchImpl: async () => { throw new Error('must not call'); } });
  assert.deepEqual(await analyzer.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' }), { status: 'FALLBACK', reason: 'DISABLED' });
});

test('valid output persists sanitized interaction and keeps dossier immutable', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-local-llm-')); const original = JSON.stringify(dossier);
  try {
    const analyzer = new LocalLlmAnalyzer(config.config, { fetchImpl: fetchMock, record: (row) => new InteractionStore(runtime).append(row) });
    const result = await analyzer.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' });
    assert.equal(result.status, 'ENRICHED'); assert.equal(JSON.stringify(dossier), original); assert.equal(analyzer.healthCounters().llmSuccesses, 1);
    const saved = await readFile(join(runtime, 'llm', 'interactions.jsonl'), 'utf8');
    assert.doesNotMatch(saved, /thinking/i); assert.match(saved, /sizeVram/);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('validator blocks unsafe output and privacy-invalid content is not persisted', async () => {
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, hypotheses: [{ ...valid.hypotheses[0], supportingFactIds: ['fact:no'] }] }), dossier).status, 'UNSUPPORTED_REFERENCE');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, analysis: 'token=unsafe' }), dossier).status, 'PRIVACY_VIOLATION');
  const unsafeFetch: typeof fetch = async (input) => new URL(input.toString()).pathname === '/api/chat' ? response({ message: { content: JSON.stringify({ ...valid, analysis: 'token=unsafe' }) } }) : fetchMock(input);
  const rows: unknown[] = []; const analyzer = new LocalLlmAnalyzer(config.config, { fetchImpl: unsafeFetch, record: async (row) => { rows.push(row); } });
  const result = await analyzer.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' });
  assert.equal(result.status, 'FALLBACK'); assert.equal((rows[0] as { output?: unknown }).output, undefined);
});

test('authority-invalid output is never persisted', async () => {
  const authorityFetch: typeof fetch = async (input) => new URL(input.toString()).pathname === '/api/chat' ? response({ message: { content: JSON.stringify({ ...valid, executiveSummary: 'A classe APPLICATION_ERROR foi confirmada.' }) } }) : fetchMock(input);
  const rows: unknown[] = []; const analyzer = new LocalLlmAnalyzer(config.config, { fetchImpl: authorityFetch, record: async (row) => { rows.push(row); } });
  const result = await analyzer.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' });
  assert.equal(result.status, 'FALLBACK'); assert.equal((rows[0] as { output?: unknown }).output, undefined);
});

test('validator identifies schema, authority, causal, vulnerability and remediation guardrails', () => {
  assert.equal(validateLlmOutput('{bad json}', dossier).status, 'INVALID_RESPONSE');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, extra: true }), dossier).status, 'INVALID_SCHEMA');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, executiveSummary: 'A classe APPLICATION_ERROR foi confirmada.' }), dossier).status, 'AUTHORITY_VIOLATION');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, analysis: 'A causa raiz foi confirmada.' }), dossier).status, 'CAUSAL_LANGUAGE');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, analysis: 'Vulnerabilidade confirmada.' }), dossier).status, 'VULNERABILITY_CLAIM');
  assert.equal(validateLlmOutput(JSON.stringify({ ...valid, recommendedChecks: ['Executar rollback.'] }), dossier).status, 'REMEDIATION_VIOLATION');
});

test('analyzer records unavailable, absent-model and timeout fallbacks', async () => {
  const unavailable = new LocalLlmAnalyzer(config.config, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' })).reason, 'OLLAMA_UNAVAILABLE');
  const missing = new LocalLlmAnalyzer(config.config, { fetchImpl: async () => response({ models: [] }) });
  assert.equal((await missing.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' })).reason, 'MODEL_UNAVAILABLE');
  const timeoutFetch: typeof fetch = async (input) => new URL(input.toString()).pathname === '/api/chat' ? Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) : fetchMock(input);
  const timedOut = new LocalLlmAnalyzer(config.config, { fetchImpl: timeoutFetch });
  assert.equal((await timedOut.analyze({ dossier, generatedAt: '2026-08-31T12:00:00.000Z' })).reason, 'TIMEOUT');
  assert.equal(timedOut.healthCounters().llmTimeouts, 1);
});
