import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDashboardProducts,
  contasPendentesWhere,
  projectDashboardTurnMetrics,
  reconcileDashboardSalesToTurns,
  sumDebtSettledAfterTurn,
} from './dashboard-metrics.js';

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

test('debt settled after the turn counts settlements outside the turn and ignores sale payments', () => {
  const total = sumDebtSettledAfterTurn('shift-11', [
    {
      pagamentos: [
        { valor: 50, sessaoCaixaId: 'shift-11', contaReceberId: null },
        { valor: 25, sessaoCaixaId: null, contaReceberId: 'cr-1' },
        { valor: 10.1, sessaoCaixaId: 'shift-14', contaReceberId: 'cr-1' },
        { valor: 7, sessaoCaixaId: 'shift-11', contaReceberId: 'cr-1' },
      ],
    },
    { pagamentos: [{ valor: 0.2, sessaoCaixaId: null, contaReceberId: 'cr-2' }] },
  ]);

  assert.equal(total, 35.3);
});

test('product revenue excludes cancelled items and allocates the discounted sale total in cents', () => {
  const products = aggregateDashboardProducts([
    {
      total: 27.01,
      itens: [
        { produtoId: 'a', nome: 'A', quantidade: 2, precoUnit: 10 },
        { produtoId: 'b', nome: 'B', quantidade: 1, precoUnit: 10 },
        { produtoId: 'a', nome: 'A', quantidade: 1, precoUnit: 10, canceladoEm: new Date() },
        { produtoId: 'b', nome: 'B', quantidade: 1, precoUnit: 10, cancelamentoPendenteEm: new Date() },
        { produtoId: null, nome: 'Sem produto', quantidade: 1, precoUnit: 10 },
      ],
    },
  ]);

  assert.equal(products.find((row) => row.produtoId === 'a')?.quantidade, 2);
  assert.equal(products.find((row) => row.produtoId === 'b')?.quantidade, 1);
  assert.equal(products.reduce((sum, row) => sum + Math.round(row.receita * 100), 0), 2701);
});

test('turn projections count AVULSA separately and suppress productivity for administrative closure', () => {
  const result = projectDashboardTurnMetrics({
    totalVendas: 6318,
    transacoes: [
      ...Array.from({ length: 80 }, (_, i) => ({ id: `c-${i}`, tipo: 'APELIDO' })),
      ...Array.from({ length: 19 }, (_, i) => ({ id: `a-${i}`, tipo: 'AVULSA' })),
    ],
    abertoEm: new Date('2026-10-07T19:21:26.770Z'),
    fechadoEm: new Date('2026-10-18T01:44:51.203Z'),
    administrativo: true,
  });

  assert.equal(result.comandasAtendidas, 80);
  assert.equal(result.vendasAvulsas, 19);
  assert.equal(result.ticketMedio, 6318 / 99);
  assert.equal(result.duracaoHoras, null);
  assert.equal(result.receitaPorHora, null);
});

test('financial closure continues to report operational duration and hourly sales', () => {
  const result = projectDashboardTurnMetrics({
    totalVendas: 100,
    transacoes: [{ id: 'c-1', tipo: 'APELIDO' }],
    abertoEm: new Date('2026-10-01T20:00:00.000Z'),
    fechadoEm: new Date('2026-10-01T22:00:00.000Z'),
    administrativo: false,
  });

  assert.equal(result.duracaoHoras, 2);
  assert.equal(result.receitaPorHora, 50);
});

test('October sales reconcile to listed turns, debt settlements, and sales without a session without conflating receipts', () => {
  const inicio = new Date('2026-10-01T03:00:00.000Z');
  const fim = new Date('2026-11-01T02:59:59.999Z');
  const turno = { sessaoId: 'shift-oct', pontoVendaId: 'point-thiago', receitaTotal: 37_048 };
  const paidEm = new Date('2026-10-17T15:00:00.000Z');
  const command = (id: string, total: number, extra: Partial<Parameters<typeof reconcileDashboardSalesToTurns>[0]['comandas'][number]> = {}) => ({
    id,
    tipo: 'APELIDO',
    pontoVendaId: 'point-thiago',
    fechadaEm: new Date('2026-10-17T14:00:00.000Z'),
    total,
    sessaoCaixaRealizacaoId: null,
    pagamentos: [],
    ...extra,
  });

  const result = reconcileDashboardSalesToTurns({
    inicio,
    fim,
    turnos: [turno],
    comandas: [
      command('turn-sale', 37_048, { sessaoCaixaRealizacaoId: 'shift-oct' }),
      command('debt-sale', 805, {
        pagamentos: [{ id: 'debt-payment', valor: 805, pagoEm: paidEm, sessaoCaixaId: 'shift-oct', contaReceberId: 'receivable-1' }],
      }),
      command('unassigned-sale', 1_934, {
        pagamentos: [{ id: 'unassigned-receipt', valor: 1_745, pagoEm: paidEm, sessaoCaixaId: null, contaReceberId: 'receivable-2' }],
      }),
    ],
  });

  assert.equal(result.vendasDoMesCents, 3_978_700);
  assert.equal(result.vendasExibidasNosTurnosCents, 3_704_800);
  assert.equal(result.vendasForaDosTurnosCents, 273_900);
  assert.equal(result.comandasForaDosTurnos, 2);
  assert.deepEqual(result.porTipoForaDosTurnos, [{ tipo: 'APELIDO', comandas: 2, vendasCents: 273_900 }]);
  assert.deepEqual(result.quitadasPorRecebimentoEmTurno, {
    comandas: 1,
    vendasCents: 80_500,
    recebimentosNoPeriodoCount: 1,
    recebimentosNoPeriodoCents: 80_500,
  });
  assert.deepEqual(result.semSessaoComprovada, {
    comandas: 1,
    vendasCents: 193_400,
    recebimentosNoPeriodoCount: 1,
    recebimentosNoPeriodoCents: 174_500,
  });
  assert.equal(result.reconciliado, true);
});

test('a sale closed in October stays an October sale when its debt is collected in November', () => {
  const inicio = new Date('2026-10-01T03:00:00.000Z');
  const fim = new Date('2026-11-01T02:59:59.999Z');
  const result = reconcileDashboardSalesToTurns({
    inicio,
    fim,
    turnos: [{ sessaoId: 'shift-oct', pontoVendaId: 'point-thiago', receitaTotal: 0 }],
    comandas: [{
      id: 'oct-sale-paid-in-november',
      tipo: 'APELIDO',
      pontoVendaId: 'point-thiago',
      fechadaEm: new Date('2026-10-31T22:00:00.000Z'),
      total: 500,
      sessaoCaixaRealizacaoId: null,
      pagamentos: [{
        id: 'november-debt-payment',
        valor: 500,
        pagoEm: new Date('2026-11-02T12:00:00.000Z'),
        sessaoCaixaId: 'shift-oct',
        contaReceberId: 'receivable-cross-month',
      }],
    }],
  });

  assert.equal(result.vendasDoMesCents, 50_000);
  assert.equal(result.vendasExibidasNosTurnosCents, 0);
  assert.equal(result.vendasForaDosTurnosCents, 50_000);
  assert.deepEqual(result.porTipoForaDosTurnos, [{ tipo: 'APELIDO', comandas: 1, vendasCents: 50_000 }]);
  assert.equal(result.quitadasPorRecebimentoEmTurno.vendasCents, 50_000);
  assert.equal(result.quitadasPorRecebimentoEmTurno.recebimentosNoPeriodoCents, 0);
  assert.equal(result.reconciliado, true);
});
