import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertLoopbackUrl, buildSyntheticScenarios, parseBenchmarkOutput, runBenchmark, validateBenchmarkOutput } from '../src/llm-benchmark/index.js';

const dossier = buildSyntheticScenarios().find((item) => item.name === 'DATABASE_FAILURE')!.dossier;
const valid = { executiveSummary: 'Resumo factual.', analysis: 'A evidência disponível deve ser revisada.', hypotheses: [{ statement: 'A conectividade pode estar contribuindo.', supportingFactIds: ['fact:db_failures'] }], gaps: [], recommendedChecks: ['Verificar logs técnicos no intervalo.'] };
const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

test('benchmark only permits loopback HTTP endpoints', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:11434').hostname, '127.0.0.1');
  assert.throws(() => assertLoopbackUrl('https://example.com'), /loopback/);
  assert.throws(() => assertLoopbackUrl('http://192.168.1.10:11434'), /loopback/);
});

test('output parser and validator reject malformed schema and invented fact IDs', () => {
  assert.throws(() => parseBenchmarkOutput('{not json}'));
  assert.deepEqual(validateBenchmarkOutput({ ...valid, unexpected: true }, dossier).flags, ['SCHEMA_INVALID']);
  const result = validateBenchmarkOutput({ ...valid, hypotheses: [{ ...valid.hypotheses[0], supportingFactIds: ['fact:invented'] }] }, dossier);
  assert.ok(result.flags.includes('UNKNOWN_FACT_ID'));
});

test('validator flags authority, causal, vulnerability, remediation and privacy violations deterministically', () => {
  const result = validateBenchmarkOutput({ ...valid, executiveSummary: 'A classe APPLICATION_ERROR foi confirmada; a causa raiz foi encontrada e a vulnerabilidade confirmada.', analysis: 'token=unsafe', recommendedChecks: ['Executar rollback imediatamente.'] }, dossier);
  assert.ok(result.flags.includes('AUTHORITY_VIOLATION'));
  assert.ok(result.flags.includes('CAUSAL_LANGUAGE'));
  assert.ok(result.flags.includes('VULNERABILITY_CLAIM'));
  assert.ok(result.flags.includes('REMEDIATION'));
  assert.ok(result.flags.includes('PRIVACY_VIOLATION'));
});

test('benchmark records parsed metrics and never persists unsafe output or thinking', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-llm-benchmark-'));
  const fetchMock: typeof fetch = async (input, init) => {
    const path = new URL(input.toString()).pathname;
    if (path === '/api/tags') return json({ models: [{ name: 'gemma4:12b', digest: 'digest', details: { quantization_level: 'Q4_K_M' } }] });
    if (path === '/api/chat') return json({ message: { content: JSON.stringify({ ...valid, analysis: 'Authorization: Bearer unsafe' }), thinking: 'never persist' }, total_duration: 1_000_000, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 100_000, eval_count: 5, eval_duration: 500_000 });
    if (path === '/api/ps') return json({ models: [{ name: 'gemma4:12b', size_vram: 123, context_length: 8192 }] });
    if (path === '/api/generate') return json({});
    throw new Error(`unexpected ${path} ${init?.method ?? 'GET'}`);
  };
  try {
    const result = await runBenchmark({ runtimeDir: runtime, models: ['gemma4:12b'], scenarios: ['DATABASE_FAILURE'], repetitions: 1, now: () => new Date('2026-08-31T12:00:00.000Z'), fetchImpl: fetchMock });
    assert.equal(result.interactions.length, 1);
    assert.equal(result.interactions[0]!.status, 'UNSAFE_OUTPUT');
    assert.equal(result.interactions[0]!.output, undefined);
    assert.equal(result.interactions[0]!.tokensPerSecond, 10_000);
    const persisted = await readFile(join(result.directory, 'interactions.jsonl'), 'utf8');
    assert.doesNotMatch(persisted, /Authorization|Bearer/i);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});
