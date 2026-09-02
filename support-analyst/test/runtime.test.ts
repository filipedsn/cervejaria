import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SupportAnalystRuntime, type PilotSource } from '../src/index.js';
import type { RawEventDocument } from '../src/types.js';

const technical: RawEventDocument = {
  index: 'logs-technical.otel-dev-000001', id: 'runtime-technical-001', sourceType: 'technical', source: {
    '@timestamp': '2026-09-02T12:00:00.000Z', data_stream: { dataset: 'technical.otel' }, attributes: {
      event: 'http.request.failed', correlationId: 'runtime-correlation-001', requestId: 'runtime-request-001', releaseSha: 'runtime-release-001', service: 'quiver-api', environment: 'dev', http: { request: { method: 'POST' }, route: '/api/pedidos/:id', response: { status_code: 500 } }, durationMs: 87
    }, trace_id: 'runtime-trace-001'
  }
};
const base = { pilot: { pollIntervalMs: 60_000, overlapMs: 120_000, initialWindowMs: 300_000, maxEvents: 50 }, health: { enabled: true, heartbeatIntervalMs: 30_000, heartbeatStaleMs: 90_000, snapshotStaleMs: 120_000, processingStaleMs: 300_000 }, llm: { enabled: false, endpoint: 'http://127.0.0.1:11434', model: 'gemma4:12b', timeoutMs: 1, numCtx: 1, keepAlive: '5m' } } as const;
const clock = { now: () => new Date('2026-09-02T12:01:00.000Z') };
function source(events: RawEventDocument[], options: { fail?: boolean } = {}): PilotSource { return { preflight: async () => { if (options.fail) throw Object.assign(new Error('denied'), { kind: 'forbidden' }); }, read: async () => { if (options.fail) throw Object.assign(new Error('denied'), { kind: 'forbidden' }); return events; } }; }

test('pilot runtime performs the fake source-to-dossier path with health, queue, and atomic watermark', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sa-runtime-'));
  try {
    const runtime = new SupportAnalystRuntime({ ...base, runtimeDir: directory, source: source([technical]), clock });
    await runtime.start(); const result = await runtime.runOnce(); await runtime.stop();
    assert.equal(result.outcome, 'COMPLETED'); assert.equal(result.eventsRead, 1); assert.equal(result.dossiersGenerated, 1);
    const watermark = JSON.parse(await readFile(join(directory, 'state', 'source-watermark.json'), 'utf8')); assert.equal(watermark.latestEventAt, '2026-09-02T12:00:00.000Z');
    const queue = JSON.parse(await readFile(join(directory, 'review-queue.json'), 'utf8')); assert.equal(queue.items[0].reviewStatus, 'PENDING');
    const snapshot = JSON.parse(await readFile(join(directory, 'health', 'health.json'), 'utf8')); assert.equal(snapshot.counters.dossiersGenerated, 1);
    const replay = new SupportAnalystRuntime({ ...base, runtimeDir: directory, source: source([technical]), clock });
    await replay.start(); const replayResult = await replay.runOnce(); await replay.stop();
    assert.equal(replayResult.dossiersGenerated, 0); assert.equal(JSON.parse(await readFile(join(directory, 'review-queue.json'), 'utf8')).items.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source failure records health and never commits a watermark', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sa-runtime-source-failure-'));
  try {
    const runtime = new SupportAnalystRuntime({ ...base, runtimeDir: directory, source: { preflight: async () => undefined, read: async () => { throw Object.assign(new Error('timeout'), { kind: 'timeout' }); } }, clock });
    await runtime.start(); const result = await runtime.runOnce(); await runtime.stop();
    assert.equal(result.outcome, 'SOURCE_FAILURE'); await assert.rejects(readFile(join(directory, 'state', 'source-watermark.json'), 'utf8'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty cycles are healthy idle, do not overlap, and LLM failures preserve the deterministic dossier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sa-runtime-idle-'));
  try {
    const idle = new SupportAnalystRuntime({ ...base, runtimeDir: directory, source: source([]), clock }); await idle.start(); const result = await idle.runOnce(); assert.equal(result.outcome, 'COMPLETED'); assert.equal(idle.healthTracker().snapshot().processing.status, 'HEALTHY'); await idle.stop();
    const llmDir = await mkdtemp(join(tmpdir(), 'sa-runtime-llm-'));
    try {
      const runtime = new SupportAnalystRuntime({ ...base, runtimeDir: llmDir, source: source([technical]), clock, llm: { ...base.llm, enabled: true }, analyzer: { analyze: async () => { throw new Error('ollama unavailable'); } } });
      await runtime.start(); const complete = await runtime.runOnce(); await runtime.stop(); assert.equal(complete.outcome, 'COMPLETED'); assert.equal(complete.dossiersGenerated, 1); assert.equal(complete.llmEnriched, 0);
    } finally { await rm(llmDir, { recursive: true, force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
