import { expect, test } from '@playwright/test';

test('Cozinha TV demo abre sem autenticação e usa pedidos fictícios', async ({ page }) => {
  await page.goto('/operacao/cozinha/tv?demo=1');
  await expect(page.getByRole('heading', { name: 'Tap Quiver Eventos' })).toBeVisible();
  await expect(page.getByText('Dados fictícios')).toBeVisible();
  await expect(page.getByText('Senha 42')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar' }).first()).toBeDisabled();
});
