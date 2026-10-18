import assert from 'node:assert/strict';
import test from 'node:test';
import { contasPendentesWhere, sumDebtSettledAfterTurn } from './dashboard-fiado.js';

test('debt settled after the turn counts settlements outside the turn and ignores sale payments', () => {
  const total = sumDebtSettledAfterTurn('shift-11', [
    {
      pagamentos: [
        { valor: 20, sessaoCaixaId: 'shift-11', contaReceberId: null },
        { valor: 15.1, sessaoCaixaId: null, contaReceberId: 'debt-1' },
      ],
    },
    {
      pagamentos: [
        { valor: 10, sessaoCaixaId: 'shift-11', contaReceberId: 'debt-2' },
        { valor: 20.2, sessaoCaixaId: 'shift-12', contaReceberId: 'debt-2' },
      ],
    },
  ]);
  assert.equal(total, 35.3);
});

test('pending receivables filter only restricts the closing date when a period is given', () => {
  const inicio = new Date(2026, 8, 1);
  const fim = new Date(2026, 8, 30, 23, 59, 59, 999);

  const total = contasPendentesWhere('brewery-1', undefined, true);
  assert.equal((total.comanda as Record<string, unknown>).fechadaEm, undefined);

  const doPeriodo = contasPendentesWhere('brewery-1', 'pdv-1', true, { inicio, fim });
  assert.deepEqual(doPeriodo, {
    cliente: { cervejariaId: 'brewery-1' },
    comanda: {
      origem: { in: ['CAIXA', 'EVENTO'] },
      pontoVendaId: 'pdv-1',
      pontoVenda: { cervejariaId: 'brewery-1' },
      status: 'FECHADA',
      fechadaEm: { gte: inicio, lte: fim },
    },
  });
});
