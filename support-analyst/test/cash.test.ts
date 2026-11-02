import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WatchConfig } from '../src/config.js';
import { readCashNoticeConfig } from '../src/config.js';
import { PRD_INDICES } from '../src/sources/constants.js';
import { buildCashQuery, CashNotices, cashNoticeFromHit, emptyWatchState, WatchRunner, WatchStateStore, type WatchElasticReader } from '../src/watch/index.js';

type Hit = { _source: Record<string, unknown> };

function hit(id: string, at: string, action: string, extra: Record<string, unknown> = {}): Hit {
  return {
    _source: {
      '@timestamp': at,
      attributes: {
        'event.id': id,
        'event.action': action,
        'event.outcome': 'success',
        'cervejaria.slug': 'cervejaria-alfa',
        'cervejaria.id': 't1',
        'user.name': 'Maria Operadora',
        'user.email': 'maria@example.com',
        'client.address': '203.0.113.9',
        metadata: { empresaNome: 'Cervejaria Alfa', pontoVendaNome: 'Balcão', trocoInicial: 150, ...extra },
      },
    },
  };
}

function fakeSearch(pages: Hit[][]) {
  const bodies: Array<Record<string, unknown>> = [];
  return {
    bodies,
    searchRaw: async (_index: string, body: unknown) => {
      bodies.push(body as Record<string, unknown>);
      return { hits: { hits: pages.shift() ?? [] } };
    },
  };
}

function fakeSender() {
  const sent: string[] = [];
  return { sent, send: async (_kind: string, text: string) => { sent.push(text); }, flushPending: async () => undefined };
}

test('aviso de abertura: empresa, unidade, operador e hora de Brasília; nada além disso', () => {
  const notice = cashNoticeFromHit(hit('e1', '2026-11-01T21:02:10.000Z', 'transacao.cash_register_opened', { abertoEm: '2026-11-01T21:02:05.000Z' })._source);
  assert.ok(notice);
  assert.equal(notice.id, 'e1');
  assert.equal(notice.text, '[CAIXA] 🟢 Caixa aberto\nEmpresa: Cervejaria Alfa\nUnidade: Balcão\nPor: Maria Operadora\nQuando: 01/11/2026, 18:02 (Brasília)');
  assert.doesNotMatch(notice.text, /maria@|203\.0\.113|150/);
});

test('metadata como texto JSON (formato do exportador OTLP) também é lido', () => {
  const raw = hit('e5', '2026-11-01T21:02:10.000Z', 'transacao.cash_register_opened', { abertoEm: '2026-11-01T21:02:05.000Z' });
  const attributes = raw._source.attributes as Record<string, unknown>;
  attributes.metadata = JSON.stringify(attributes.metadata);
  assert.match(cashNoticeFromHit(raw._source)!.text, /Empresa: Cervejaria Alfa\nUnidade: Balcão\nPor: Maria Operadora\nQuando: 01\/11\/2026, 18:02/);
  attributes.metadata = '{quebrado';
  assert.match(cashNoticeFromHit(raw._source)!.text, /Empresa: cervejaria-alfa/);
});

test('fechamento usa o fechadoEm informado; sem nomes no registro cai no slug', () => {
  const closed = cashNoticeFromHit(hit('e2', '2026-11-02T03:30:00.000Z', 'transacao.cash_register_closed', { fechadoEm: '2026-11-02T02:15:00.000Z' })._source);
  assert.match(closed!.text, /^\[CAIXA\] 🔴 Caixa fechado/);
  assert.match(closed!.text, /Quando: 01\/11\/2026, 23:15 \(Brasília\)/);
  const old = hit('e3', '2026-11-02T03:30:00.000Z', 'transacao.cash_register_administrative_closed');
  (old._source.attributes as Record<string, unknown>).metadata = {};
  delete (old._source.attributes as Record<string, unknown>)['user.name'];
  assert.equal(cashNoticeFromHit(old._source)!.text, '[CAIXA] 🟠 Caixa encerrado administrativamente\nEmpresa: cervejaria-alfa\nQuando: 02/11/2026, 00:30 (Brasília)');
});

test('caixa de evento e outras ações não geram aviso', () => {
  assert.equal(cashNoticeFromHit(hit('e4', '2026-11-01T21:00:00.000Z', 'transacao.evento_caixa_aberto')._source), undefined);
  const query = JSON.stringify(buildCashQuery(new Date('2026-11-01T20:00:00Z'), new Date('2026-11-01T21:00:00Z')));
  assert.doesNotMatch(query, /evento_caixa/);
  assert.match(query, /test\.synthetic/);
});

