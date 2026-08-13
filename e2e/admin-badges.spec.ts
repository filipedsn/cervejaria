import { expect, test } from '@playwright/test';
import path from 'node:path';

const adminAuth = path.join(process.cwd(), 'e2e/.auth/admin.json');

test.use({ storageState: adminAuth });

test.describe('Admin cervejarias', () => {
  test('admin vê lista com badges de módulos', async ({ page }) => {
    await page.goto('/admin/cervejarias');
    await expect(page.getByRole('heading', { name: /cervejarias/i })).toBeVisible();
    await expect(page.getByText('Cervejaria', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Quiosque', { exact: true }).first()).toBeVisible();
  });
});
