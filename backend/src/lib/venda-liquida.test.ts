import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { itemContaNaVendaLiquida, somarQuantidadeVendaLiquida } from './venda-liquida.js';

describe('venda líquida', () => {
  it('conta item ativo e ignora cancelado total e pendente', () => {
    assert.equal(itemContaNaVendaLiquida({ canceladoEm: null, cancelamentoPendenteEm: null }), true);
    assert.equal(itemContaNaVendaLiquida({ canceladoEm: new Date(), cancelamentoPendenteEm: null }), false);
    assert.equal(itemContaNaVendaLiquida({ canceladoEm: null, cancelamentoPendenteEm: new Date() }), false);
  });

  it('não desconta duas vezes cancelamento parcial cuja quantidade já foi reduzida', () => {
    // Parcial: restam 2 no item ativo; o 1 cancelado só existe no histórico.
    const itens = [
      { quantidade: 2, canceladoEm: null, cancelamentoPendenteEm: null },
      { quantidade: 1, canceladoEm: new Date(), cancelamentoPendenteEm: null },
    ];
    assert.equal(somarQuantidadeVendaLiquida(itens), 2);
  });

  it('exclui cancelamento total que mantém quantidade para histórico', () => {
    assert.equal(
      somarQuantidadeVendaLiquida([
        { quantidade: 3, canceladoEm: new Date(), cancelamentoPendenteEm: null },
        { quantidade: 1, canceladoEm: null, cancelamentoPendenteEm: null },
      ]),
      1,
    );
  });

  it('regressão Thiago: bruto inclui cancelado; líquido não', () => {
    // Espelha o estado pós-cancelamento: total com canceladoEm, parcial já reduzida, ativo.
    const itens = [
      { quantidade: 3, canceladoEm: new Date(), cancelamentoPendenteEm: null },
      { quantidade: 1, canceladoEm: null, cancelamentoPendenteEm: null },
      { quantidade: 1, canceladoEm: null, cancelamentoPendenteEm: null },
    ];
    const brutoSemFiltro = itens.reduce((soma, item) => soma + item.quantidade, 0);
    assert.equal(brutoSemFiltro, 5, 'comportamento antigo dos indicadores');
    assert.equal(somarQuantidadeVendaLiquida(itens), 2);
  });
});
