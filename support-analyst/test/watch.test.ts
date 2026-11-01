import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WatchConfig } from '../src/config.js';
import { PRD_INDICES } from '../src/sources/constants.js';
import { ElasticSourceError } from '../src/sources/elastic.js';
import { ageMinutes, backoffDelayMs, brasiliaParts, elasticPing, FileLock, inBootQuietWindow, machineBootTime, waitForElastic, WatchRunner, WatchStateStore, type WatchElasticReader } from '../src/watch/index.js';

const baseConfig: WatchConfig = { enabled: true, publicUrl: 'https://tap.example.test', networkCheckUrl: 'https://net.example.test/trace', freshnessMaxMinutes: 10, errorLogThreshold: 20, reminderMinutes: 60, digestHour: 23, intervalMs: 60_000, bootQuietMinutes: 10 };
type Sent = { kind: string; text: string; detectorId?: string };
type World = { network: boolean; site: boolean; release: string; latestAgeMinutes: number; esError?: ElasticSourceError; errors: number };
type Clock = { now: Date };

const healthy = (): World => ({ network: true, site: true, release: 'abc1234def', latestAgeMinutes: 1, errors: 0 });

function setup(dir: string, world: World, clock: Clock, config: WatchConfig = baseConfig, bootTime?: Date) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    if (url.startsWith('https://net.example.test')) {
      if (!world.network) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    }
    if (url.endsWith('/api/ready')) return new Response('{}', { status: world.site ? 200 : 503 });
    if (url.endsWith('/api/health')) return new Response(JSON.stringify({ releaseSha: world.release }), { status: 200 });
    throw new Error(`unexpected url: ${url}`);
  };
  const elastic: WatchElasticReader = {
    indexNames: () => PRD_INDICES,
    latestTimestamp: async () => {
      if (world.esError) throw world.esError;
      return new Date(clock.now.getTime() - world.latestAgeMinutes * 60_000).toISOString();
    },
    countLastMinutes: async () => {
      if (world.esError) throw world.esError;
      return world.errors;
    },
    errorContext: async () => ({ routes: [{ route: '/api/comandas/123', count: 30 }], correlationIds: ['corr-abc-1'] }),
  };
  const notifications = {
    send: async (kind: string, text: string, detectorId?: string) => { sent.push({ kind, text, detectorId }); },
    flushPending: async () => undefined,
  };
  const runner = new WatchRunner({ config, elastic, notifications, store: new WatchStateStore(dir), fetchImpl, now: () => clock.now, environment: 'prd', bootTime });
  return { runner, sent };
}

async function cycles(runner: WatchRunner, clock: Clock, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await runner.runCycle();
    clock.now = new Date(clock.now.getTime() + 60_000);
  }
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'watch-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('site down for 3 cycles fires SEV1 once and 2 good cycles resolve it', () => withDir(async (dir) => {
  const world = { ...healthy(), site: false };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 4);
  const firing = sent.filter((s) => s.kind === 'FIRING' && s.detectorId === 'public-site-down');
  assert.equal(firing.length, 1);
  assert.match(firing[0]!.text, /^\[ANALISTA\] .*SEV1 — Site fora do ar/);
  world.site = true;
  await cycles(runner, clock, 2);
  assert.equal(sent.filter((s) => s.kind === 'RESOLVED' && s.detectorId === 'public-site-down').length, 1);
}));

test('PC network down skips the cycle and notifies nothing', () => withDir(async (dir) => {
  const world = { ...healthy(), network: false, site: false, latestAgeMinutes: 999 };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  for (let i = 0; i < 5; i += 1) {
    const result = await runner.runCycle();
    assert.equal(result.skipped, true);
    clock.now = new Date(clock.now.getTime() + 60_000);
  }
  assert.equal(sent.length, 0);
}));

test('401 from Elastic fires elastic-auth-failed immediately', () => withDir(async (dir) => {
  const world = { ...healthy(), esError: new ElasticSourceError('unauthorized', 'Elasticsearch rejected the request') };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 1);
  assert.deepEqual(sent.map((s) => s.detectorId), ['elastic-auth-failed']);
}));

