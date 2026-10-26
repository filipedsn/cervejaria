import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, historySample, infraView, parseBytes, parsePair, pushSample, upFor } from './infra.mjs';

const NOW_S = Date.parse('2026-10-26T19:10:00Z') / 1000;
const GIB = 1024 ** 3;

const report = (over = {}) => ({
  now: NOW_S,
  disk_pct: 10,
  host: { cpus: 4, cpu_pct: 2, load: [0.06, 0.1, 0.16], mem_total: 16 * GIB, mem_avail: 12 * GIB, disk_total: 200 * GIB, disk_used: 20 * GIB, uptime_s: 2 * 86400 + 3600 },
  containers: [
    { name: 'kibana', image: 'kibana:8', status: 'running', health: 'healthy', started: '2026-10-24T20:41:19Z', restarts: 0, cpu: '2.00%', mem: '582.2MiB / 15.61GiB', net: '456MB / 3.61GB' },
    { name: 'cervejaria-api', image: 'quiver-tap-api:staging', status: 'running', health: 'healthy', started: '2026-10-26T19:02:53Z', restarts: 0, cpu: '0.40%', mem: '110.9MiB / 15.61GiB', net: '0B / 0B' },
    { name: 'cervejaria-db', image: 'postgres:16-alpine', status: 'running', health: 'healthy', started: '2026-10-24T20:29:59Z', restarts: 1, cpu: '0.00%', mem: '75.71MiB / 15.61GiB', net: '18.7MB / 66.1MB' },
  ],
  ...over,
});

test('tamanhos do docker stats: binário, decimal e inválido', () => {
  assert.equal(parseBytes('0B'), 0);
  assert.equal(parseBytes('1.5KiB'), 1536);
  assert.equal(parseBytes('78.3MB'), 78_300_000);
  assert.equal(parseBytes('1.937GiB'), Math.round(1.937 * GIB));
  assert.equal(parseBytes('--'), null);
  assert.deepEqual(parsePair('18.7MB / 66.1MB'), [18_700_000, 66_100_000]);
  assert.deepEqual(parsePair(null), [null, null]);
});

test('formatação para a tela: bytes e duração', () => {
  assert.equal(formatBytes(110.9 * 1024 ** 2), '111 MB');
  assert.equal(formatBytes(1.937 * GIB), '1,9 GB');
  assert.equal(formatBytes(null), '—');
  assert.equal(upFor(4 * 60), '4 min');
  assert.equal(upFor(47 * 3600), '47 h');
  assert.equal(upFor(3 * 86400), '3 dias');
});

test('infra: medidores do servidor e contêineres na ordem de importância', () => {
  const v = infraView(report());
  assert.equal(v.spec, '4 vCPUs · 16 GB de memória · 200 GB de disco');
  assert.equal(v.uptime, '2 dias');
  const [cpu, mem, disk] = v.gauges;
  assert.deepEqual([cpu.pct, cpu.level], [2, 'ok']);
  assert.deepEqual([mem.pct, mem.detail], [25, '4 GB de 16 GB']);
  assert.deepEqual([disk.pct, disk.level], [10, 'ok']);
  assert.deepEqual(v.containers.map((c) => c.name), ['cervejaria-api', 'cervejaria-db', 'kibana']);
  const api = v.containers[0];
  assert.equal(api.label, 'Sistema (API)');
  assert.equal(api.statusText, 'saudável');
  assert.equal(api.cpuPct, 0.1);
  assert.equal(api.net, null);
  assert.equal(api.upText, 'no ar há 7 min');
  assert.equal(v.containers[1].restarts, 1);
  assert.deepEqual(v.containers[1].net, { rx: '17,8 MB', tx: '63 MB' });
  assert.equal(v.summary, '3, todos funcionando');
  assert.deepEqual(v.issues, []);
});

test('infra: essencial parado é problema; memória alta vira atenção', () => {
  const r = report();
  r.containers[2] = { ...r.containers[2], status: 'exited', health: '', exit_code: 137 };
  r.containers[0] = { ...r.containers[0], status: 'running', health: 'unhealthy' };
  r.host.mem_avail = GIB;
  const v = infraView(r);
  const db = v.containers.find((c) => c.name === 'cervejaria-db');
  assert.deepEqual([db.level, db.statusText, db.upText, db.memText], ['bad', 'parado', 'parado (código 137)', '—']);
  assert.equal(v.containers.find((c) => c.name === 'kibana').level, 'warn');
  assert.equal(v.gauges[1].level, 'bad');
  assert.deepEqual(v.issues, ['Banco de dados parado', 'Kibana com problema', 'memória 94% usada']);
  assert.equal(v.summary, '2 de 3 com atenção');
});

test('infra: relatório antigo (sem host) não tem medidores', () => {
  assert.equal(infraView({ now: NOW_S, disk_pct: 10, api: {}, db: {} }), null);
});

test('histórico: uma leitura por minuto, só a última hora', () => {
  const at = (t, cpu = 1) => ({ now: t, host: { cpu_pct: cpu, mem_total: 100, mem_avail: 75 } });
  assert.deepEqual(historySample(at(NOW_S, 3)), { t: NOW_S, cpu: 3, mem: 25 });
  assert.equal(historySample({ now: NOW_S }), null);
  let h = [];
  h = pushSample(h, historySample(at(NOW_S - 3700)));
  h = pushSample(h, historySample(at(NOW_S - 120)));
  const same = pushSample(h, historySample(at(NOW_S - 100)));
  assert.equal(same, h, 'menos de ~1 min depois: ignora');
  h = pushSample(h, historySample(at(NOW_S)));
  assert.deepEqual(h.map((s) => s.t), [NOW_S - 120, NOW_S]);
  assert.deepEqual(infraView(report(), h).gauges[0].series, [1, 1]);
});
