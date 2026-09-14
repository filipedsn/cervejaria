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

  test('tutorial manual cabe no viewport mobile e mantém o fechamento acessível', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await page.goto('/configuracoes/operacao');
    const tutorial = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(tutorial).toBeVisible();
    const layout = await tutorial.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    await expect(tutorial.getByRole('button', { name: 'Fechar' })).toBeVisible();
  });

  test('reduced motion remove a animação não essencial do tutorial', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await page.goto('/configuracoes/operacao');
    const tutorial = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(tutorial).toBeVisible();

    const animationName = await page.locator('.onboarding-sheet-card').evaluate(
      (element) => getComputedStyle(element).animationName,
    );
    expect(animationName).toBe('none');
  });

  test('Agora não dispensa só a abertura automática e preserva o acesso manual', async ({ page }) => {
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);

    const tutorial = page.getByRole('region', { name: /Como começar a vender/i });
    await expect(tutorial).toBeVisible();
    await tutorial.getByRole('button', { name: 'Agora não' }).click();
    await expect(tutorial).toBeHidden();

    await page.goto('/configuracoes/operacao');
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await expect(tutorial).toBeVisible();
  });
});
