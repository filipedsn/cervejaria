import { expect, test } from '@playwright/test';
import path from 'node:path';

const atendenteAuth = path.join(process.cwd(), 'e2e/.auth/atendente.json');

test.use({ storageState: atendenteAuth });

test.describe('RBAC atendente', () => {
  test('atendente não acessa painel admin', async ({ page }) => {
    await page.goto('/admin/cervejarias');

    await expect(page).not.toHaveURL(/\/admin\//);
    await expect(page.getByRole('heading', { name: /cervejarias/i })).not.toBeVisible();
  });
});
