import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiRequest } from './helpers/api';
import { CREDENTIALS } from './helpers/auth';
import { getCanonicalPdv, getCashState } from './helpers/canonical-operation-fixture';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

let consoleErrors: string[] = [];
let failedRequests: string[] = [];
let auditBeaconAborts: string[] = [];
let unexpectedHttpErrors: string[] = [];
let clientHttpErrors: string[] = [];
let loginHttpResponses: string[] = [];
let auditHttpResponses: number[] = [];
let journeyFacts: Record<string, unknown> = {};

test.beforeEach(() => {
  consoleErrors = [];
  failedRequests = [];
  auditBeaconAborts = [];
  unexpectedHttpErrors = [];
  clientHttpErrors = [];
  loginHttpResponses = [];
  auditHttpResponses = [];
  journeyFacts = {};
});

test.afterEach(async ({ page }, testInfo) => {
  const artifactDir = process.env.E2E_SMOKE_ARTIFACT_DIR;
  if (!artifactDir) return;
  fs.mkdirSync(artifactDir, { recursive: true });
  const width = process.env.E2E_VIEWPORT_WIDTH ?? 'unknown';
  const journeyScreenshot = path.join(artifactDir, `smoke-${width}-journey.png`);
  if (!fs.existsSync(journeyScreenshot)) {
    await page.screenshot({ path: path.join(artifactDir, `smoke-${width}-${testInfo.status}.png`), fullPage: true }).catch(() => undefined);
  }
  fs.writeFileSync(path.join(artifactDir, `smoke-${width}-network-console.json`), JSON.stringify({
    viewport: width,
    testStatus: testInfo.status,
    consoleErrors,
    failedRequests,
    auditBeaconAborts,
    unexpectedHttpErrors,
    clientHttpErrors,
    loginHttpResponses,
    auditHttpResponses,
    ...journeyFacts,
  }, null, 2) + '\n', { encoding: 'utf8' });
});

