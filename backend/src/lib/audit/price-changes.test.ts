import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffPriceChanges, toMoneyCents } from './price-changes.js';

describe('price-changes', () => {
  it('toMoneyCents arredonda em centavos', () => {
    assert.equal(toMoneyCents(10), 1000);
    assert.equal(toMoneyCents(12.99), 1299);
  });

  it('detecta 10,00 -> 12,00 no mesmo produto/volume', () => {
    const changes = diffPriceChanges(
      [{ produtoId: 'suco', volumeMl: 300, precoUnit: 10 }],
      [{ produtoId: 'suco', volumeMl: 300, precoUnit: 12 }],
    );
    assert.deepEqual(changes, [
      { produtoId: 'suco', volumeMl: 300, fromCents: 1000, toCents: 1200 },
    ]);
  });

  it('marca remocao e inclusao', () => {
    const changes = diffPriceChanges(
      [{ produtoId: 'a', volumeMl: 0, precoUnit: 5 }, { produtoId: 'b', volumeMl: 0, precoUnit: 7 }],
      [{ produtoId: 'b', volumeMl: 0, precoUnit: 7 }, { produtoId: 'c', volumeMl: 0, precoUnit: 9 }],
    );
    assert.deepEqual(changes, [
      { produtoId: 'a', volumeMl: 0, fromCents: 500, toCents: null },
      { produtoId: 'c', volumeMl: 0, fromCents: null, toCents: 900 },
    ]);
  });

  it('usa campo preco do catalogo', () => {
    const changes = diffPriceChanges(
      [{ produtoId: 'chope', volumeMl: 300, preco: 10 }],
      [{ produtoId: 'chope', volumeMl: 300, preco: 11 }],
    );
    assert.deepEqual(changes, [
      { produtoId: 'chope', volumeMl: 300, fromCents: 1000, toCents: 1100 },
    ]);
  });
});
