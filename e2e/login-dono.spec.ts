import { expect, test } from '@playwright/test';
import path from 'node:path';

const donoAuth = path.join(process.cwd(), 'e2e/.auth/dono.json');

test.use({ storageState: donoAuth });

test.describe('Login dono', () => {
  test('dono autentica e entra na área da cervejaria', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(comandas|eventos|trailer|operacao\/caixa)/);
    await expect(page.getByRole('navigation').first()).toBeVisible();
  });
});
