import { expect, test } from '@playwright/test';
import path from 'node:path';
import { loadArenaFixture } from './helpers/fixtures';
import { abrirComandaPortal, enviarPedidoChopePortal } from './helpers/portal';
import { gotoAfterLogin } from './helpers/auth';

const arenaAuth = path.join(process.cwd(), 'e2e/.auth/arena.json');

test.describe('Portal + staff', () => {
  test('atendente confirma pedido do portal na fila', async ({ browser }) => {
    const arena = await loadArenaFixture();
    test.skip(!arena, 'Requer npm run qa:setup (arena qa-arena com evento aberto)');

    const clientName = `E2E Fila ${Date.now()}`;

    const portalCtx = await browser.newContext();
    const portalPage = await portalCtx.newPage();
    await abrirComandaPortal(portalPage, arena!, clientName);
    await enviarPedidoChopePortal(portalPage);

    const staffCtx = await browser.newContext({ storageState: arenaAuth });
    const staffPage = await staffCtx.newPage();
    await gotoAfterLogin(staffPage, '/comandas');

    await expect(staffPage.getByRole('heading', { name: 'Pedidos do cliente' })).toBeVisible({
      timeout: 15_000,
    });

    const card = staffPage.locator('article.pedido-card-alert').filter({ hasText: clientName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Confirmar' }).click();

    await expect(card).not.toBeVisible({ timeout: 15_000 });

    await portalPage.getByRole('button', { name: /^Comanda/ }).click();
    await expect(portalPage.getByText('Aguardando confirmação do atendente')).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(portalPage.getByText('Na comanda')).toBeVisible();

    await portalCtx.close();
    await staffCtx.close();
  });
});
