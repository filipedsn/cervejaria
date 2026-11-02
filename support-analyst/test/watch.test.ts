import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WatchConfig } from '../src/config.js';
import { PRD_INDICES } from '../src/sources/constants.js';
import { ElasticSourceError } from '../src/sources/elastic.js';
import { ageMinutes, backoffDelayMs, brasiliaParts, ElasticHeartbeat, elasticPing, FileLock, inBootQuietWindow, machineBootTime, readHeartbeatConfig, waitForElastic, WatchRunner, WatchStateStore, type HeartbeatDoc, type HeartbeatSender, type WatchElasticReader } from '../src/watch/index.js';

const baseConfig: WatchConfig = { enabled: true, publicUrl: 'https://tap.example.test', networkCheckUrl: 'https://net.example.test/trace', freshnessMaxMinutes: 10, errorLogThreshold: 20, reminderMinutes: 60, digestHour: 23, intervalMs: 60_000, bootQuietMinutes: 10 };
type Sent = { kind: string; text: string; detectorId?: string };
type World = { network: boolean; site: boolean; release: string; latestAgeMinutes: number; esError?: ElasticSourceError; errors: number; poller?: { status: string; health: string } | 'none' };
type Clock = { now: Date };

const healthy = (): World => ({ network: true, site: true, release: 'abc1234def', latestAgeMinutes: 1, errors: 0 });

function setup(dir: string, world: World, clock: Clock, config: WatchConfig = baseConfig, bootTime?: Date, heartbeat?: HeartbeatSender) {
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
    ...(world.poller === undefined ? {} : {
      latestContainerState: async () => (world.poller === 'none' || world.poller === undefined ? undefined : { timestamp: clock.now.toISOString(), ...world.poller }),
    }),
  };
  const notifications = {
    send: async (kind: string, text: string, detectorId?: string) => { sent.push({ kind, text, detectorId }); },
    flushPending: async () => undefined,
  };
  const runner = new WatchRunner({ config, elastic, notifications, store: new WatchStateStore(dir), fetchImpl, now: () => clock.now, environment: 'prd', bootTime, heartbeat });
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

test('unhealthy alert poller fires alert-path-unhealthy once and a healthy poller resolves it', () => withDir(async (dir) => {
  const world: World = { ...healthy(), poller: { status: 'running', health: 'unhealthy' } };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 4);
  const firing = sent.filter((s) => s.kind === 'FIRING' && s.detectorId === 'alert-path-unhealthy');
  assert.equal(firing.length, 1);
  assert.match(firing[0]!.text, /Caminho de alertas parado/);
  world.poller = { status: 'running', health: 'healthy' };
  await cycles(runner, clock, 2);
  assert.equal(sent.filter((s) => s.kind === 'RESOLVED' && s.detectorId === 'alert-path-unhealthy').length, 1);
}));

test('stale collector holds the alert-path-unhealthy notification', () => withDir(async (dir) => {
  const world: World = { ...healthy(), latestAgeMinutes: 30, poller: 'none' };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner, sent } = setup(dir, world, clock);
  await cycles(runner, clock, 4);
  const ids = sent.filter((s) => s.kind === 'FIRING').map((s) => s.detectorId);
  assert.equal(ids.includes('collector-telemetry-stale'), true);
  assert.equal(ids.includes('alert-path-unhealthy'), false);
}));

test('remote heartbeat is optional and must use a dedicated key', () => {
  assert.deepEqual(readHeartbeatConfig({}, 'prd'), { ok: true });
  const same = readHeartbeatConfig({ SUPPORT_ANALYST_ES_URL: 'https://es.example.test', SUPPORT_ANALYST_ES_API_KEY: 'k1', SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY: 'k1' }, 'prd');
  assert.equal(same.ok, false);
  const missingUrl = readHeartbeatConfig({ SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY: 'k2' }, 'prd');
  assert.equal(missingUrl.ok, false);
  const ok = readHeartbeatConfig({ SUPPORT_ANALYST_ES_URL: 'https://es.example.test/', SUPPORT_ANALYST_ES_API_KEY: 'k1', SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY: 'k2' }, 'prd');
  assert.deepEqual(ok, { ok: true, config: { url: 'https://es.example.test', apiKey: 'k2', index: 'logs-support_analyst.heartbeat-prd' } });
});

test('ElasticHeartbeat posts a minimal document with the write key and never throws', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let status = 201;
  let fail = false;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (fail) throw new TypeError('fetch failed');
    return new Response('{}', { status });
  };
  const beat = new ElasticHeartbeat({ url: 'https://es.example.test', apiKey: 'k2', index: 'logs-support_analyst.heartbeat-prd' }, 'prd', fetchImpl);
  const now = new Date('2026-11-01T23:00:00.000Z');
  assert.equal(await beat.send({ firing: 1, skipped: false, quiet: false, releaseSha: 'abc1234' }, now), 'ok');
  assert.equal(calls[0]!.url, 'https://es.example.test/logs-support_analyst.heartbeat-prd/_doc');
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, 'ApiKey k2');
  const body = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['@timestamp', 'analyst.environment', 'analyst.firing', 'analyst.quiet', 'analyst.release_sha', 'analyst.skipped', 'event.dataset', 'service.name']);
  assert.equal(body['@timestamp'], now.toISOString());
  status = 403;
  assert.equal(await beat.send({ firing: 0, skipped: false, quiet: false }, now), 'failed');
  fail = true;
  assert.equal(await beat.send({ firing: 0, skipped: false, quiet: false }, now), 'failed');
});

test('runner sends one heartbeat per completed cycle, none when the PC network is down, and survives failures', () => withDir(async (dir) => {
  const beats: HeartbeatDoc[] = [];
  let result: 'ok' | 'failed' = 'ok';
  const heartbeat: HeartbeatSender = { send: async (doc) => { beats.push(doc); return result; } };
  const world = { ...healthy(), site: false };
  const clock = { now: new Date('2026-10-27T15:00:00.000Z') };
  const { runner } = setup(dir, world, clock, baseConfig, undefined, heartbeat);
  await cycles(runner, clock, 3);
  assert.equal(beats.length, 3);
  assert.equal(beats[2]!.firing, 1);
  world.network = false;
  await cycles(runner, clock, 2);
  assert.equal(beats.length, 3);
  world.network = true;
  result = 'failed';
  const cycle = await runner.runCycle();
  assert.equal(cycle.heartbeat, 'failed');
  assert.equal(beats.length, 4);
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
  await first.release();
  await writeFile(path, String(process.ppid));
  await assert.rejects(new FileLock(path).acquire(), /Watch lock in use/);
  await writeFile(path, '2147483646');
  const second = new FileLock(path);
  await second.acquire();
  await second.release();
}));

test('watch lock left with our own PID (container restart) is replaced', () => withDir(async (dir) => {
  const path = join(dir, 'watch', 'watch.lock');
  await mkdir(join(dir, 'watch'), { recursive: true });
  await writeFile(path, String(process.pid));
  const lock = new FileLock(path);
  await lock.acquire();
  await lock.release();
}));
