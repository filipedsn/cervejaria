import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPortalCategoryAllowed } from './portal-catalog.js';
import { CATEGORIA_CHOPE } from './produto-utils.js';

describe('portal PDV chope visibility', () => {
  it('mostra Chopes quando o portal libera todas as categorias', () => {
    assert.equal(isPortalCategoryAllowed(CATEGORIA_CHOPE, null), true);
  });

  it('mostra Chopes só se Chope estiver nas categorias permitidas', () => {
    assert.equal(isPortalCategoryAllowed(CATEGORIA_CHOPE, ['Chope']), true);
    assert.equal(isPortalCategoryAllowed(CATEGORIA_CHOPE, ['Outros']), false);
  });
});
