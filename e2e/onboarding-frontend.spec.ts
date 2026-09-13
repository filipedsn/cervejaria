import { expect, test } from '@playwright/test';
import { CREDENTIALS, login } from './helpers/auth';

test.describe('Onboarding frontend engine', () => {
  test('DONO abre e fecha o resumo manual sem bloquear a operação', async ({ page }) => {
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);

    const tutorial = page.getByRole('region', { name: /Como começar a vender/i });
    if (await tutorial.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tutorial.getByRole('button', { name: 'Fechar' }).click();
    }

    await page.goto('/configuracoes/operacao');
    const entry = page.getByRole('main').getByRole('heading', { name: /Como começar a vender/i });
    await expect(entry).toBeVisible();
    if (await tutorial.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tutorial.getByRole('button', { name: 'Fechar' }).click();
    }
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();

    await expect(tutorial).toBeVisible();
    await tutorial.getByRole('button', { name: 'Fechar' }).click();
    await expect(tutorial).toBeHidden();
    await expect(page.getByRole('heading', { name: /Configurações/i })).toBeVisible();
  });

  test('ATENDENTE não recebe a entrada manual', async ({ page }) => {
    await login(page, CREDENTIALS.atendente.email, CREDENTIALS.atendente.password);
    await page.goto('/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: /Como começar a vender/i })).toHaveCount(0);
  });
});