test('primeira execução só marca o ponto de partida; depois avisa cada evento uma vez', async () => {
  const state = emptyWatchState();
  const search = fakeSearch([
    [hit('e1', '2026-11-01T21:02:00.000Z', 'transacao.cash_register_opened')],
    [hit('e1', '2026-11-01T21:02:00.000Z', 'transacao.cash_register_opened'), hit('e2', '2026-11-01T21:05:00.000Z', 'transacao.cash_register_closed')],
  ]);
  const sender = fakeSender();
  const cash = new CashNotices({ elastic: search, auditIndex: PRD_INDICES.audit, sender });
  assert.deepEqual(await cash.run(state, new Date('2026-11-01T21:00:00.000Z')), []);
  assert.equal(search.bodies.length, 0);
  assert.deepEqual(await cash.run(state, new Date('2026-11-01T21:03:00.000Z')), ['CAIXA:e1']);
  assert.deepEqual(await cash.run(state, new Date('2026-11-01T21:06:00.000Z')), ['CAIXA:e2']);
  assert.equal(sender.sent.length, 2);
  const range = (search.bodies[1]!.query as { bool: { filter: Array<{ range?: { '@timestamp': { gte: string } } }> } }).bool.filter[0]!.range!['@timestamp'];
  assert.equal(range.gte, '2026-11-01T20:53:00.000Z');
});

test('depois de muito tempo parado, só o último dia é lido', async () => {
  const state = { ...emptyWatchState(), cash: { since: '2026-10-20T00:00:00.000Z', seen: {} } };
  const search = fakeSearch([[]]);
  await new CashNotices({ elastic: search, auditIndex: PRD_INDICES.audit, sender: fakeSender() }).run(state, new Date('2026-11-01T21:00:00.000Z'));
  const range = (search.bodies[0]!.query as { bool: { filter: Array<{ range?: { '@timestamp': { gte: string } } }> } }).bool.filter[0]!.range!['@timestamp'];
  assert.equal(range.gte, '2026-10-31T21:00:00.000Z');
  assert.equal(state.cash.since, '2026-11-01T21:00:00.000Z');
});

test('página cheia continua do último evento lido no ciclo seguinte', async () => {
  const page = Array.from({ length: 50 }, (_, i) => hit(`p${i}`, new Date(Date.parse('2026-11-01T20:00:00.000Z') + i * 1000).toISOString(), 'transacao.cash_register_opened'));
  const state = { ...emptyWatchState(), cash: { since: '2026-11-01T20:00:00.000Z', seen: {} } };
  const sender = fakeSender();
  await new CashNotices({ elastic: fakeSearch([page]), auditIndex: PRD_INDICES.audit, sender }).run(state, new Date('2026-11-01T21:00:00.000Z'));
  assert.equal(sender.sent.length, 50);
  assert.equal(state.cash.since, page[49]!._source['@timestamp']);
});

test('config: ligado por padrão, cota própria validada', () => {
  assert.deepEqual(readCashNoticeConfig({}), { ok: true, config: { enabled: true, maxPerHour: 60 } });
  assert.deepEqual(readCashNoticeConfig({ SUPPORT_ANALYST_CASH_NOTICES: 'false', SUPPORT_ANALYST_CASH_MAX_PER_HOUR: '10' }), { ok: true, config: { enabled: false, maxPerHour: 10 } });
  assert.equal(readCashNoticeConfig({ SUPPORT_ANALYST_CASH_MAX_PER_HOUR: '0' }).ok, false);
});

test('no ciclo do plantão: avisa mesmo na janela pós-boot e falha do caixa não derruba o ciclo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cash-'));
  try {
    const config: WatchConfig = { enabled: true, publicUrl: 'https://tap.example.test', networkCheckUrl: 'https://net.example.test/trace', freshnessMaxMinutes: 10, errorLogThreshold: 20, reminderMinutes: 60, digestHour: 23, intervalMs: 60_000, bootQuietMinutes: 10 };
    const clock = { now: new Date('2026-11-01T21:00:00.000Z') };
    const fetchImpl = async (url: string): Promise<Response> => (url.endsWith('/api/health') ? new Response(JSON.stringify({ releaseSha: 'abc1234' }), { status: 200 }) : new Response('ok', { status: 200 }));
    const elastic: WatchElasticReader = {
      indexNames: () => PRD_INDICES,
      latestTimestamp: async () => clock.now.toISOString(),
      countLastMinutes: async () => 0,
    };
    const sent: string[] = [];
    const notifications = { send: async (_kind: string, text: string) => { sent.push(text); }, flushPending: async () => undefined };
    let calls = 0;
    const cash = { run: async () => { calls += 1; if (calls === 2) throw new Error('es down'); return ['CAIXA:x']; } };
    const runner = new WatchRunner({ config, elastic, notifications, store: new WatchStateStore(dir), fetchImpl, now: () => clock.now, environment: 'prd', bootTime: clock.now, cash });
    assert.deepEqual((await runner.runCycle()).notified, ['CAIXA:x']);
    clock.now = new Date(clock.now.getTime() + 60_000);
    const second = await runner.runCycle();
    assert.equal(second.skipped, false);
    assert.deepEqual(second.notified, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
