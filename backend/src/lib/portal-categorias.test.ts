import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
