import { expect, type Page } from '@playwright/test';
import type { ArenaFixture } from './fixtures';
import { uniquePortalPhone } from './fixtures';

/** Abre comanda no portal público (telefone novo → cadastro). */
export async function abrirComandaPortal(page: Page, arena: ArenaFixture, nome?: string) {
  await page.goto(`/c/${arena.slug}/t/${arena.trailerId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Abrir comanda' })).toBeVisible();

  const phone = uniquePortalPhone();
  const nomeCliente = nome ?? `E2E Portal ${Date.now()}`;
  await page.getByPlaceholder('(XX) XXXXX-XXXX').fill(phone);
  await page.getByPlaceholder('Digite seu nome').fill(nomeCliente);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();

  await expect(page.getByRole('heading', { name: 'Cadastro' })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Seu nome').fill(nomeCliente);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();

  await expect(page.getByRole('heading', { name: 'Sua comanda' })).toBeVisible({ timeout: 15_000 });
  return phone;
}

/** Envia o primeiro chope disponível no cardápio do portal. */
export async function enviarPedidoChopePortal(page: Page) {
  await page.getByRole('button', { name: 'Pedir' }).click();
  await page.locator('.touch-btn-secondary.touch-btn-sm').first().click();
  const cart = page.getByRole('dialog', { name: /Carrinho/ });
  await expect(cart).toBeVisible();
  await cart.getByRole('button', { name: 'Enviar pedido ao atendente' }).click();
  await page.getByRole('button', { name: /^Comanda/ }).click();
  await expect(page.getByText('Aguardando confirmação do atendente')).toBeVisible({ timeout: 10_000 });
}
