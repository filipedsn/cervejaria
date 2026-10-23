import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIAS_PRODUTO_OPERACAO, CATEGORIA_CHOPE_TAP_ORDEM_ID, normalizarOrdemCategoriasCanonicas, normalizarOrdemCategoriasProduto, normalizeCategoriaProduto, persistirOrdemCategoriasCanonicas } from './categorias.js';

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

test('canonical shared category order adds a stable Chopes tab without changing existing category order', () => {
  const categories = ['Bebidas', 'Porções'];
  assert.deepEqual(normalizarOrdemCategoriasCanonicas({ catalogo: categories }, categories, true), [
    'Bebidas', 'Porções', CATEGORIA_CHOPE_TAP_ORDEM_ID,
  ]);
  assert.deepEqual(normalizarOrdemCategoriasCanonicas({ catalogo: [CATEGORIA_CHOPE_TAP_ORDEM_ID, ...categories] }, categories, true), [
    CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas', 'Porções',
  ]);
});

test('disabled Chopes are hidden while their saved position survives category reordering and reactivation', () => {
  const categories = ['Bebidas', 'Porções'];
  const saved = { catalogo: ['Bebidas', CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Porções'] };
  assert.deepEqual(normalizarOrdemCategoriasCanonicas(saved, categories, false), categories);
  const updated = persistirOrdemCategoriasCanonicas(['Porções', 'Bebidas'], categories, false, saved);
  assert.deepEqual(updated, ['Porções', CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas']);
  assert.deepEqual(normalizarOrdemCategoriasCanonicas({ catalogo: updated }, categories, true), updated);
});

test('older canonical clients can save category-only orders without dropping a saved Chopes position', () => {
  const categories = ['Bebidas', 'Porções'];
  const saved = { catalogo: [CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas', 'Porções'] };
  assert.deepEqual(
    persistirOrdemCategoriasCanonicas(['Porções', 'Bebidas'], categories, true, saved),
    [CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Porções', 'Bebidas'],
  );
});
