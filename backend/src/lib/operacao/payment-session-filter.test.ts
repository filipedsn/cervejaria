import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentFilterForOperationalSession } from './payment-session-filter.js';

const session = {
  id: 'session-1', pontoVendaId: 'point-1', diaOperacional: new Date('2026-10-01T00:00:00.000Z'),
  abertoEm: new Date('2026-10-01T10:00:00.000Z'), fechadoEm: new Date('2026-10-01T18:00:00.000Z'), status: 'FECHADO',
};

test('canonical PDV includes only payments with the exact persisted session reference', () => {
  assert.deepEqual(paymentFilterForOperationalSession(session, 'tenant-1', true), {
    sessaoCaixaId: 'session-1',
    comanda: { origem: 'CAIXA', pontoVenda: { cervejariaId: 'tenant-1' } },
  });
});

test('legacy mode retains its existing null-session interval fallback', () => {
  const filter = paymentFilterForOperationalSession(session, 'tenant-1', false) as { OR: Array<Record<string, any>> };
  assert.equal(filter.OR.length, 2);
  assert.deepEqual(filter.OR[0], {
    sessaoCaixaId: 'session-1',
    comanda: { origem: 'CAIXA', pontoVenda: { cervejariaId: 'tenant-1' } },
  });
  assert.equal(filter.OR[1].sessaoCaixaId, null);
  assert.equal(filter.OR[1].contaReceberId, null);
  const window = filter.OR[1].comanda as Record<string, any>;
  assert.equal(window.origem, 'CAIXA');
  assert.deepEqual(window.pontoVenda, { cervejariaId: 'tenant-1' });
  assert.equal(window.pontoVendaId, 'point-1');
  assert.equal(window.diaOperacional, session.diaOperacional);
  assert.deepEqual(window.fechadaEm, { gte: session.abertoEm, lte: session.fechadoEm });
});
