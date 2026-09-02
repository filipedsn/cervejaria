import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classificarEstoque } from './estoque.js';

describe('classificarEstoque', () => {
  it('mantém normal sem mínimo configurado', () => {
    assert.equal(classificarEstoque(3, null), 'NORMAL');
  });

  it('marca baixo no mínimo sem bloquear o saldo positivo', () => {
    assert.equal(classificarEstoque(3, 3), 'LOW');
  });

  it('marca esgotado independentemente do mínimo', () => {
    assert.equal(classificarEstoque(0, null), 'OUT_OF_STOCK');
    assert.equal(classificarEstoque(0, 3), 'OUT_OF_STOCK');
  });
});
