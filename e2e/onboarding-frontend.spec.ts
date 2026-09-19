import { expect, test } from '@playwright/test';
import { CREDENTIALS, login } from './helpers/auth';

test.describe('Onboarding non-blocking operation guidance', () => {
  test('does not open automatically and keeps the operation settings usable', async ({ page }) => {
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await page.goto('/configuracoes/operacao');

    const guidance = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(guidance).toBeHidden();
    await expect(page.getByRole('heading', { name: /Como você trabalha/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Por operações / eventos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir', exact: true })).toBeVisible();
  });

  test('opens contextual guidance manually without module selection or competing CTA', async ({ page }) => {
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await page.goto('/configuracoes/operacao');
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();

    const guidance = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(guidance).toBeVisible();
    await expect(guidance.getByRole('button', { name: 'Fechar' })).toBeVisible();
    await expect(guidance.getByRole('button', { name: /Abrir caixa|Fazer venda|Abrir operação/ })).toHaveCount(0);
    await expect(guidance.getByText(/Cervejaria|Quiosque|Híbrida/i)).toHaveCount(0);
    await guidance.getByRole('button', { name: 'Fechar' }).click();
    await expect(guidance).toBeHidden();
  });

  test('manual guidance fits the mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await page.goto('/configuracoes/operacao');
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    const guidance = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(guidance).toBeVisible();
    const layout = await guidance.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.width);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  });

  test('does not expose manual guidance to an attendant', async ({ page }) => {
    await login(page, CREDENTIALS.atendente.email, CREDENTIALS.atendente.password);
    await page.goto('/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: /Como começar a vender/i })).toHaveCount(0);
  });
});
