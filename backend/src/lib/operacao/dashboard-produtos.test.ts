import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateSalesByProduct,
  applyMovimento,
  dayKeyLocal,
  dayLabelPt,
  deltaEstoqueFromAgg,
  eachDayKeys,
  emptyMovimentoAgg,
  mergeListaRows,
  outrosFromAgg,
} from './dashboard-produtos.js';

describe('dashboard-produtos helpers', () => {
  it('dayKeyLocal and label use local calendar', () => {
    const d = new Date(2026, 10, 23, 15, 30, 0);
    assert.equal(dayKeyLocal(d), '2026-11-23');
    assert.equal(dayLabelPt('2026-11-23'), '23/11');
  });

  it('eachDayKeys covers inclusive range', () => {
    const keys = eachDayKeys(new Date(2026, 10, 1), new Date(2026, 10, 3));
    assert.deepEqual(keys, ['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('applyMovimento buckets types and delta ignores AJUSTE', () => {
    const agg = emptyMovimentoAgg();
    applyMovimento(agg, 'ENTRADA', 10);
    applyMovimento(agg, 'SAIDA_VENDA', 3);
    applyMovimento(agg, 'ESTORNO_VENDA', 1);
    applyMovimento(agg, 'PERDA', 2);
    applyMovimento(agg, 'AJUSTE', 5);
    assert.equal(agg.entradas, 10);
    assert.equal(agg.saidasVenda, 3);
    assert.equal(agg.estornos, 1);
    assert.equal(outrosFromAgg(agg), 2);
    assert.equal(agg.ajustes, 5);
    assert.equal(deltaEstoqueFromAgg(agg), 6);
  });

  it('aggregateSalesByProduct sums qty and revenue', () => {
    const map = aggregateSalesByProduct([
      { produtoId: 'p1', nome: 'Churrasquinho', quantidade: 2, receita: 20, day: '2026-11-01' },
      { produtoId: 'p1', nome: 'Churrasquinho', quantidade: 1, receita: 10, day: '2026-11-02' },
      { produtoId: 'p2', nome: 'Refri', quantidade: 5, receita: 25, day: '2026-11-01' },
    ]);
    assert.equal(map.get('p1')?.quantidade, 3);
    assert.equal(map.get('p1')?.receita, 30);
    assert.equal(map.get('p2')?.quantidade, 5);
  });

  it('mergeListaRows hides zero activity by default and sorts by receita', () => {
    const sales = new Map([
      ['a', { nome: 'A', quantidade: 1, receita: 10 }],
      ['b', { nome: 'B', quantidade: 2, receita: 50 }],
    ]);
    const movimentos = new Map([
      ['c', applyMovimento(emptyMovimentoAgg(), 'ENTRADA', 4)],
    ]);
    const rows = mergeListaRows({
      sales,
      movimentos,
      nomes: new Map([['c', 'C']]),
      saldos: new Map([['d', 9]]),
      controlaEstoque: true,
      incluirZerados: false,
    });
    assert.deepEqual(
      rows.map((r) => r.produtoId),
      ['b', 'a', 'c'],
    );
    assert.equal(rows.find((r) => r.produtoId === 'd'), undefined);

    const withZeros = mergeListaRows({
      sales,
      movimentos,
      nomes: new Map([['c', 'C'], ['d', 'D']]),
      saldos: new Map([['d', 9]]),
      controlaEstoque: true,
      incluirZerados: true,
    });
    assert.ok(withZeros.some((r) => r.produtoId === 'd' && r.saldoAtual === 9));
  });
});
