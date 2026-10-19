import { expect, test } from '@playwright/test';
import { abrirComandaPortal } from './helpers/portal';
import { loadArenaFixture } from './helpers/fixtures';

test.describe('Portal cliente', () => {
  test('QR abre comanda por telefone', async ({ page }) => {
    const arena = await loadArenaFixture();
    test.skip(!arena, 'Requer npm run qa:setup (arena qa-arena com evento aberto)');

    await abrirComandaPortal(page, arena!);
    await expect(page.getByRole('button', { name: 'Pedir' })).toBeVisible();
  });
});
