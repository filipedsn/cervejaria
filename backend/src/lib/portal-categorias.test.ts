import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categoriasElegiveisAlertaBalcao,
  categoriasVisiveisNoPortal,
} from './portal-categorias-policy.js';
import { CATEGORIA_CHOPE, categoriaParaAlertaBalcao } from './produto-utils.js';

describe('categoriaParaAlertaBalcao', () => {
  it('usa categoria cadastrada quando existe', () => {
    assert.equal(
      categoriaParaAlertaBalcao({ categoria: ' Bebidas ', tipo: 'BEBIDA', formato: 'CHOPE' }),
      'Bebidas',
    );
  });

  it('mapeia chope sem categoria para Chope', () => {
    assert.equal(
      categoriaParaAlertaBalcao({ categoria: null, tipo: 'BEBIDA', formato: 'CHOPE' }),
      CATEGORIA_CHOPE,
    );
  });

  it('cai em Outros quando não é chope e não há categoria', () => {
    assert.equal(
      categoriaParaAlertaBalcao({ categoria: null, tipo: 'COMIDA', formato: null }),
      'Outros',
    );
  });
});

describe('categoriasVisiveisNoPortal / elegíveis no alerta', () => {
  const todas = ['Chope', 'Outros', 'Porções'];

  it('null nas permitidas libera todas', () => {
    assert.deepEqual(categoriasVisiveisNoPortal(todas, null), todas);
  });

  it('restringe às categorias marcadas no portal', () => {
    assert.deepEqual(categoriasVisiveisNoPortal(todas, ['Chope']), ['Chope']);
  });

  it('alerta só considera categorias ainda visíveis no portal', () => {
    assert.deepEqual(
      categoriasElegiveisAlertaBalcao(todas, ['Chope'], ['Chope', 'Porções']),
      { elegiveis: ['Chope'], alertaAtivo: ['Chope'] },
    );
    assert.deepEqual(
      categoriasElegiveisAlertaBalcao(todas, [], ['Chope']),
      { elegiveis: [], alertaAtivo: null },
    );
  });
});
