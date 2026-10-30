import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filtrarCategoriaChopeSeTapsDesligados } from './categoria-chope-torneiras.js';

describe('filtrarCategoriaChopeSeTapsDesligados', () => {
  it('mantém Chope com torneiras ligadas', () => {
    assert.deepEqual(
      filtrarCategoriaChopeSeTapsDesligados(['Bebidas', 'Chope', 'Outros'], true),
      ['Bebidas', 'Chope', 'Outros'],
    );
  });

  it('esconde Chope com torneiras desligadas', () => {
    assert.deepEqual(
      filtrarCategoriaChopeSeTapsDesligados(['Bebidas', 'Chope', 'Outros'], false),
      ['Bebidas', 'Outros'],
    );
  });
});
