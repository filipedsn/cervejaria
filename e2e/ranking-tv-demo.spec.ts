import { expect, test } from '@playwright/test';

test.describe('Modo TV demo', () => {
  test('?demo=N exibe ranking simulado sem login', async ({ page }) => {
    await page.goto('/ranking/tv/qualquer-id?demo=5');

    await expect(page).toHaveURL(/\/ranking\/tv\/.*\?demo=5/);
    await expect(page.getByText('AO VIVO', { exact: true })).toBeVisible();
    await expect(page.getByText('Ranking ao vivo')).toBeVisible();
    await expect(page.getByText(/Simulação · 5 participantes/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Copa do Mundo/i })).toBeVisible();
    await expect(page.getByText('Poliana')).toBeVisible();
  });

  test('modo demo não redireciona para login', async ({ page }) => {
    await page.goto('/ranking/tv/x?demo=3');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Simulação · 3 participantes/)).toBeVisible();
  });
});
