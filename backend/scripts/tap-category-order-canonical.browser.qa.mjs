import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp, setupSocketIO } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { AUTH_COOKIE_NAME } from '../src/lib/security-config.js';
import { normalizarNomeCategoria } from '../src/lib/operacao/catalogo-categorias.js';
import { CATEGORIA_CHOPE_TAP_ORDEM_ID } from '../src/lib/operacao/categorias.js';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const here = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const app = await buildApp();
setupSocketIO(app, app.server);
await app.ready();
const suffix = randomBytes(5).toString('hex');
const checks = [];
let browser;
let vite;
let commandId;

function log(message) { process.stdout.write(`${message}\n`); }
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function check(name, fn) { log(`RUN ${name}`); await fn(); checks.push(name); log(`PASS ${name}`); }
async function availablePort(start) {
  for (let port = start; port < start + 30; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close((error) => resolve(!error)));
    });
    if (free) return port;
  }
  throw new Error('No free category ordering browser QA port.');
}
async function inject(request) { return app.inject(request); }

async function makeTenant({ name, tapsEnabled, order }) {
  const company = await prisma.cervejaria.create({ data: {
    nome: `${name} ${suffix}`,
    slug: `${name.toLowerCase().replaceAll(' ', '-')}-${suffix}`,
    usaCardapio: true,
    ...(order ? { operacaoCategoriasOrdem: { catalogo: order } } : {}),
  } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: `${name} PDV`, ativo: true, usaCaixa: true } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, exclusivo: true } });
  await prisma.configuracaoOperacional.create({ data: {
    cervejariaId: company.id,
    setupCompletedAt: new Date('2026-10-01T00:00:00.000Z'),
    directSalesEnabled: true,
    plannedOperationsEnabled: false,
    tapsEnabled,
    inventoryEnabled: false,
    kitchenEnabled: false,
  } });
  await prisma.configuracaoPontoVenda.create({ data: {
    cervejariaId: company.id,
    pontoVendaId: point.id,
    tapsEnabled,
    inventoryEnabled: false,
    kitchenEnabled: false,
    kitchenItemsChargeAtLaunch: false,
    allowCloseComandaWithPendingKitchenOrders: false,
    whatsappPedidoProntoEnabled: false,
    whatsappPedidoProntoNaCozinha: false,
  } });
  const [bebidas, porcoes] = await Promise.all(['Bebidas', 'Porções'].map((nome) => prisma.categoriaProdutoPdv.create({
    data: { cervejariaId: company.id, nome, nomeNormalizado: normalizarNomeCategoria(nome), gamificada: false },
  })));
  const owner = await prisma.usuario.create({ data: {
    nome: `${name} Owner QA`, email: `${name.replaceAll(' ', '-').toLowerCase()}-${suffix}@qa.invalid`,
    senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO',
  } });
  const denied = await prisma.usuario.create({ data: {
    nome: `${name} Denied QA`, email: `${name.replaceAll(' ', '-').toLowerCase()}-denied-${suffix}@qa.invalid`,
    senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: ['command.read'],
  } });
  return { company, point, owner, denied, bebidas, porcoes };
}

