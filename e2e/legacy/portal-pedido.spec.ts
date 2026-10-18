import { expect, test } from '@playwright/test';
import { abrirComandaPortal, enviarPedidoChopePortal } from './helpers/portal';
import { loadArenaFixture } from './helpers/fixtures';

test.describe('Portal pedido', () => {
  test('cliente envia pedido pendente e cancela', async ({ page }) => {
    const arena = await loadArenaFixture();
    test.skip(!arena, 'Requer npm run qa:setup (arena qa-arena com evento aberto)');

    await abrirComandaPortal(page, arena!);
    await enviarPedidoChopePortal(page);

    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(page.getByText('Aguardando confirmação do atendente')).not.toBeVisible({ timeout: 10_000 });
  });
});
