import { expect, type Page } from '@playwright/test';

export const CREDENTIALS = {
  dono: { email: 'dono@demo.com', password: '123456' },
  atendente: { email: 'atendente@demo.com', password: '123456' },
  admin: { email: process.env.E2E_ADMIN_EMAIL ?? '', password: process.env.E2E_ADMIN_PASSWORD ?? '' },
  quiosque: {
    email: process.env.E2E_QUIOSQUE_EMAIL ?? 'qa-cfg-quiosque-00-dono@qa.test',
    password: process.env.E2E_QUIOSQUE_PASSWORD ?? 'qa123456',
  },
  arena: {
    email: process.env.E2E_ARENA_EMAIL ?? 'qa-arena-dono@qa.test',
    password: process.env.E2E_ARENA_PASSWORD ?? 'qa123456',
  },
  caixa: {
    email: process.env.E2E_HIBRIDA_EMAIL ?? 'qa-cfg-hibrida-00-dono@qa.test',
    password: process.env.E2E_HIBRIDA_PASSWORD ?? 'qa123456',
  },
  /** QUIOSQUE-01: único seed de quiosque com cozinha habilitada. */
  quiosqueCozinha: {
    email: process.env.E2E_COZINHA_EMAIL ?? 'qa-cfg-quiosque-01-dono@qa.test',
    password: process.env.E2E_COZINHA_PASSWORD ?? 'qa123456',
  },
} as const;

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** A newly activated PWA worker can abort one navigation while taking control. */
export async function gotoAfterLogin(page: Page, path: string) {
  const baseUrl = page.url().startsWith('http') ? page.url() : process.env.E2E_BASE_URL ?? 'http://localhost';
  const targetPath = new URL(path, baseUrl).pathname;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (!String(error).includes('ERR_ABORTED')) throw error;
      await page.waitForURL((url) => url.pathname === targetPath, { timeout: 5_000 }).catch(() => undefined);
      if (new URL(page.url()).pathname === targetPath) return;
    }
    if (new URL(page.url()).pathname === targetPath) return;
  }
  await expect(page).toHaveURL(new RegExp(`${targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

export async function logoutViaAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Abrir conta' }).click();
  const menu = page.getByRole('dialog', { name: 'Conta' });
  await expect(menu).toBeVisible();
  const logout = menu.getByRole('button', { name: 'Sair da conta' });
  await logout.scrollIntoViewIfNeeded();
  await expect(logout).toBeInViewport();
  await logout.click();
  await expect(page).toHaveURL(/\/login/);
}