try {
  const enabled = await makeTenant({ name: 'TAP Sort Enabled', tapsEnabled: true, order: ['Bebidas', 'Porções'] });
  const disabled = await makeTenant({ name: 'TAP Sort Disabled', tapsEnabled: false, order: ['Porções', 'Bebidas'] });

  const product = await prisma.produto.create({ data: {
    cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, categoriaPdvId: enabled.bebidas.id,
    nome: 'Vinho Order QA', categoria: enabled.bebidas.nome, tipo: 'BEBIDA', formato: 'CHOPE', ativo: true,
  } });
  const prices = [{ volumeMl: 300, preco: '11.00' }, { volumeMl: 500, preco: '23.00' }, { volumeMl: 700, preco: '37.00' }];
  await prisma.preco.createMany({ data: prices.map((price) => ({ produtoId: product.id, ...price })) });
  const food = await prisma.produto.create({ data: {
    cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, categoriaPdvId: enabled.porcoes.id,
    nome: 'Porção Order QA', categoria: enabled.porcoes.nome, tipo: 'COMIDA', formato: null, ativo: true,
  } });
  const packagedDrink = await prisma.produto.create({ data: {
    cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, categoriaPdvId: enabled.bebidas.id,
    nome: 'Bebida Order QA', categoria: enabled.bebidas.nome, tipo: 'BEBIDA', formato: 'LATA', ativo: true,
  } });
  const cardapio = await prisma.cardapio.create({ data: {
    cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id,
    nome: `TAP sort menu ${suffix}`, ativo: true, chopeVolumesConfigurados: true,
  } });
  await prisma.cardapioProduto.createMany({ data: [
    ...prices.map((price) => ({ cardapioId: cardapio.id, produtoId: product.id, cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, volumeMl: price.volumeMl, precoUnit: price.preco })),
    { cardapioId: cardapio.id, produtoId: food.id, cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, volumeMl: 0, precoUnit: '12.00' },
    { cardapioId: cardapio.id, produtoId: packagedDrink.id, cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, volumeMl: 0, precoUnit: '7.00' },
  ] });
  const tap = await prisma.tap.create({ data: { cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, numero: 1, ativo: true, produtoId: product.id } });

  await check('API gates synthetic Chopes by tenant PDV, permission, and canonical category identity', async () => {
    const enabledOrder = await inject({ method: 'GET', url: '/api/produtos/categorias-comanda/ordem', headers: auth(enabled.owner) });
    assert.equal(enabledOrder.statusCode, 200, enabledOrder.body);
    assert.deepEqual(enabledOrder.json().ordem, ['Bebidas', 'Porções', CATEGORIA_CHOPE_TAP_ORDEM_ID]);
    const disabledOrder = await inject({ method: 'GET', url: '/api/produtos/categorias-comanda/ordem', headers: auth(disabled.owner) });
    assert.deepEqual(disabledOrder.json().ordem, ['Porções', 'Bebidas']);
    const denied = await inject({ method: 'PUT', url: '/api/produtos/categorias-comanda/ordem', headers: auth(enabled.denied), payload: { ordem: [CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas', 'Porções'] } });
    assert.equal(denied.statusCode, 403, denied.body);
    const forbiddenHidden = await inject({ method: 'PUT', url: '/api/produtos/categorias-comanda/ordem', headers: auth(disabled.owner), payload: { ordem: [CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Porções', 'Bebidas'] } });
    assert.equal(forbiddenHidden.statusCode, 400, forbiddenHidden.body);
    const catalogCategories = await inject({ method: 'GET', url: '/api/operacao/produtos/categorias', headers: auth(enabled.owner) });
    assert.deepEqual(catalogCategories.json().ordem, ['Bebidas', 'Porções'], 'catalog products keep real categories only');
    assert.equal(await prisma.categoriaProdutoPdv.count({ where: { cervejariaId: enabled.company.id } }), 2, 'the synthetic tab never creates a catalog category');
    const foreignRaw = (await prisma.cervejaria.findUniqueOrThrow({ where: { id: disabled.company.id }, select: { operacaoCategoriasOrdem: true } })).operacaoCategoriasOrdem;
    assert.deepEqual(foreignRaw.catalogo, ['Porções', 'Bebidas'], 'saving enabled tenant preferences does not alter another tenant');
  });

  const port = await availablePort(4184);
  const vitePath = path.resolve(here, '../../frontend/node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--configLoader', 'runner'], {
    cwd: path.resolve(here, '../../frontend'), windowsHide: true, stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let viteReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (vite.exitCode !== null) throw new Error(`Vite exited before category order QA (code ${vite.exitCode}).`);
    try { const response = await fetch(baseUrl); if (response.ok) { viteReady = true; break; } } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(viteReady, true, 'Vite must serve the actual frontend during category order QA.');
  const playwrightPath = path.resolve(here, '../../../../node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const token = signUserToken(app, enabled.owner);
  await mkdir(path.resolve(here, '../../artifacts/category-order'), { recursive: true });
  await context.addCookies([{ name: AUTH_COOKIE_NAME, value: token, url: baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const apiRequests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const headers = await request.allHeaders();
    for (const name of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[name];
    const response = await inject({
      method: request.method(), url: `${requestUrl.pathname}${requestUrl.search}`, headers,
      payload: request.postDataBuffer() ?? undefined,
    });
    apiRequests.push({ method: request.method(), url: `${requestUrl.pathname}${requestUrl.search}`, status: response.statusCode, body: response.body });
    await route.fulfill({ status: response.statusCode, headers: { 'content-type': response.headers['content-type'] ?? 'application/json; charset=utf-8' }, body: response.body });
  });

  await check('desktop and mobile category organizer use accessible keyboard controls and persist Chopes first', async () => {
    await page.goto(`${baseUrl}/operacao/catalogo`);
    await page.getByRole('button', { name: 'Categorias', exact: true }).click();
    await page.getByRole('heading', { name: 'Organizar categorias' }).waitFor();
    await page.getByText('Chopes', { exact: true }).waitFor();
    const initialOrder = await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizar categorias' }) }).getByRole('listitem').allTextContents();
    assert.deepEqual(initialOrder.map((item) => ['Bebidas', 'Porções', 'Chopes'].find((name) => item.includes(name))), ['Bebidas', 'Porções', 'Chopes'], 'an old category order retains its existing sequence and gives Chopes a default position');
    const moveUp = page.getByRole('button', { name: 'Mover Chopes para cima', exact: true });
    assert.equal(await moveUp.count(), 1);
    await moveUp.focus();
    assert.equal(await moveUp.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Mover Chopes para cima', exact: true }).focus();
    await page.keyboard.press('Space');
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizar categorias' }) }).getByRole('listitem').first().getByText('Chopes', { exact: true }).waitFor();
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/produtos/categorias-comanda/ordem') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salvar ordem', exact: true }).click();
    assert.equal((await saved).status(), 200);
    const stored = (await prisma.cervejaria.findUniqueOrThrow({ where: { id: enabled.company.id }, select: { operacaoCategoriasOrdem: true } })).operacaoCategoriasOrdem;
    assert.deepEqual(stored.catalogo, [CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas', 'Porções']);
    const reloadedOrder = await inject({ method: 'GET', url: '/api/produtos/categorias-comanda/ordem', headers: auth(enabled.owner) });
    assert.deepEqual(reloadedOrder.json().ordem, stored.catalogo, 'API reads back the PostgreSQL order after save');
    await page.reload();
    await page.getByRole('button', { name: 'Categorias', exact: true }).click();
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizar categorias' }) }).getByRole('listitem').first().getByText('Chopes', { exact: true }).waitFor();
    await page.screenshot({ path: path.resolve(here, '../../artifacts/category-order/organizer-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 915 });
    await page.screenshot({ path: path.resolve(here, '../../artifacts/category-order/organizer-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.ok(apiRequests.some((request) => request.url === '/api/produtos/categorias-comanda/ordem' && request.method === 'GET' && request.status === 200));
  });

  await check('comanda modal opens in Chopes and keeps the Tap, volume, and server price flow', async () => {
    await page.goto(`${baseUrl}/operacao/caixa`);
    await page.getByRole('button', { name: 'Cardápio salvo', exact: true }).click();
    await page.getByRole('radio', { name: new RegExp(`TAP sort menu ${suffix}`) }).click();
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    const opened = page.waitForResponse((response) => response.url().includes('/api/operacao/caixa/abrir') && response.status() === 201);
    await page.getByRole('button', { name: 'Confirmar e abrir caixa' }).click();
    await opened;
    const session = await prisma.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: enabled.company.id, pontoVendaId: enabled.point.id, status: 'ABERTO' } });
    assert.equal(await prisma.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId: session.id, produtoId: product.id } }), 3);
    await page.goto(`${baseUrl}/operacao/comandas/nova`);
    await page.locator('input[type="tel"]').fill('2025550151');
    await page.locator('input[placeholder="Digite o nome..."]').fill('TAP order QA');
    const created = page.waitForResponse((response) => response.url().endsWith('/api/operacao/comandas') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    commandId = (await (await created).json()).id;
    await page.waitForURL(new RegExp(`/operacao/comandas/${commandId}$`));
    await page.getByRole('button', { name: '+ Itens' }).click();
    await page.getByRole('dialog').locator('.segmented-control button').first().waitFor();
    const modalOrderResponse = apiRequests.filter((request) => request.url === '/api/produtos/categorias-comanda/ordem').at(-1);
    assert.equal(JSON.parse(modalOrderResponse.body).catalogoCanonico, true, `modal must consume canonical shared ordering; got ${modalOrderResponse.body}`);
    const operationalProductsResponse = apiRequests.filter((request) => request.url.startsWith('/api/operacao/produtos?pontoVendaId=')).at(-1);
    assert.ok(operationalProductsResponse, 'modal loads real operational products');
    assert.ok(operationalProductsResponse.body.includes(enabled.porcoes.nome), `operational product keeps its canonical category; got ${operationalProductsResponse.body}`);
    let tabNames = await page.getByRole('dialog').locator('.segmented-control button').allTextContents();
    assert.deepEqual(tabNames, ['Chopes', 'Bebidas', 'Porções']);
    assert.match(await page.getByRole('button', { name: 'Chopes', exact: true }).getAttribute('class'), /segmented-control-btn-active/);
    await page.getByRole('button', { name: 'Selecionar Tap 01, Vinho Order QA' }).click();
    await page.getByRole('button', { name: /500 ml.*R\$ 23,00/ }).waitFor();
    await page.getByRole('button', { name: /500 ml.*R\$ 23,00/ }).click();
    await page.getByText('Vinho Order QA 500 ml').waitFor();
    await page.getByText('R$ 23,00 cada').waitFor();
    await page.screenshot({ path: path.resolve(here, '../../artifacts/category-order/modal-desktop.png') });
    await page.setViewportSize({ width: 390, height: 915 });
    await page.screenshot({ path: path.resolve(here, '../../artifacts/category-order/modal-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const launch = page.waitForResponse((response) => response.url().includes('/pedidos') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Adicionar à comanda', exact: true }).click();
    assert.ok([200, 201].includes((await launch).status()));
    const savedItem = await prisma.itemComanda.findFirstOrThrow({ where: { comandaId: commandId } });
    assert.deepEqual([savedItem.produtoId, savedItem.tapId, savedItem.volumeMl, Number(savedItem.precoUnit)], [product.id, tap.id, 500, 23]);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  });

  await check('new Chopes position drives modal order, disabled taps hide it, and re-enable restores it', async () => {
    await page.goto(`${baseUrl}/operacao/catalogo`);
    await page.getByRole('button', { name: 'Categorias', exact: true }).click();
    const moveDown = page.getByRole('button', { name: 'Mover Chopes para baixo', exact: true });
    await moveDown.click();
    const saveOtherPosition = page.waitForResponse((response) => response.url().endsWith('/api/produtos/categorias-comanda/ordem') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salvar ordem', exact: true }).click();
    assert.equal((await saveOtherPosition).status(), 200);
    let stored = (await prisma.cervejaria.findUniqueOrThrow({ where: { id: enabled.company.id }, select: { operacaoCategoriasOrdem: true } })).operacaoCategoriasOrdem;
    assert.deepEqual(stored.catalogo, ['Bebidas', CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Porções']);
    await page.goto(`${baseUrl}/operacao/comandas/${commandId}`);
    await page.getByRole('button', { name: '+ Itens' }).click();
    let tabNames = await page.getByRole('dialog').locator('.segmented-control button').allTextContents();
    assert.deepEqual(tabNames, ['Bebidas', 'Chopes', 'Porções']);
    assert.match(await page.getByRole('button', { name: 'Bebidas', exact: true }).getAttribute('class'), /segmented-control-btn-active/);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    const disable = await inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: auth(enabled.owner), payload: { tapsEnabled: false } });
    assert.equal(disable.statusCode, 200, disable.body);
    await page.reload();
    await page.getByRole('button', { name: '+ Itens' }).click();
    tabNames = await page.getByRole('dialog').locator('.segmented-control button').allTextContents();
    assert.equal(tabNames.length, 2, 'only populated non-chope sections remain when taps are disabled');
    assert.equal(tabNames.includes('Chopes'), false);
    assert.ok(tabNames.every((name) => ['Bebidas', 'Porções', 'Comidas'].includes(name)), `only supported populated sections remain: ${tabNames.join(', ')}`);
    assert.equal(await page.getByRole('button', { name: 'Chopes', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    await page.goto(`${baseUrl}/operacao/catalogo`);
    await page.getByRole('button', { name: 'Categorias', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Mover Chopes para cima', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Mover Porções para cima', exact: true }).click();
    const disabledSave = page.waitForResponse((response) => response.url().endsWith('/api/produtos/categorias-comanda/ordem') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salvar ordem', exact: true }).click();
    assert.equal((await disabledSave).status(), 200);
    stored = (await prisma.cervejaria.findUniqueOrThrow({ where: { id: enabled.company.id }, select: { operacaoCategoriasOrdem: true } })).operacaoCategoriasOrdem;
    assert.deepEqual(stored.catalogo, ['Porções', CATEGORIA_CHOPE_TAP_ORDEM_ID, 'Bebidas'], 'hidden position remains in PostgreSQL when taps are disabled');
    const hiddenRead = await inject({ method: 'GET', url: '/api/produtos/categorias-comanda/ordem', headers: auth(enabled.owner) });
    assert.deepEqual(hiddenRead.json().ordem, ['Porções', 'Bebidas']);

    const enable = await inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: auth(enabled.owner), payload: { tapsEnabled: true } });
    assert.equal(enable.statusCode, 200, enable.body);
    const restoredRead = await inject({ method: 'GET', url: '/api/produtos/categorias-comanda/ordem', headers: auth(enabled.owner) });
    assert.deepEqual(restoredRead.json().ordem, stored.catalogo, 'reativation restores the exact stored position');
    await page.goto(`${baseUrl}/operacao/comandas/${commandId}`);
    await page.reload();
    await page.getByRole('button', { name: '+ Itens' }).click();
    tabNames = await page.getByRole('dialog').locator('.segmented-control button').allTextContents();
    assert.deepEqual(tabNames, ['Porções', 'Chopes', 'Bebidas']);
    assert.match(await page.getByRole('button', { name: 'Porções', exact: true }).getAttribute('class'), /segmented-control-btn-active/);
    await page.getByRole('button', { name: 'Chopes', exact: true }).click();
    await page.getByRole('button', { name: 'Selecionar Tap 01, Vinho Order QA' }).waitFor();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  });

  log(`PASS TAP_CATEGORY_ORDER_BROWSER_CHECKS=${checks.length}`);
  log(`QA_CATEGORY_ORDER_SCREENSHOTS=artifacts/category-order/organizer-desktop.png,artifacts/category-order/organizer-mobile.png,artifacts/category-order/modal-desktop.png,artifacts/category-order/modal-mobile.png`);
} finally {
  await browser?.close();
  if (vite && vite.exitCode === null) { vite.kill(); }
  await app.close();
  await prisma.$disconnect();
}
