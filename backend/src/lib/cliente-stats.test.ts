import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcularEstatisticasCliente } from './cliente-stats.js';

describe('calcularEstatisticasCliente', () => {
  it('soma somente valores recebidos e deixa contas sem pagamento fora do histórico', () => {
    const antiga = new Date('2026-09-20T12:00:00.000Z');
    const recente = new Date('2026-09-25T12:00:00.000Z');
    const stats = calcularEstatisticasCliente([
      {
        total: 30,
        fechadaEm: antiga,
        updatedAt: antiga,
        pagamentos: [{ valor: 30 }],
        itens: [],
      },
      {
        total: 50,
        fechadaEm: recente,
        updatedAt: recente,
        pagamentos: [],
        itens: [],
      },
      {
        total: 40,
        fechadaEm: recente,
        updatedAt: recente,
        pagamentos: [{ valor: 10 }, { valor: 5 }],
        itens: [],
      },
    ]);

    assert.deepEqual(stats, {
      totalComandasFechadas: 2,
      totalGasto: 45,
      totalMlChope: 0,
      primeiraVisitaEm: antiga,
      ultimaVisitaEm: recente,
    });
  });
});
