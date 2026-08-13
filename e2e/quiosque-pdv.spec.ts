import { expect, test } from '@playwright/test';
import path from 'node:path';

const quiosqueAuth = path.join(process.cwd(), 'e2e/.auth/quiosque.json');

test.use({ storageState: quiosqueAuth });

test.describe('Quiosque comandas', () => {
  test('dono quiosque exclusivo abre hub de comandas como na cervejaria', async ({ page }) => {
    await page.goto('/quiosque/comandas');
    await expect(page.getByRole('navigation', { name: 'Navegação do quiosque' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Comandas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Comanda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Venda avulsa' })).toBeVisible();
  });

  test('venda avulsa lista produto seed CFG', async ({ page }) => {
    await page.goto('/quiosque/comandas/venda-avulsa');
    await expect(page.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible();
    await expect(page.getByText('Cerveja CFG')).toBeVisible();
  });
});
