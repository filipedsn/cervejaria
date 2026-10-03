import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToScaledInteger, planPdvMigration, sumScaledDecimals, type PdvPlanningCompany } from './pdv-unico-migration-planner.js';

const fixture = (overrides: Partial<PdvPlanningCompany> = {}): PdvPlanningCompany => ({
  companyId: 'co-a', pdvIds: ['pdv-a'], trailerIds: ['trailer-a'],
  events: [{ id: 'event-series-1', trailerId: 'trailer-a', seriesId: 'series-a', recurrence: 'NENHUMA' }, { id: 'event-series-2', trailerId: 'trailer-a', seriesId: 'series-a', recurrence: 'NENHUMA' }, { id: 'event-other', trailerId: 'trailer-a', seriesId: 'series-b', recurrence: 'NENHUMA' }],
  commands: [
    { id: 'cmd-event', origin: 'EVENTO', eventId: 'event-series-1', pdvId: null },
    { id: 'cmd-stock-link', origin: 'EVENTO', eventId: 'event-series-1', pdvId: 'pdv-a' },
    { id: 'cmd-source', origin: 'CAIXA', eventId: null, pdvId: 'pdv-a' },
    { id: 'cmd-tenant', origin: 'CAIXA', eventId: null, pdvId: 'other-pdv', pdvTenantId: 'co-b' },
  ],
  balances: [{ id: 'bal-1', pdvId: 'pdv-a' }],
  payments: [{ id: 'pay-late', commandId: 'cmd-source', linkedCommandOrigin: 'CAIXA', receivableId: 'ar-late', paidAt: '2026-10-02', amount: '12.34' }, { id: 'pay-refund', commandId: 'cmd-source', linkedCommandOrigin: 'CAIXA', amount: '-0.03' }],
  receivables: [{ id: 'ar-late', commandId: 'cmd-source' }],
  ...overrides,
});

test('MANTER PDV único e mantém Event stock link como conflito investigável', () => {
  const rows = planPdvMigration(fixture());
  assert.equal(rows.find(x => x.sourceId === 'pdv-a')?.action, 'MANTER');
  const doubleLink = rows.find(x => x.sourceId === 'cmd-stock-link');
  assert.equal(doubleLink?.action, 'BLOQUEADO');
  assert.match(doubleLink?.evidence ?? '', /não prova conflito/);
  assert.equal(rows.find(x => x.sourceId === 'cmd-tenant')?.action, 'BLOQUEADO');
});

test('duas ocorrências da mesma recorrência e outra recorrência preservam origem por ID', () => {
  const rows = planPdvMigration(fixture());
  for (const id of ['event-series-1', 'event-series-2', 'event-other']) assert.equal(rows.find(x => x.sourceId === id)?.action, 'REASSOCIAR');
  assert.match(rows.find(x => x.sourceId === 'event-series-1')?.evidence ?? '', /agenda series-a/);
  assert.match(rows.find(x => x.sourceId === 'event-series-2')?.evidence ?? '', /agenda series-a/);
  assert.match(rows.find(x => x.sourceId === 'event-other')?.evidence ?? '', /agenda series-b/);
});

test('sem PDV e com trailer único só propõe destino, sem escrita', () => {
  const rows = planPdvMigration(fixture({ pdvIds: [] }));
  assert.equal(rows.find(x => x.sourceType === 'PDV')?.action, 'CRIAR_DESTINO');
  assert.equal(rows.find(x => x.sourceId === 'trailer-a')?.action, 'REASSOCIAR');
  assert.match(rows.find(x => x.sourceId === 'trailer-a')?.destinationId ?? '', /^proposed-pdv:/);
});

test('multi-PDV e conflito de tenant bloqueiam reassociação', () => {
  const rows = planPdvMigration(fixture({ pdvIds: ['pdv-a', 'pdv-b'] }));
  assert.equal(rows.find(x => x.sourceId === 'pdv-a')?.action, 'BLOQUEADO');
  assert.equal(rows.find(x => x.sourceId === 'event-series-1')?.action, 'BLOQUEADO');
  assert.equal(rows.find(x => x.sourceId === 'cmd-tenant')?.action, 'BLOQUEADO');
});

test('comanda EVENTO sem ID de evento comprovado fica bloqueada', () => {
  const rows = planPdvMigration(fixture({ commands: [{ id: 'cmd-unlinked', origin: 'EVENTO', eventId: null, pdvId: null }] }));
  assert.equal(rows.find(x => x.sourceId === 'cmd-unlinked')?.action, 'BLOQUEADO');
});

test('preserva pagamentos posteriores, estorno negativo e origem da dívida', () => {
  const rows = planPdvMigration(fixture());
  assert.equal(rows.find(x => x.sourceId === 'pay-late')?.action, 'MANTER');
  assert.equal(rows.find(x => x.sourceId === 'pay-refund')?.action, 'MANTER');
  assert.equal(rows.find(x => x.sourceId === 'ar-late')?.action, 'MANTER');
  assert.match(rows.find(x => x.sourceId === 'ar-late')?.evidence ?? '', /não mudam sua origem/);
  const input = fixture();
  assert.equal(input.payments.find(x => x.id === 'pay-late')?.receivableId, 'ar-late');
  assert.equal(input.payments.find(x => x.id === 'pay-late')?.paidAt, '2026-10-02');
  assert.equal(input.payments.find(x => x.id === 'pay-refund')?.amount, '-0.03');
});

test('mapa repetido é byte a byte estável e ordenado por origem/ID', () => {
  const input = fixture({ events: [...fixture().events].reverse() });
  const shuffled = { ...input, pdvIds: [...input.pdvIds].reverse(), trailerIds: [...input.trailerIds].reverse(), events: [...input.events].reverse(), commands: [...input.commands].reverse(), payments: [...input.payments].reverse() };
  assert.equal(JSON.stringify(planPdvMigration(input)), JSON.stringify(planPdvMigration(shuffled)));
  assert.deepEqual(planPdvMigration(input).map(x => `${x.sourceType}:${x.sourceId}`), [...planPdvMigration(input).map(x => `${x.sourceType}:${x.sourceId}`)].sort());
});

test('trailer múltiplo sem PDV bloqueia e não inventa associação', () => {
  const rows = planPdvMigration(fixture({ pdvIds: [], trailerIds: ['trailer-a', 'trailer-b'] }));
  assert.equal(rows.find(x => x.sourceId === 'trailer-a')?.action, 'BLOQUEADO');
  assert.equal(rows.find(x => x.sourceId === 'trailer-b')?.action, 'BLOQUEADO');
});

test('valores financeiros em centavos e quantidades decimais preservam exatidão', () => {
  assert.equal(sumScaledDecimals(['0.10', '0.20', '-0.03'], 2), 27n);
  assert.equal(decimalToScaledInteger('-12.340', 3), -12340n);
  assert.equal(sumScaledDecimals(['0.125', '1.005', '-0.010'], 3), 1120n);
  assert.throws(() => decimalToScaledInteger('0.001', 2));
});