test('site down holds the api-telemetry-stale notification', () => withDir(async (dir) => {
  const world = { ...healthy(), site: false, latestAgeMinutes: 30 };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 3);
  const ids = sent.filter((s) => s.kind === 'FIRING').map((s) => s.detectorId);
  assert.equal(ids.includes('public-site-down'), true);
  assert.equal(ids.includes('api-telemetry-stale'), false);
}));

test('reminder after the configured minutes', () => withDir(async (dir) => {
  const world = { ...healthy(), site: false };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 3);
  clock.now = new Date(clock.now.getTime() + 60 * 60_000);
  await runner.runCycle();
  assert.equal(sent.filter((s) => s.kind === 'REMINDER' && s.detectorId === 'public-site-down').length, 1);
}));

test('state persists between two runner instances', () => withDir(async (dir) => {
  const world = { ...healthy(), site: false };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const first = setup(dir, world, clock);
  await cycles(first.runner, clock, 2);
  const second = setup(dir, world, clock);
  await cycles(second.runner, clock, 1);
  assert.equal(first.sent.length, 0);
  assert.equal(second.sent.filter((s) => s.kind === 'FIRING' && s.detectorId === 'public-site-down').length, 1);
}));

test('a new release produces one INFO message', () => withDir(async (dir) => {
  const world = healthy();
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 1);
  world.release = 'def4567abc';
  await cycles(runner, clock, 1);
  const info = sent.filter((s) => s.kind === 'INFO');
  assert.equal(info.length, 1);
  assert.match(info[0]!.text, /Nova versão no ar: def4567/);
}));

test('error log surge fires SEV3 with route templates, correlationId and the journey command', () => withDir(async (dir) => {
  const world = { ...healthy(), errors: 50 };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock, { ...baseConfig, kibanaUrl: 'https://kibana.example.test' });
  await cycles(runner, clock, 1);
  const surge = sent.filter((s) => s.detectorId === 'error-log-surge');
  assert.equal(surge.length, 1);
  assert.match(surge[0]!.text, /SEV3/);
  assert.match(surge[0]!.text, /\/api\/comandas\/:id \(30\)/);
  assert.match(surge[0]!.text, /--correlacao corr-abc-1 --env prd/);
  assert.match(surge[0]!.text, /Kibana: https:\/\/kibana\.example\.test\/app\/discover/);
}));

test('daily digest is sent once per Brasilia day after the configured hour', () => withDir(async (dir) => {
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, healthy(), clock, { ...baseConfig, digestHour: 8 });
  await cycles(runner, clock, 2);
  clock.now = new Date('2026-10-28T15:00:00.000Z');
  await cycles(runner, clock, 1);
  const digests = sent.filter((s) => s.kind === 'DIGEST');
  assert.equal(digests.length, 2);
  assert.match(digests[0]!.text, /Resumo diário/);
}));

test('post-boot quiet window holds FIRING; the alert goes out once the window ends', () => withDir(async (dir) => {
  const world = { ...healthy(), site: false };
  const boot = new Date('2026-10-27T15:00:00.000Z');
  const clock = { now: new Date('2026-10-27T15:01:00.000Z') };
  const { runner, sent } = setup(dir, world, clock, baseConfig, boot);
  await cycles(runner, clock, 5);
  assert.equal(sent.filter((s) => s.kind === 'FIRING').length, 0);
  clock.now = new Date('2026-10-27T15:11:00.000Z');
  const result = await runner.runCycle();
  assert.equal(result.quiet, false);
  assert.equal(sent.filter((s) => s.kind === 'FIRING' && s.detectorId === 'public-site-down').length, 1);
}));

test('brasiliaParts converts UTC to Brasilia', () => {
  assert.deepEqual(brasiliaParts(new Date('2026-10-27T02:30:00.000Z')), { date: '2026-10-26', hour: 23 });
});

test('ageMinutes accepts the OTel epoch-millis text and ISO', () => {
  const now = new Date(1793059738435 + 5 * 60_000);
  assert.equal(ageMinutes('1793059738435.0', now), 5);
  assert.equal(ageMinutes('1793059738435.931720', now), 5);
  assert.equal(ageMinutes(new Date(1793059738435).toISOString(), now), 5);
  assert.equal(ageMinutes('lixo', now), undefined);
});

