import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeRequestPayload } from './request-payload.js';

describe('summarizeRequestPayload', () => {
  it('preserva precoUnit dentro de itens de cardapio', () => {
    const summary = summarizeRequestPayload({
      nome: 'Boulevard',
      itens: [{ produtoId: 'prod_1', volumeMl: 300, precoUnit: 12 }],
    });
    assert.ok(summary);
    assert.equal(summary.omitted, true); // nome omitido (texto livre)
    assert.deepEqual(summary.payload, {
      itens: [{ produtoId: 'prod_1', volumeMl: 300, precoUnit: 12 }],
    });
  });

  it('preserva precos[] do catalogo', () => {
    const summary = summarizeRequestPayload({
      precos: [{ volumeMl: 300, preco: 10 }, { volumeMl: 500, preco: 17 }],
      precoUnit: 10,
    });
    assert.ok(summary);
    assert.equal(summary.omitted, false);
    assert.deepEqual(summary.payload, {
      precos: [{ volumeMl: 300, preco: 10 }, { volumeMl: 500, preco: 17 }],
      precoUnit: 10,
    });
  });

  it('preserva parametros operacionais numericos/booleanos e enums', () => {
    const summary = summarizeRequestPayload({
      quantidadeMesas: 12,
      contadoDinheiro: 100.5,
      quantidadeNova: 3,
      estoqueMinimo: 1,
      kitchenEnabled: true,
      escopo: 'TEMPLATE',
      cardapioId: 'op_abc',
      produtoIds: ['p1', 'p2'],
      observacao: 'texto livre',
    });
    assert.ok(summary);
    assert.equal(summary.omitted, true);
    assert.deepEqual(summary.payload, {
      quantidadeMesas: 12,
      contadoDinheiro: 100.5,
      quantidadeNova: 3,
      estoqueMinimo: 1,
      kitchenEnabled: true,
      escopo: 'TEMPLATE',
      cardapioId: 'op_abc',
      produtoIds: ['p1', 'p2'],
    });
  });
});
