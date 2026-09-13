import { expect, test } from '@playwright/test';
import { CREDENTIALS, login } from './helpers/auth';

test.describe('Onboarding frontend engine', () => {
  test('DONO abre e fecha o resumo manual sem bloquear a operação', async ({ page }) => {
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);

    const automaticDialog = page.getByRole('dialog', { name: 'Como começar a vender' });
    if (await automaticDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await automaticDialog.getByRole('button', { name: 'Fechar' }).click();
    }

    await page.goto('/configuracoes/operacao');
    const entry = page.getByRole('main').getByRole('heading', { name: 'Como começar a vender' });
    await expect(entry).toBeVisible();
    if (await automaticDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await automaticDialog.getByRole('button', { name: 'Fechar' }).click();
    }
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Como começar a vender' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  });

  test('ATENDENTE não recebe a entrada manual', async ({ page }) => {
    await login(page, CREDENTIALS.atendente.email, CREDENTIALS.atendente.password);
    await page.goto('/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: 'Como começar a vender' })).toHaveCount(0);
  });
});
