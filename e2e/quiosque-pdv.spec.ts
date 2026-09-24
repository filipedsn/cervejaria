import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest, selectPorRotulo } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const quiosqueAuth = path.join(process.cwd(), 'e2e/.auth/quiosque.json');

test.use({ storageState: quiosqueAuth });

let sequence = 0;

async function prepararPdvAberto({ produto = false }: { produto?: boolean } = {}) {
  const id = `${Date.now()}-${sequence++}`;
  const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
  const ponto = await apiRequest<{ id: string; nome: string }>('POST', '/api/quiosque/pontos-venda', {
    cookie,
    body: { nome: `E2E PDV ${id}` },
  });
  expect(ponto.status, 'ponto de venda E2E criado').toBe(201);

  let nomeProduto = '';
  if (produto) {
    nomeProduto = `Produto PDV E2E ${id}`;
    const produtoCriado = await apiRequest('POST', '/api/quiosque/produtos', {
      cookie,
      body: { nome: nomeProduto, precoUnit: 10, exigePreparo: false, controlaEstoque: false },
    });
    expect(produtoCriado.status, 'produto disponivel para venda avulsa criado').toBe(201);
  }

  const caixa = await apiRequest('POST', '/api/quiosque/caixa/abrir', {
    cookie,
    body: { pontoVendaId: ponto.data.id, trocoInicial: 0 },
  });
  expect(caixa.status, 'caixa do ponto E2E aberto').toBe(201);

  return { ...ponto.data, nomeProduto };
}

test.describe('Quiosque comandas', () => {
  test('caixa fechado oferece CTA funcional para abrir', async ({ page }) => {
    const id = `${Date.now()}-${sequence++}`;
    const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const ponto = await apiRequest<{ id: string; nome: string }>('POST', '/api/quiosque/pontos-venda', {
      cookie,
      body: { nome: `E2E PDV fechado ${id}` },
    });
    expect(ponto.status).toBe(201);
    await page.goto('/quiosque/comandas');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.data.id);
    await expect(page.getByText(/Abra o caixa para iniciar um novo turno/)).toBeVisible();
    await page.getByRole('link', { name: 'Abrir caixa', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir caixa', exact: true })).toBeEnabled();
  });

  test('dono quiosque exclusivo abre hub de comandas como na cervejaria', async ({ page }) => {
    const ponto = await prepararPdvAberto();
    await page.goto('/quiosque/comandas');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.id);
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Comandas' })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Comanda', exact: true })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Venda avulsa', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'QR Code para abrir comanda' })).toBeVisible();
  });

  test('QR do Caixa permite ao cliente abrir e reutilizar a propria comanda', async ({ page }) => {
    const ponto = await prepararPdvAberto();
    const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const perfil = await apiRequest<{ cervejaria: { slug: string } }>('GET', '/api/auth/me', { cookie });
    expect(perfil.status, 'perfil do dono do quiosque').toBe(200);
    const slug = perfil.data.cervejaria.slug;

    await page.context().clearCookies();
    await page.goto(`/c/${slug}/p/${ponto.id}`);
    await expect(page.getByRole('heading', { name: 'Abrir comanda' })).toBeVisible();
    await page.locator('#portal-pdv-nome').fill('Cliente QR E2E');
    await page.locator('#portal-pdv-telefone').fill('11987654321');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await expect(page.getByRole('heading', { name: 'Comanda aberta!' })).toBeVisible();

    const repetida = await apiRequest<{ reused: boolean }>('POST', `/api/public/cervejarias/${slug}/pontos-venda/${ponto.id}/comandas`, {
      body: { nome: 'Cliente QR E2E', telefone: '11987654321' },
    });
    expect(repetida.status, 'segunda abertura retorna a comanda existente').toBe(200);
    expect(repetida.data.reused).toBe(true);
  });

  test('venda avulsa lista produto disponivel com caixa aberto', async ({ page }) => {
    const ponto = await prepararPdvAberto({ produto: true });
    await page.goto('/quiosque/comandas/venda-avulsa');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.id);
    await expect(page.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible();
    await page.getByRole('button', { name: '+ Item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar item' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: new RegExp(`^${ponto.nomeProduto}\\b`) })).toBeVisible();
  });
});
