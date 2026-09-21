import { expect, type Page } from '@playwright/test';

export const CREDENTIALS = {
  dono: { email: 'dono@demo.com', password: '123456' },
  atendente: { email: 'atendente@demo.com', password: '123456' },
  admin: { email: 'contato@quivercloud.com.br', password: 'M1H2sy27!pedro01' },
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

export async function logoutViaAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Abrir conta' }).click();
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page).toHaveURL(/\/login/);
}
