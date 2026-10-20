import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPortalCategories, isPortalCategoryAllowed } from './portal-catalog.js';

test('an unconfigured establishment keeps the legacy portal catalog', () => {
  const items = [{ categoria: 'Churrasquinhos' }, { categoria: 'Bebidas' }, { categoria: null }];
  assert.deepEqual(filterPortalCategories(items, null), items);
  assert.equal(isPortalCategoryAllowed('Bebidas', null), true);
});

test('an explicitly empty portal category selection hides every category', () => {
  assert.deepEqual(filterPortalCategories([{ categoria: 'Bebidas' }, { categoria: null }], []), []);
  assert.equal(isPortalCategoryAllowed('Bebidas', []), false);
});

test('a selected category filters the public catalog and treats uncategorized products as Outros', () => {
  assert.deepEqual(
    filterPortalCategories([{ id: 'skewer', categoria: 'Churrasquinhos' }, { id: 'drink', categoria: 'Bebidas' }, { id: 'other', categoria: null }], ['Churrasquinhos', 'Outros']),
    [{ id: 'skewer', categoria: 'Churrasquinhos' }, { id: 'other', categoria: null }],
  );
  assert.equal(isPortalCategoryAllowed(' Churrasquinhos ', ['Churrasquinhos']), true);
});
