import { expect, type Page } from '@playwright/test';
import type { ArenaFixture } from './fixtures';
import { uniquePortalPhone } from './fixtures';

/** Abre comanda no portal público (telefone novo → cadastro). */
export async function abrirComandaPortal(page: Page, arena: ArenaFixture, nome?: string) {
  await page.goto(`/c/${arena.slug}/t/${arena.trailerId}`);
  await expect(page.getByRole('heading', { name: 'Abrir comanda' })).toBeVisible();

  const phone = uniquePortalPhone();
  await page.getByPlaceholder('(11) 99999-9999').fill(phone);
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Cadastro' })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Seu nome').fill(nome ?? `E2E Portal ${Date.now()}`);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();

  await expect(page.getByRole('heading', { name: 'Sua comanda' })).toBeVisible({ timeout: 15_000 });
  return phone;
}

/** Envia o primeiro chope disponível no cardápio do portal. */
export async function enviarPedidoChopePortal(page: Page) {
  await page.getByRole('button', { name: 'Pedir' }).click();
  await page.locator('.touch-btn-secondary.touch-btn-sm').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar pedido ao atendente' }).click();
  await page.getByRole('button', { name: /^Comanda/ }).click();
  await expect(page.getByText('Aguardando confirmação do atendente')).toBeVisible({ timeout: 10_000 });
}
