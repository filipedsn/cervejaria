import { expect, test } from '@playwright/test';
import path from 'node:path';

const adminAuth = path.join(process.cwd(), 'e2e/.auth/admin.json');
test.use({ storageState: adminAuth });

test('Admin não exibe modos legados como decisão operacional', async ({ page }) => {
  await page.goto('/admin/cervejarias');
  await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();
  await page.getByRole('button', { name: '+ Nova Empresa' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByText('Módulos da empresa')).toHaveCount(0);
  await expect(modal.getByText('Modo da empresa')).toHaveCount(0);
  await expect(modal.getByText('Exclusivo')).toHaveCount(0);
  await expect(modal.getByText('Capacidades operacionais')).toBeVisible();
});
