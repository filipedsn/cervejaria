import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIAS_PRODUTO_OPERACAO, normalizarOrdemCategoriasProduto, normalizeCategoriaProduto } from './categorias.js';

test('Chope entra na ordem das categorias somente quando o recurso de taps está habilitado', () => {
  const semChope = normalizarOrdemCategoriasProduto(['Chope'], false);
  assert.equal(semChope.includes('Chope'), false);
  assert.deepEqual(semChope, [...CATEGORIAS_PRODUTO_OPERACAO]);

  const comChope = normalizarOrdemCategoriasProduto(['Chope', 'Bebidas'], true);
  assert.equal(comChope[0], 'Chope');
  assert.equal(comChope.length, CATEGORIAS_PRODUTO_OPERACAO.length + 1);
  assert.equal(new Set(comChope).size, comChope.length);
});

test('categorias fora do conjunto legado preservam o rótulo original', () => {
  assert.equal(normalizeCategoriaProduto('  Cafés especiais  '), 'Cafés especiais');
});
