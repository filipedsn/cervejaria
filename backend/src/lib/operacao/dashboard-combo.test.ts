import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agregarItensSoltosECombo } from './dashboard-combo.js';

describe('agregarItensSoltosECombo', () => {
  it('separa unidade solta de unidade em combo e agrega combos por instância', () => {
    const resultado = agregarItensSoltosECombo([
      { produtoId: 'boi', nome: 'C. BOI', quantidade: 1, precoUnit: 14 },
      {
        produtoId: 'boi',
        nome: 'C. BOI',
        quantidade: 1,
        precoUnit: 14,
        comboInstanciaId: 'i1',
        comboProdutoId: 'janta',
        comboNome: 'Jantinha',
      },
      {
        produtoId: 'lat',
        nome: 'Latão',
        quantidade: 1,
        precoUnit: 10,
        comboInstanciaId: 'i1',
        comboProdutoId: 'janta',
        comboNome: 'Jantinha',
      },
      {
        produtoId: 'boi',
        nome: 'C. BOI',
        quantidade: 1,
        precoUnit: 14.58,
        comboInstanciaId: 'i2',
        comboProdutoId: 'fechado',
        comboNome: 'E2E Combo Fechado',
      },
      {
        produtoId: 'lat',
        nome: 'Latão',
        quantidade: 1,
        precoUnit: 10.42,
        comboInstanciaId: 'i2',
        comboProdutoId: 'fechado',
        comboNome: 'E2E Combo Fechado',
      },
    ], 100);

    assert.equal(resultado.itensVendidos, 5);
    assert.equal(resultado.combosVendidos, 2);
    assert.equal(resultado.receitaCombo, 49);
    assert.equal(resultado.percentualReceitaCombo, 49);

    const boi = resultado.porProduto.find((p) => p.produtoId === 'boi');
    assert.ok(boi);
    assert.equal(boi.quantidadeSolta, 1);
    assert.equal(boi.quantidadeEmCombo, 2);
    assert.equal(boi.receitaSolta, 14);
    assert.equal(Math.round(boi.receitaEmCombo * 100) / 100, 28.58);

    assert.equal(resultado.porCombo.length, 2);
    assert.equal(resultado.porCombo[0]?.receita, 25);
    assert.equal(resultado.porCombo[0]?.quantidade, 1);
  });

  it('ignora itens cancelados na venda líquida', () => {
    const resultado = agregarItensSoltosECombo([
      {
        produtoId: 'boi',
        nome: 'C. BOI',
        quantidade: 1,
        precoUnit: 14,
        comboInstanciaId: 'i1',
        comboProdutoId: 'janta',
        comboNome: 'Jantinha',
        canceladoEm: new Date(),
      },
    ], 50);
    assert.equal(resultado.combosVendidos, 0);
    assert.equal(resultado.receitaCombo, 0);
    assert.equal(resultado.porProduto.length, 0);
  });
});
