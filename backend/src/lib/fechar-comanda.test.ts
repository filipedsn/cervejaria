import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocatePagamentosToComandas } from './fechar-comanda.js';

describe('allocatePagamentosToComandas', () => {
  it('distribui pagamento único entre comandas em ordem de id', () => {
    const comandas = [
      { id: 'b', total: 40 },
      { id: 'a', total: 60 },
    ];
    const map = allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 100 }]);
    const a = map.get('a')!;
    const b = map.get('b')!;
    assert.equal(a.length, 1);
    assert.equal(a[0]!.forma, 'PIX');
    assert.equal(a[0]!.valor, 60);
    assert.equal(b[0]!.valor, 40);
  });

  it('distribui split entre comandas', () => {
    const comandas = [
      { id: 'a', total: 60 },
      { id: 'b', total: 40 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 50 },
      { forma: 'PIX', valor: 50 },
    ]);
    const sumA = map.get('a')!.reduce((s, p) => s + p.valor, 0);
    const sumB = map.get('b')!.reduce((s, p) => s + p.valor, 0);
    assert.equal(sumA, 60);
    assert.equal(sumB, 40);
  });

  it('distribui entre 3 comandas consumindo pool até zero', () => {
    const comandas = [
      { id: 'a', total: 10 },
      { id: 'b', total: 20 },
      { id: 'c', total: 30 },
    ];
    const map = allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 60 }]);
    const global = [...map.values()].flat().reduce((s, p) => s + p.valor, 0);
    assert.equal(global, 60);
    assert.equal(map.get('a')!.reduce((s, p) => s + p.valor, 0), 10);
    assert.equal(map.get('b')!.reduce((s, p) => s + p.valor, 0), 20);
    assert.equal(map.get('c')!.reduce((s, p) => s + p.valor, 0), 30);
  });

  it('prioriza comanda a (lexicográfico) no water-fill', () => {
    const comandas = [
      { id: 'b', total: 25 },
      { id: 'a', total: 25 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 30 },
      { forma: 'PIX', valor: 20 },
    ]);
    const a = map.get('a')!;
    assert.equal(a.reduce((s, p) => s + p.valor, 0), 25);
    assert.equal(a[0]!.forma, 'DINHEIRO');
    assert.equal(a[0]!.valor, 25);
    const b = map.get('b')!;
    assert.equal(b.reduce((s, p) => s + p.valor, 0), 25);
  });

  it('distribui split com centavos sem sobra', () => {
    const comandas = [
      { id: 'a', total: 12 },
      { id: 'b', total: 16 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 11.2 },
      { forma: 'PIX', valor: 16.8 },
    ]);
    assert.equal(map.get('a')!.reduce((s, p) => s + p.valor, 0), 12);
    assert.equal(map.get('b')!.reduce((s, p) => s + p.valor, 0), 16);
  });

  it('lança erro quando pool é insuficiente', () => {
    assert.throws(
      () =>
        allocatePagamentosToComandas([{ id: 'a', total: 50 }], [{ forma: 'PIX', valor: 30 }]),
      /Alocação incompleta/,
    );
  });

  it('lança erro quando pool tem sobra', () => {
    assert.throws(
      () =>
        allocatePagamentosToComandas([{ id: 'a', total: 50 }], [{ forma: 'PIX', valor: 60 }]),
      /Sobra no pool/,
    );
  });
});
