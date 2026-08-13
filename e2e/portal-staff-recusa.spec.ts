import { expect, test } from '@playwright/test';
import path from 'node:path';
import { loadArenaFixture } from './helpers/fixtures';
import { abrirComandaPortal, enviarPedidoChopePortal } from './helpers/portal';

const arenaAuth = path.join(process.cwd(), 'e2e/.auth/arena.json');

test.describe('Portal + staff recusa', () => {
  test('atendente recusa pedido do portal com motivo', async ({ browser }) => {
    const arena = await loadArenaFixture();
    test.skip(!arena, 'Requer npm run qa:setup (arena qa-arena com evento aberto)');

    const clientName = `E2E Recusa ${Date.now()}`;
    const motivo = 'Item indisponível no teste E2E';

    const portalCtx = await browser.newContext();
    const portalPage = await portalCtx.newPage();
    await abrirComandaPortal(portalPage, arena!, clientName);
    await enviarPedidoChopePortal(portalPage);

    const staffCtx = await browser.newContext({ storageState: arenaAuth });
    const staffPage = await staffCtx.newPage();
    await staffPage.goto('/comandas');

    const card = staffPage.locator('article.pedido-card-alert').filter({ hasText: clientName });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole('button', { name: 'Recusar' }).click();
    await staffPage.getByPlaceholder('Ex.: item indisponível').fill(motivo);
    await staffPage.getByRole('button', { name: 'Confirmar recusa' }).click();

    await expect(card).not.toBeVisible({ timeout: 15_000 });

    await portalPage.getByRole('button', { name: /^Comanda/ }).click();
    await expect(portalPage.locator('article.card-notice-danger').getByText('Recusado')).toBeVisible({
      timeout: 15_000,
    });
    await expect(portalPage.getByText(`Motivo: ${motivo}`)).toBeVisible();

    await portalCtx.close();
    await staffCtx.close();
  });
});
