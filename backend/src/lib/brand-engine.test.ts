import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBrandPalette } from './brand-colors.js';
import { buildTheme, isBrandThemeV2, normalizeTheme, themeToStorage } from './brand-engine.js';

test('normalizes valid, legacy, invalid and absent branding JSON safely', () => {
  const theme = buildTheme('#112233', '#445566');
  const stored = themeToStorage(theme);

  assert.deepEqual(stored, theme);
  assert.equal(isBrandThemeV2(stored), true);
  assert.deepEqual(normalizeTheme(stored, '#112233'), theme);

  const legacy = generateBrandPalette('#112233');
  const normalizedLegacy = normalizeTheme(legacy, '#abcdef');
  if (!normalizedLegacy) throw new Error('legacy palette should normalize');
  assert.equal(normalizedLegacy.corSecundaria, null);

  assert.equal(normalizeTheme({ v: 2, brand: {}, surface: {} }, '#112233'), null);
  assert.equal(normalizeTheme(null, null), null);
  assert.equal(normalizeTheme('unexpected', null), null);
});
