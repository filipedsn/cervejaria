import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HealthEvaluator, HealthStore, HealthTracker, checkExternalHealth, emptyHealthCounters, type HealthEvaluationInput } from '../src/index.js';

const now = new Date('2026-09-02T12:00:00.000Z');
const at = (milliseconds: number) => new Date(now.getTime() - milliseconds).toISOString();
function input(overrides: Partial<HealthEvaluationInput> = {}): HealthEvaluationInput {
  return { now, startedAt: at(10), heartbeatAt: at(10), elasticConfigured: true, lastElasticReadAt: at(10), lastElasticReadSucceededAt: at(10), lastCycleStartedAt: at(20), lastCycleCompletedAt: at(10), llmEnabled: false, counters: emptyHealthCounters(), heartbeatStaleMs: 90_000, processingStaleMs: 300_000, ...overrides };
}
test('health evaluator reports a healthy idle core and disabled LLM as healthy', () => {
  const snapshot = new HealthEvaluator().evaluate(input());
  assert.equal(snapshot.overall, 'HEALTHY'); assert.equal(snapshot.llm.status, 'HEALTHY'); assert.equal(snapshot.quality.status, 'UNKNOWN'); assert.equal(snapshot.deterministicShadowReady, true); assert.equal(snapshot.llmShadowReady, false);
});
test('heartbeat and an unfinished stale cycle are unhealthy', () => {
  const heartbeat = new HealthEvaluator().evaluate(input({ heartbeatAt: at(90_001) }));
  assert.equal(heartbeat.process.status, 'UNHEALTHY'); assert.ok(heartbeat.reasons.some((r) => r.code === 'HEARTBEAT_STALE'));
  const stuck = new HealthEvaluator().evaluate(input({ lastCycleStartedAt: at(300_001), lastCycleCompletedAt: at(400_000) }));
  assert.equal(stuck.processing.status, 'UNHEALTHY'); assert.ok(stuck.reasons.some((r) => r.code === 'PROCESSING_STALLED'));
});
test('elastic distinguishes recent transient failure from stale failure', () => {
  const transient = new HealthEvaluator().evaluate(input({ lastElasticError: 'timeout' })); assert.equal(transient.elastic.status, 'DEGRADED'); assert.equal(transient.overall, 'DEGRADED');
  const stale = new HealthEvaluator().evaluate(input({ lastElasticReadSucceededAt: at(300_001) })); assert.equal(stale.elastic.status, 'UNHEALTHY');
});
test('LLM unavailability only degrades overall and quality rates are conservative', () => {
  const unavailable = new HealthEvaluator().evaluate(input({ llmEnabled: true, llmReachable: false })); assert.equal(unavailable.llm.status, 'UNHEALTHY'); assert.equal(unavailable.overall, 'DEGRADED');
  const counters = emptyHealthCounters(); counters.llmAttempts = 4; counters.llmTimeouts = 1; counters.llmFallbacks = 2;
  const quality = new HealthEvaluator().evaluate(input({ llmEnabled: true, llmReachable: true, llmModelAvailable: true, counters })); assert.equal(quality.quality.status, 'DEGRADED');
});
test('tracker persists atomic heartbeat and snapshot without secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sa-health-'));
  try {
    const store = new HealthStore(dir); const tracker = new HealthTracker(store, { enabled: true, heartbeatIntervalMs: 30_000, heartbeatStaleMs: 90_000, snapshotStaleMs: 120_000, processingStaleMs: 300_000 }, { enabled: false, endpoint: 'http://127.0.0.1:11434', model: 'gemma4:12b', timeoutMs: 1, numCtx: 1, keepAlive: '5m' }, true, { now: () => now });
    await tracker.start(); tracker.cycleStarted(); tracker.elasticReadSucceeded(); tracker.cycleCompleted({ eventsRead: 0, eventsNormalized: 0, durationMs: 1 }); await tracker.stop(false);
    const raw = await readFile(store.snapshotPath, 'utf8'); assert.ok(raw.includes('"overall": "HEALTHY"')); assert.ok(!/authorization|api.?key|password/i.test(raw));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('health write failure is fail-soft for the processing tracker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sa-health-failsoft-'));
  try {
    const store = new HealthStore(dir); store.writeHeartbeat = async () => { throw new Error('disk unavailable'); };
    const tracker = new HealthTracker(store, { enabled: true, heartbeatIntervalMs: 30_000, heartbeatStaleMs: 90_000, snapshotStaleMs: 120_000, processingStaleMs: 300_000 }, { enabled: false, endpoint: 'http://127.0.0.1:11434', model: 'gemma4:12b', timeoutMs: 1, numCtx: 1, keepAlive: '5m' }, true, { now: () => now });
    await tracker.start(); tracker.cycleStarted(); tracker.cycleCompleted({ eventsRead: 2, eventsNormalized: 2, durationMs: 1 });
    assert.equal(tracker.healthCounters().eventsRead, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('external checker has documented healthy, degraded, unhealthy and unknown exit codes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sa-health-check-')); const store = new HealthStore(dir);
  try {
    const evaluator = new HealthEvaluator(); const healthy = evaluator.evaluate(input()); await store.writeHeartbeat({ schemaVersion: 1, processStartedAt: at(1), heartbeatAt: at(1), version: 'test' }); await store.writeSnapshot(healthy);
    assert.equal((await checkExternalHealth(dir, { heartbeatStaleMs: 90_000, snapshotStaleMs: 120_000, now })).exitCode, 0);
    await store.writeSnapshot({ ...healthy, overall: 'DEGRADED' }); assert.equal((await checkExternalHealth(dir, { heartbeatStaleMs: 90_000, snapshotStaleMs: 120_000, now })).exitCode, 1);
    assert.equal((await checkExternalHealth(dir, { heartbeatStaleMs: 1, snapshotStaleMs: 1, now: new Date(now.getTime() + 2) })).exitCode, 2);
    assert.equal((await checkExternalHealth(undefined, { heartbeatStaleMs: 1, snapshotStaleMs: 1, now })).exitCode, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
