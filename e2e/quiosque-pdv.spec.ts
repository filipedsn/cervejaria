import { expect, test } from '@playwright/test';
import path from 'node:path';
import { apiLogin, apiRequest, selectPorRotulo } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';

const quiosqueAuth = path.join(process.cwd(), 'e2e/.auth/operacao.json');

test.use({ storageState: quiosqueAuth });

let sequence = 0;

async function prepararPdvAberto({ produto = false }: { produto?: boolean } = {}) {
  const id = `${Date.now()}-${sequence++}`;
  const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
  const ponto = await apiRequest<{ id: string; nome: string }>('POST', '/api/operacao/pontos-venda', {
    cookie,
    body: { nome: `E2E PDV ${id}` },
  });
  expect(ponto.status, 'ponto de venda E2E criado').toBe(201);

  let nomeProduto = '';
  let produtoId = '';
  if (produto) {
    nomeProduto = `Produto PDV E2E ${id}`;
    const produtoCriado = await apiRequest<{ id: string }>('POST', '/api/operacao/produtos', {
      cookie,
      body: { nome: nomeProduto, precoUnit: 10, exigePreparo: false, controlaEstoque: false },
    });
    expect(produtoCriado.status, 'produto disponivel para venda avulsa criado').toBe(201);
    produtoId = produtoCriado.data.id;
  }

  const caixa = await apiRequest('POST', '/api/operacao/caixa/abrir', {
    cookie,
    body: { pontoVendaId: ponto.data.id, trocoInicial: 0 },
  });
  expect(caixa.status, 'caixa do ponto E2E aberto').toBe(201);

  if (produtoId) {
    const cardapio = await apiRequest('PUT', `/api/operacao/caixa/cardapio?pontoVendaId=${ponto.data.id}`, {
      cookie,
      body: { produtoIds: [produtoId] },
    });
    expect(cardapio.status, 'produto de teste incluído no cardápio do turno').toBe(200);
  }

  return { ...ponto.data, nomeProduto };
}

test.describe('Quiosque comandas', () => {
  test('caixa fechado oferece CTA funcional para abrir', async ({ page }) => {
    const id = `${Date.now()}-${sequence++}`;
    const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const ponto = await apiRequest<{ id: string; nome: string }>('POST', '/api/operacao/pontos-venda', {
      cookie,
      body: { nome: `E2E PDV fechado ${id}` },
    });
    expect(ponto.status).toBe(201);
    await page.goto('/operacao/comandas');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.data.id);
    await expect(page.getByText(/Abra o caixa para iniciar um novo turno/)).toBeVisible();
    await page.getByRole('link', { name: 'Abrir caixa', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir caixa', exact: true })).toBeEnabled();
  });

  test('dono quiosque exclusivo abre hub de comandas como na cervejaria', async ({ page }) => {
    const ponto = await prepararPdvAberto();
    await page.goto('/operacao/comandas');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.id);
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Comandas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nova comanda', exact: true })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Venda avulsa', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Abrir QR Code para comandas' })).toBeVisible();
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
    await page.locator('#portal-pdv-telefone').fill('11987654321');
    await expect(page.locator('#portal-pdv-nome')).toHaveAttribute('placeholder', 'Digite seu nome');
    await page.locator('#portal-pdv-nome').fill('Cliente QR E2E');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await expect(page.getByRole('heading', { name: 'Cliente QR E2E' })).toBeVisible();

    const repetida = await apiRequest<{ reused: boolean }>('POST', `/api/public/cervejarias/${slug}/pontos-venda/${ponto.id}/comandas`, {
      body: { nome: 'Cliente QR E2E', telefone: '11987654321' },
    });
    expect(repetida.status, 'segunda abertura retorna a comanda existente').toBe(200);
    expect(repetida.data.reused).toBe(true);
  });

  test('portal do cliente no modo por caixa envia pedido para a comanda aberta', async ({ page }) => {
    const ponto = await prepararPdvAberto({ produto: true });
    const cookie = await apiLogin(CREDENTIALS.quiosque.email, CREDENTIALS.quiosque.password);
    const perfil = await apiRequest<{ cervejaria: { slug: string } }>('GET', '/api/auth/me', { cookie });
    expect(perfil.status).toBe(200);
    const slug = perfil.data.cervejaria.slug;
    const nomeCliente = `Cliente E2E ${Date.now()}`;
    const telefone = `119${String(Date.now()).slice(-8)}`;

    await page.context().clearCookies();
    await page.goto(`/c/${slug}/p/${ponto.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
    const telefonePortal = page.locator('#portal-pdv-telefone');
    const nomePortal = page.locator('#portal-pdv-nome');
    await telefonePortal.fill(telefone);
    await expect(telefonePortal).toHaveValue(/^\(\d{2}\) \d \d{4}-\d{4}$/);
    // A busca pelo telefone pode limpar o nome quando ainda não há cadastro;
    // aguarde a busca terminar e preencha o nome depois para evitar corrida.
    await expect(nomePortal).toHaveAttribute('placeholder', 'Digite seu nome');
    await nomePortal.fill(nomeCliente);
    await expect(nomePortal).toHaveValue(nomeCliente);
    await expect(telefonePortal).toHaveValue(/^\(\d{2}\) \d \d{4}-\d{4}$/);
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await expect(page.getByRole('heading', { name: nomeCliente })).toBeVisible();

    const requestsObserved: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') requestsObserved.push(new URL(request.url()).pathname);
    });
    await page.getByRole('button', { name: new RegExp(`^${ponto.nomeProduto}`) }).click();
    await expect(page.getByRole('button', { name: 'Enviar pedido', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar pedido', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pedidos (0)', exact: true })).toBeVisible({ timeout: 15_000 });
    expect(requestsObserved, `POSTs observados: ${requestsObserved.join(', ')}`).toContain(`/api/public/cervejarias/${slug}/pontos-venda/${ponto.id}/comanda/pedidos`);

    const comandas = await apiRequest<Array<{
      cliente?: { nome: string } | null;
      pedidos?: Array<{ itens?: Array<{ nome: string; quantidade: number }> }>;
    }>>('GET', `/api/operacao/comandas?status=ABERTA&pontoVendaId=${ponto.id}`, { cookie });
    expect(comandas.status).toBe(200);
    const comanda = comandas.data.find((item) => item.cliente?.nome === nomeCliente);
    expect(comanda, 'pedido do portal aparece para a equipe do caixa').toBeTruthy();
    expect(comanda?.pedidos?.flatMap((pedido) => pedido.itens ?? [])).toContainEqual(
      expect.objectContaining({ nome: ponto.nomeProduto, quantidade: 1 }),
    );
  });

  test('venda avulsa lista produto disponivel com caixa aberto', async ({ page }) => {
    const ponto = await prepararPdvAberto({ produto: true });
    await page.goto('/operacao/comandas/venda-avulsa');
    await selectPorRotulo(page, 'Ponto de venda').selectOption(ponto.id);
    await expect(page.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible();
    await page.getByRole('button', { name: '+ Item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar item' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: new RegExp(`^${ponto.nomeProduto}\\b`) })).toBeVisible();
  });
});
