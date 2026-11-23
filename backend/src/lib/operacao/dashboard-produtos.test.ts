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
  expandSaleItemsFromLine,
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

  it('expandSaleItemsFromLine keeps host sale and attributes optional stock product', () => {
    const lines = expandSaleItemsFromLine(
      {
        produtoId: 'host',
        nome: 'Feijão',
        quantidade: 2,
        precoUnit: 18,
        opcionais: [
          {
            quantidade: 1,
            precoAdicional: 2.5,
            produtoEstoqueId: 'queijo',
            produtoEstoqueNome: 'C. QUEIJO COALHO',
          },
          {
            quantidade: 1,
            precoAdicional: 1,
            produtoEstoqueId: null,
            produtoEstoqueNome: null,
          },
        ],
      },
      '2026-11-23',
    );
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      produtoId: 'host',
      nome: 'Feijão',
      quantidade: 2,
      receita: 36,
      day: '2026-11-23',
      viaOpcional: false,
    });
    assert.deepEqual(lines[1], {
      produtoId: 'queijo',
      nome: 'C. QUEIJO COALHO',
      quantidade: 2,
      receita: 5,
      day: '2026-11-23',
      viaOpcional: true,
    });
  });

  it('expandSaleItemsFromLine filters by stock product id for detail', () => {
    const lines = expandSaleItemsFromLine(
      {
        produtoId: 'host',
        nome: 'Feijão',
        quantidade: 2,
        precoUnit: 18,
        opcionais: [
          {
            quantidade: 1,
            precoAdicional: 2.5,
            produtoEstoqueId: 'queijo',
            produtoEstoqueNome: 'C. QUEIJO COALHO',
          },
        ],
      },
      '2026-11-23',
      'queijo',
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.produtoId, 'queijo');
    assert.equal(lines[0]?.viaOpcional, true);
    assert.equal(lines[0]?.quantidade, 2);
    assert.equal(lines[0]?.receita, 5);
  });

  it('aggregateSalesByProduct merges optional stock sales into linked product', () => {
    const map = aggregateSalesByProduct(
      expandSaleItemsFromLine(
        {
          produtoId: 'host',
          nome: 'Feijão',
          quantidade: 2,
          precoUnit: 18,
          opcionais: [
            {
              quantidade: 1,
              precoAdicional: 2.5,
              produtoEstoqueId: 'queijo',
              produtoEstoqueNome: 'C. QUEIJO COALHO',
            },
          ],
        },
        '2026-11-23',
      ),
    );
    assert.equal(map.get('host')?.quantidade, 2);
    assert.equal(map.get('host')?.receita, 36);
    assert.equal(map.get('queijo')?.quantidade, 2);
    assert.equal(map.get('queijo')?.receita, 5);
    assert.equal(map.get('queijo')?.nome, 'C. QUEIJO COALHO');
  });
});