test('jornada integrada autenticada no PDV canônico', async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname;
    const failure = request.failure()?.errorText ?? 'failed';
    const entry = `${request.method()} ${pathname}: ${failure}`;
    // audit-tracker uses sendBeacon on beforeunload; Chromium may report this unload beacon as ERR_ABORTED.
    if (request.method() === 'POST' && pathname === '/api/audit/events' && failure === 'net::ERR_ABORTED') auditBeaconAborts.push(entry);
    else failedRequests.push(entry);
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/api/auth/login') {
      loginHttpResponses.push(`${response.status()} /api/auth/login`);
    }
    if (pathname === '/api/audit/events') auditHttpResponses.push(response.status());
    if (response.status() >= 500) unexpectedHttpErrors.push(`${response.status()} ${pathname}`);
    else if (response.status() >= 400) clientHttpErrors.push(`${response.status()} ${pathname}`);
  });

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(CREDENTIALS.quiosque.email);
  await page.locator('#password').fill(CREDENTIALS.quiosque.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === 'token');
  expect(sessionCookie, 'login Playwright deve criar cookie de sessão').toBeTruthy();
  const cookie = `token=${sessionCookie!.value}`;
  const pdv = await getCanonicalPdv(cookie);

  const stamp = `${Date.now()}-${process.env.E2E_VIEWPORT_WIDTH ?? 'viewport'}`;
  const productName = `Smoke QA ${stamp}`;
  const createdProduct = await apiRequest<{ id: string }>('POST', '/api/operacao/produtos', {
    cookie,
    body: { nome: productName, categoria: 'Comidas', precoUnit: 13, exigePreparo: false, controlaEstoque: false },
  });
  expect(createdProduct.status, 'produto sintético criado para a jornada').toBe(201);

  const cash = await getCashState(cookie, pdv.id);
  if (cash.sessao?.status === 'ABERTO') {
    const menu = await apiRequest('PUT', `/api/operacao/caixa/cardapio?pontoVendaId=${pdv.id}`, {
      cookie,
      body: { produtoIds: [createdProduct.data.id] },
    });
    expect(menu.status, 'produto sintético incluído no cardápio do turno QA').toBe(200);
  } else {
    const opened = await apiRequest('POST', '/api/operacao/caixa/abrir', {
      cookie,
      body: { pontoVendaId: pdv.id, trocoInicial: 0, produtoIds: [createdProduct.data.id] },
    });
    expect(opened.status, 'abertura do caixa canônico QA').toBe(201);
  }

  const comandasNavigation = page.getByRole('link', { name: 'Comandas', exact: true });
  await expect(comandasNavigation).toBeVisible();
  await comandasNavigation.click();
  await expect(page).toHaveURL(/\/operacao\/comandas$/);
  await expect(page.getByText(/Caixa aberto/)).toBeVisible();
  const newComandaLink = page.getByRole('link', { name: /Nova comanda/ }).first();
  await expect(newComandaLink).toBeEnabled();
  await newComandaLink.click();
  await page.locator('input[type="tel"]').fill(`119${String(Date.now()).slice(-8)}`);
  const customerName = `Cliente Smoke ${stamp}`;
  await page.getByPlaceholder('Digite o nome...').fill(customerName);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();
  await expect(page.getByRole('heading', { name: customerName })).toBeVisible();

  await page.getByRole('button', { name: '+ Itens' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Adicionar item' });
  await expect(addDialog).toBeVisible();
  await addDialog.getByRole('button', { name: new RegExp(`^${productName}`) }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Adicionar item' }).click();
  await addDialog.getByRole('button', { name: 'Lançar na comanda' }).click();
  await addDialog.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'Resumo da conta', exact: true }).click();
  const accountTotalRow = page.getByText('Total da conta').locator('..');
  await expect(accountTotalRow).toBeVisible();
  await expect(accountTotalRow.getByText('R$ 13,00', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Fechar Comanda/ }).click();
  const paymentDialog = page.getByRole('dialog');
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByRole('button', { name: /Revisar pagamento/ }).click();
  await paymentDialog.getByRole('button', { name: /Efetuar pagamento/ }).click();
  await expect(page.getByText(/Pagamento confirmado/)).toBeVisible();

  const detailUrl = page.url();
  const comandaId = detailUrl.split('/').pop()!;
  const persisted = await apiRequest<{
    status: string;
    total: number | string;
    pagamentos: Array<{ valor: number | string }>;
    itens?: unknown[];
  }>('GET', `/api/operacao/comandas/${encodeURIComponent(comandaId)}`, { cookie });
  expect(persisted.status).toBe(200);
  expect(persisted.data.status).toBe('FECHADA');
  expect(Number(persisted.data.total)).toBe(13);
  expect(persisted.data.pagamentos.reduce((total, payment) => total + Number(payment.valor), 0)).toBe(13);
  journeyFacts = {
    pdvId: pdv.id,
    comandaId,
    persistedTotal: Number(persisted.data.total),
    persistedPayments: persisted.data.pagamentos.map((payment) => Number(payment.valor)),
  };

  expect(auditHttpResponses.every((status) => status < 400), `audit HTTP responses: ${auditHttpResponses.join(', ')}`).toBe(true);

  const artifactDir = process.env.E2E_SMOKE_ARTIFACT_DIR;
  if (artifactDir) {
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, `smoke-${process.env.E2E_VIEWPORT_WIDTH ?? 'unknown'}-journey.png`), fullPage: true });
  }

  const actionableConsoleErrors = consoleErrors.filter((message) => !/server responded with a status of (401|404) \(/.test(message));
  expect(actionableConsoleErrors, `console errors: ${actionableConsoleErrors.join(' | ')}`).toEqual([]);
  expect(failedRequests, `failed network requests: ${failedRequests.join(' | ')}`).toEqual([]);
  const unexpectedClientHttpErrors = clientHttpErrors.filter((entry) => !['401 /api/auth/me', '404 /api/public/dev/app-origin'].includes(entry));
  expect(unexpectedClientHttpErrors, `HTTP 4xx: ${unexpectedClientHttpErrors.join(' | ')}`).toEqual([]);
  expect(unexpectedHttpErrors, `HTTP 5xx: ${unexpectedHttpErrors.join(' | ')}`).toEqual([]);

});
