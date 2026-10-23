import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcularEstatisticasCliente } from './cliente-stats.js';

describe('calcularEstatisticasCliente', () => {
  it('conta visita e consumo líquido de comandas fechadas, mantendo gasto como recebido', () => {
    const antiga = new Date('2026-09-20T12:00:00.000Z');
    const recente = new Date('2026-09-25T12:00:00.000Z');
    const stats = calcularEstatisticasCliente([
      {
        total: 30,
        fechadaEm: antiga,
        updatedAt: antiga,
        pagamentos: [{ valor: 30 }],
        itens: [{ volumeMl: 500, quantidade: 1, produto: { tipo: 'BEBIDA', formato: 'CHOPE' } }],
      },
      {
        total: 50,
        fechadaEm: recente,
        updatedAt: recente,
        pagamentos: [],
        itens: [{ volumeMl: 400, quantidade: 1, produto: { tipo: 'BEBIDA', formato: 'CHOPE' } }],
      },
      {
        total: 40,
        fechadaEm: recente,
        updatedAt: recente,
        pagamentos: [{ valor: 10 }, { valor: 5 }],
        itens: [{ volumeMl: 300, quantidade: 2, canceladoEm: null, cancelamentoPendenteEm: new Date(), produto: { tipo: 'BEBIDA', formato: 'CHOPE' } }],
      },
    ]);

    assert.deepEqual(stats, {
      totalComandasFechadas: 3,
      totalGasto: 45,
      totalMlChope: 900,
      primeiraVisitaEm: antiga,
      ultimaVisitaEm: recente,
    });
  });

  it('exclui cancelamento total do volume sem descontar duas vezes cancelamento parcial', () => {
    const date = new Date('2026-10-02T12:00:00.000Z');
    const stats = calcularEstatisticasCliente([{
      total: 20,
      fechadaEm: date,
      updatedAt: date,
      pagamentos: [],
      itens: [
        { volumeMl: 500, quantidade: 1, canceladoEm: date, produto: { tipo: 'BEBIDA', formato: 'CHOPE' } },
        { volumeMl: 500, quantidade: 2, produto: { tipo: 'BEBIDA', formato: 'CHOPE' } },
      ],
    }]);
    assert.equal(stats.totalComandasFechadas, 1);
    assert.equal(stats.totalMlChope, 1000);
    assert.equal(stats.totalGasto, 0);
  });
});
