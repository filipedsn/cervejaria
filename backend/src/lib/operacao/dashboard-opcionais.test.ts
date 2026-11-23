import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agregarOpcionaisVendidos } from './dashboard-opcionais.js';

describe('agregarOpcionaisVendidos', () => {
  it('soma receita e quantidade de opcionais por catálogo', () => {
    const resultado = agregarOpcionaisVendidos([
      {
        quantidade: 2,
        opcionais: [
          { opcionalCatalogoId: 'queijo', nome: 'Queijo extra', precoAdicional: 3, quantidade: 1 },
          { opcionalCatalogoId: 'bacon', nome: 'Bacon', precoAdicional: 5, quantidade: 1 },
        ],
      },
      {
        quantidade: 1,
        opcionais: [
          { opcionalCatalogoId: 'queijo', nome: 'Queijo extra', precoAdicional: 3, quantidade: 2 },
        ],
      },
    ], 100);

    assert.equal(resultado.unidadesOpcionais, 2 + 2 + 2);
    assert.equal(resultado.receitaOpcionais, 6 + 10 + 6);
    assert.equal(resultado.percentualReceitaOpcionais, 22);
    const queijo = resultado.porOpcional.find((item) => item.opcionalId === 'queijo');
    assert.ok(queijo);
    assert.equal(queijo.quantidade, 4);
    assert.equal(queijo.receita, 12);
  });

  it('ignora itens cancelados', () => {
    const resultado = agregarOpcionaisVendidos([
      {
        quantidade: 1,
        canceladoEm: new Date(),
        opcionais: [{ opcionalCatalogoId: 'x', nome: 'X', precoAdicional: 10, quantidade: 1 }],
      },
    ], 50);
    assert.equal(resultado.receitaOpcionais, 0);
    assert.equal(resultado.porOpcional.length, 0);
  });
});
