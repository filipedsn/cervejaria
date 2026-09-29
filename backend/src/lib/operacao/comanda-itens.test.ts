import assert from 'node:assert/strict';
import test from 'node:test';
import { resolverQuantidadeCancelamento } from './comanda-itens.js';

test('valida quantidade cancelada sem exceder unidades existentes', () => {
  assert.equal(resolverQuantidadeCancelamento(3, 1), 1);
  assert.equal(resolverQuantidadeCancelamento(3, 2), 2);
  assert.equal(resolverQuantidadeCancelamento(3, 3), 3);
  assert.equal(resolverQuantidadeCancelamento(3), 3);
  assert.equal(resolverQuantidadeCancelamento(3, 0), null);
  assert.equal(resolverQuantidadeCancelamento(3, 4), null);
  assert.equal(resolverQuantidadeCancelamento(3, 1.5), null);
});