test('backoff is 5s, 10s, 30s, 60s and then 60s fixed', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(backoffDelayMs), [5_000, 10_000, 30_000, 60_000, 60_000, 60_000, 60_000]);
  assert.equal(backoffDelayMs(-1), 5_000);
});

test('boot time and quiet window come from uptime', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const boot = machineBootTime(now, 300);
  assert.equal(boot.toISOString(), '2026-11-01T11:55:00.000Z');
  assert.equal(inBootQuietWindow(now, boot, 10), true);
  assert.equal(inBootQuietWindow(new Date('2026-11-01T12:05:00.000Z'), boot, 10), false);
  assert.equal(inBootQuietWindow(now, boot, 0), false);
});

test('waitForElastic retries with backoff inside the quiet window and records "aguardando rede"', () => withDir(async (dir) => {
  const store = new WatchStateStore(dir);
  const boot = new Date('2026-11-01T12:00:00.000Z');
  const clock = { now: new Date('2026-11-01T12:00:30.000Z') };
  const sleeps: number[] = [];
  const answers = [false, false, false, true];
  let stateDuringWait: unknown;
  const result = await waitForElastic({
    ping: async () => ({ reachable: answers.shift() ?? true, detail: 'Elastic: request_failed' }),
    store, bootTime: boot, quietMinutes: 10, now: () => clock.now,
    sleep: async (ms) => { sleeps.push(ms); stateDuringWait ??= (await store.load()).waiting?.status; clock.now = new Date(clock.now.getTime() + ms); },
  });
  assert.deepEqual(result, { ready: true, attempts: 4 });
  assert.deepEqual(sleeps, [5_000, 10_000, 30_000]);
  assert.equal(stateDuringWait, 'aguardando rede');
  assert.equal((await store.load()).waiting?.status, 'pronto');
}));

test('waitForElastic hands over to the loop once the quiet window is over', () => withDir(async (dir) => {
  const store = new WatchStateStore(dir);
  const boot = new Date('2026-11-01T12:00:00.000Z');
  const clock = { now: new Date('2026-11-01T12:09:50.000Z') };
  const sleeps: number[] = [];
  const result = await waitForElastic({
    ping: async () => ({ reachable: false, detail: 'Elastic: timeout' }),
    store, bootTime: boot, quietMinutes: 10, now: () => clock.now,
    sleep: async (ms) => { sleeps.push(ms); clock.now = new Date(clock.now.getTime() + ms); },
  });
  assert.deepEqual(result, { ready: false, attempts: 3 });
  assert.deepEqual(sleeps, [5_000, 10_000]);
  assert.equal((await store.load()).waiting?.status, 'desistiu (janela pós-boot encerrada)');
}));

test('elasticPing treats any HTTP answer as reachable and network errors as not', async () => {
  const reader = (error?: Error) => ({ indexNames: () => PRD_INDICES, latestTimestamp: async () => { if (error) throw error; return undefined; } });
  assert.equal((await elasticPing(reader())()).reachable, true);
  assert.equal((await elasticPing(reader(new ElasticSourceError('unauthorized', 'x')))()).reachable, true);
  assert.equal((await elasticPing(reader(new ElasticSourceError('request_failed', 'Elasticsearch request failed with HTTP 503')))()).reachable, true);
  assert.equal((await elasticPing(reader(new ElasticSourceError('request_failed', 'Elasticsearch request failed')))()).reachable, false);
  assert.equal((await elasticPing(reader(new ElasticSourceError('timeout', 'x')))()).reachable, false);
});

test('watch lock replaces a lock from a dead process and refuses a live one', () => withDir(async (dir) => {
  const path = join(dir, 'watch', 'watch.lock');
  const first = new FileLock(path);
  await first.acquire();
  await assert.rejects(new FileLock(path).acquire(), /Watch lock in use/);
  await first.release();
  await writeFile(path, '2147483646');
  const second = new FileLock(path);
  await second.acquire();
  await second.release();
}));
