import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp, setupSocketIO } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { AUTH_COOKIE_NAME } from '../src/lib/security-config.js';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const here = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const app = await buildApp();
setupSocketIO(app, app.server);
await app.ready();
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const checks = [];
let browser;
let vite;
let session;
let commandId;
let duplicateRetryObserved = false;

function log(message) { process.stdout.write(`${message}\n`); }
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function getOpenPort(start) {
  for (let port = start; port < start + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close((error) => resolve(!error)));
    });
    if (available) return port;
  }
  throw new Error('No free local browser QA port.');
}
async function inject(request) { return app.inject(request); }
async function check(name, fn) { log(`RUN ${name}`); await fn(); checks.push(name); log(`PASS ${name}`); }

try {
  const company = await prisma.cervejaria.create({ data: { nome: `TAP-121 Browser QA ${suffix}`, slug: `tap121-browser-${suffix}` } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'PDV Browser QA', ativo: true, usaCaixa: true } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, exclusivo: true } });
  await prisma.configuracaoOperacional.create({ data: { cervejariaId: company.id, setupCompletedAt: new Date('2026-10-01T00:00:00.000Z'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: false } });
  await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  const owner = await prisma.usuario.create({ data: { nome: 'TAP-121 QA Owner', email: `owner-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO' } });
  const product = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Vinho QA', categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', ativo: true, controlaEstoque: true } });
  const prices = [{ volumeMl: 300, preco: '11.00' }, { volumeMl: 500, preco: '23.00' }, { volumeMl: 700, preco: '37.00' }];
  await prisma.preco.createMany({ data: prices.map((price) => ({ produtoId: product.id, ...price })) });
  const cardapio = await prisma.cardapio.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `TAP-121 Vinho ${suffix}`, ativo: true, chopeVolumesConfigurados: true } });
  await prisma.cardapioProduto.createMany({ data: prices.map((price) => ({ cardapioId: cardapio.id, produtoId: product.id, cervejariaId: company.id, pontoVendaId: point.id, volumeMl: price.volumeMl, precoUnit: price.preco })) });
  await prisma.inventoryBalance.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, quantidade: '10.000' } });
  const tap = await prisma.tap.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, numero: 1, ativo: true, produtoId: product.id } });
  const outsideProduct = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Vinho fora do cardápio QA', categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', ativo: true, controlaEstoque: true } });
  await prisma.preco.create({ data: { produtoId: outsideProduct.id, volumeMl: 300, preco: '99.00' } });
  const outsideTap = await prisma.tap.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, numero: 2, ativo: true, produtoId: outsideProduct.id } });

  const port = await getOpenPort(4178);
  const vitePath = path.resolve(here, '../../frontend/node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--configLoader', 'runner'], {
    cwd: path.resolve(here, '../../frontend'), windowsHide: true, stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let viteReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (vite.exitCode !== null) throw new Error(`Vite exited before serving QA (code ${vite.exitCode}).`);
    try { const response = await fetch(baseUrl); if (response.ok) { viteReady = true; break; } } catch { /* wait for Vite */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(viteReady, true, 'Vite must serve the actual frontend during browser QA.');

  const playwrightPath = path.resolve(here, '../../../../node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const token = signUserToken(app, owner);
  await context.addCookies([{ name: AUTH_COOKIE_NAME, value: token, url: baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const apiRequests = [];
  let retryNextOrderRequest = true;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const headers = await request.allHeaders();
    for (const name of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[name];
    const payload = request.postDataBuffer() ?? undefined;
    const requestInfo = { method: request.method(), url: `${requestUrl.pathname}${requestUrl.search}`, headers, payload };
    apiRequests.push({ method: requestInfo.method, url: requestInfo.url });
    const response = await inject(requestInfo);
    const isLaunch = requestInfo.method === 'POST' && /^\/api\/operacao\/comandas\/[^/]+\/pedidos$/.test(requestUrl.pathname);
    if (isLaunch && retryNextOrderRequest && response.statusCode === 201) {
      retryNextOrderRequest = false;
      duplicateRetryObserved = true;
      await inject(requestInfo);
    }
    const responseHeaders = { 'content-type': response.headers['content-type'] ?? 'application/json; charset=utf-8' };
    await route.fulfill({ status: response.statusCode, headers: responseHeaders, body: response.body });
  });

  await check('browser opens canonical shift and a comanda through the real frontend and API', async () => {
    await page.goto(`${baseUrl}/operacao/caixa`);
    await page.getByRole('button', { name: 'Cardápio salvo' }).click();
    await page.getByRole('radio', { name: new RegExp(`TAP-121 Vinho ${suffix}`) }).click();
    await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar e abrir caixa' }).click();
    await page.waitForResponse((response) => response.url().includes('/api/operacao/caixa/abrir') && response.status() === 201);
    session = await prisma.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: company.id, pontoVendaId: point.id, status: 'ABERTO' } });
    assert.equal(session.cardapioId, cardapio.id);
    assert.equal(await prisma.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId: session.id, produtoId: product.id } }), 3);

    await page.goto(`${baseUrl}/operacao/comandas/nova`);
    await page.locator('input[type="tel"]').fill('2025550148');
    await page.locator('input[placeholder="Digite o nome..."]').fill('TAP-121 Vinho QA');
    const commandCreateResponse = page.waitForResponse((response) => response.url().endsWith('/api/operacao/comandas') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    commandId = (await (await commandCreateResponse).json()).id;
    assert.ok(commandId);
    await page.waitForURL(new RegExp(`/operacao/comandas/${commandId}$`));
    assert.ok(apiRequests.some((item) => item.url === '/api/operacao/comandas' && item.method === 'POST'));
    await page.getByRole('button', { name: '+ Itens' }).click();
    await page.getByRole('button', { name: 'Chopes', exact: true }).click();
    await page.getByRole('button', { name: 'Selecionar Tap 01, Vinho QA' }).click();
    assert.equal(await page.getByRole('button', { name: 'Selecionar Tap 02, Vinho fora do cardápio QA' }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Selecionar Tap 02, Vinho fora do cardápio QA' }).click();
    await page.getByText('Vinho fora do cardápio QA está montado, mas não foi incluído no cardápio efetivo deste turno.').waitFor();
    await page.getByRole('button', { name: 'Selecionar Tap 01, Vinho QA' }).click();

    for (const volume of [500, 300, 700]) {
      await page.getByRole('button', { name: new RegExp(`${volume} ml`) }).click();
      if (volume === 500) {
        await page.getByRole('button', { name: 'Aumentar quantidade' }).click();
        await page.getByText('Novo total da comanda: R$ 46,00').waitFor();
        await mkdir(path.resolve(here, '../../artifacts/tap121'), { recursive: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.resolve(here, '../../artifacts/tap121/modal-desktop.png') });
        await page.setViewportSize({ width: 390, height: 915 });
        await page.screenshot({ path: path.resolve(here, '../../artifacts/tap121/modal-mobile.png') });
      }
      const responsePromise = page.waitForResponse((response) => response.url().includes('/pedidos') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Adicionar à comanda' }).click();
      const launchResponse = await responsePromise;
      assert.ok([200, 201].includes(launchResponse.status()), await launchResponse.text());
      if (volume !== 700) await page.getByRole('button', { name: new RegExp(`${volume === 500 ? 300 : 700} ml`) }).waitFor();
      if (volume === 500) await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForTimeout(200);
    const command = await prisma.comanda.findUniqueOrThrow({ where: { id: commandId }, include: { itens: { orderBy: { volumeMl: 'asc' } } } });
    assert.deepEqual(command.itens.map((item) => [item.produtoId, item.tapId, item.volumeMl, item.quantidade, Number(item.precoUnit)]), [
      [product.id, tap.id, 300, 1, 11], [product.id, tap.id, 500, 2, 23], [product.id, tap.id, 700, 1, 37],
    ]);
    assert.equal(Number(command.total), 94);
    assert.equal(duplicateRetryObserved, true, 'The browser launch request was replayed once with the same idempotency key.');
    assert.equal(await prisma.portalPedidoOperacaoRequest.count({ where: { comandaId: commandId } }), 3);
    assert.equal(await prisma.itemComanda.count({ where: { comandaId: commandId } }), 3);
  });

  await check('tampered price, incompatible Tap, unavailable menu product, and foreign tenant access are rejected', async () => {
    const command = await prisma.comanda.findUniqueOrThrow({ where: { id: commandId } });
    const tampered = await inject({ method: 'POST', url: `/api/operacao/comandas/${command.id}/pedidos`, headers: auth(owner), payload: { idempotencyKey: randomUUID(), itens: [{ produtoId: product.id, quantidade: 1, tapId: tap.id, volumeMl: 300, precoUnit: 0.01 }] } });
    assert.equal(tampered.statusCode, 400);
    const incompatible = await inject({ method: 'POST', url: `/api/operacao/comandas/${command.id}/pedidos`, headers: auth(owner), payload: { idempotencyKey: randomUUID(), itens: [{ produtoId: product.id, quantidade: 1, tapId: outsideTap.id, volumeMl: 300 }] } });
    assert.equal(incompatible.statusCode, 400);
    const unavailable = await inject({ method: 'POST', url: `/api/operacao/comandas/${command.id}/pedidos`, headers: auth(owner), payload: { idempotencyKey: randomUUID(), itens: [{ produtoId: outsideProduct.id, quantidade: 1, tapId: outsideTap.id, volumeMl: 300 }] } });
    assert.equal(unavailable.statusCode, 400);
    assert.equal(await prisma.itemComanda.count({ where: { comandaId: command.id } }), 3);
    const foreignCompany = await prisma.cervejaria.create({ data: { nome: `TAP-121 Foreign QA ${suffix}`, slug: `tap121-foreign-${suffix}` } });
    const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Foreign PDV QA', ativo: true, usaCaixa: true } });
    await prisma.configuracaoOperacao.create({ data: { cervejariaId: foreignCompany.id, ativo: true, exclusivo: true } });
    await prisma.configuracaoOperacional.create({ data: { cervejariaId: foreignCompany.id, setupCompletedAt: new Date('2026-10-01T00:00:00.000Z'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } });
    await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: foreignCompany.id, pontoVendaId: foreignPoint.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
    const foreignOwner = await prisma.usuario.create({ data: { nome: 'Foreign QA Owner', email: `foreign-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: foreignCompany.id, papel: 'DONO' } });
    const crossTenant = await inject({ method: 'GET', url: `/api/operacao/comandas/${command.id}`, headers: auth(foreignOwner) });
    assert.equal(crossTenant.statusCode, 404);
  });

  await check('partial and full cancellation reconcile exact liters, net sales, payment, and cash summary', async () => {
    const command1 = await prisma.comanda.findUniqueOrThrow({ where: { id: commandId } });
    const paid1 = await inject({ method: 'POST', url: `/api/operacao/comandas/${command1.id}/pagamentos`, headers: auth(owner), payload: { pagamentos: [{ forma: 'PIX', valor: 94 }] } });
    assert.equal(paid1.statusCode, 200, paid1.body);
    assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: command1.id } })).status, 'FECHADA');

    const command2Response = await inject({ method: 'POST', url: '/api/operacao/comandas', headers: auth(owner), payload: { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `Cancel QA ${suffix}`, clienteNome: `Cancel QA ${suffix}`, clienteTelefone: '2025550149', itens: [] } });
    assert.equal(command2Response.statusCode, 201, command2Response.body);
    const command2Id = command2Response.json().id;
    for (const item of [{ volumeMl: 500, quantidade: 2 }, { volumeMl: 700, quantidade: 1 }]) {
      const response = await inject({ method: 'POST', url: `/api/operacao/comandas/${command2Id}/pedidos`, headers: auth(owner), payload: { idempotencyKey: randomUUID(), itens: [{ produtoId: product.id, quantidade: item.quantidade, tapId: tap.id, volumeMl: item.volumeMl }] } });
      assert.equal(response.statusCode, 201, response.body);
    }
    const lines = await prisma.itemComanda.findMany({ where: { comandaId: command2Id }, orderBy: { volumeMl: 'asc' } });
    const partial = await inject({ method: 'DELETE', url: `/api/operacao/comandas/${command2Id}/itens/${lines.find((item) => item.volumeMl === 500).id}`, headers: auth(owner), payload: { quantidade: 1, quantidadeEsperada: 2, motivo: 'QA erro de lançamento', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID() } });
    assert.equal(partial.statusCode, 200, partial.body);
    const full = await inject({ method: 'DELETE', url: `/api/operacao/comandas/${command2Id}/itens/${lines.find((item) => item.volumeMl === 700).id}`, headers: auth(owner), payload: { quantidade: 1, quantidadeEsperada: 1, motivo: 'QA erro de lançamento', tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID() } });
    assert.equal(full.statusCode, 200, full.body);
    const net = await prisma.comanda.findUniqueOrThrow({ where: { id: command2Id }, include: { itens: true } });
    assert.equal(Number(net.total), 23);
    assert.deepEqual(net.itens.filter((item) => !item.canceladoEm).map((item) => [item.volumeMl, item.quantidade]), [[500, 1]]);
    assert.equal(net.itens.filter((item) => item.canceladoEm).length, 1, 'full cancellation preserves the historical line');
    const paid2 = await inject({ method: 'POST', url: `/api/operacao/comandas/${command2Id}/pagamentos`, headers: auth(owner), payload: { pagamentos: [{ forma: 'PIX', valor: 23 }] } });
    assert.equal(paid2.statusCode, 200, paid2.body);

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: point.id, produtoId: product.id } } });
    assert.equal(Number(balance.quantidade), 7.5);
    const movements = await prisma.inventoryMovement.findMany({ where: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id }, select: { tipo: true, quantidade: true } });
    assert.equal(movements.filter((item) => item.tipo === 'SAIDA_VENDA').reduce((sum, item) => sum + Number(item.quantidade), 0), 3.7);
    assert.equal(movements.filter((item) => item.tipo === 'ESTORNO_VENDA').reduce((sum, item) => sum + Number(item.quantidade), 0), 1.2);
    const payments = await prisma.pagamento.findMany({ where: { comandaId: { in: [command1.id, command2Id] } } });
    assert.equal(payments.reduce((sum, payment) => sum + Number(payment.valor), 0), 117);
    assert.equal(payments.length, 2);
    const cash = await inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: auth(owner) });
    assert.equal(cash.statusCode, 200, cash.body);
    assert.equal(Number(cash.json().sessao.esperado.pix), 117);
    log(`RECONCILIATION {openingStockL:10,soldGrossL:3.7,returnedL:1.2,netSoldL:2.5,endingStockL:${Number(balance.quantidade)},grossPaid:117,netCommand2:23}`);
  });

  await check('stock-disabled synthetic sales do not claim inventory control or write stock movements', async () => {
    const disabledCompany = await prisma.cervejaria.create({ data: { nome: `TAP-121 No Stock QA ${suffix}`, slug: `tap121-nostock-${suffix}` } });
    const disabledPoint = await prisma.pontoVenda.create({ data: { cervejariaId: disabledCompany.id, nome: 'No Stock QA', ativo: true, usaCaixa: true } });
    await prisma.configuracaoOperacao.create({ data: { cervejariaId: disabledCompany.id, ativo: true, exclusivo: true } });
    await prisma.configuracaoOperacional.create({ data: { cervejariaId: disabledCompany.id, setupCompletedAt: new Date('2026-10-01T00:00:00.000Z'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } });
    await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: disabledCompany.id, pontoVendaId: disabledPoint.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
    const disabledOwner = await prisma.usuario.create({ data: { nome: 'No Stock QA Owner', email: `nostock-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: disabledCompany.id, papel: 'DONO' } });
    const disabledProduct = await prisma.produto.create({ data: { cervejariaId: disabledCompany.id, pontoVendaId: disabledPoint.id, nome: 'Vinho sem ledger QA', tipo: 'BEBIDA', formato: 'CHOPE', ativo: true, controlaEstoque: true } });
    await prisma.preco.create({ data: { produtoId: disabledProduct.id, volumeMl: 300, preco: 10 } });
    const disabledSession = await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: disabledCompany.id, pontoVendaId: disabledPoint.id, trailerId: null, diaOperacional: new Date('2026-10-23T00:00:00.000Z'), trocoInicial: 0, abertoPorId: disabledOwner.id } });
    await prisma.sessaoCaixaProdutoOperacao.create({ data: { sessaoCaixaId: disabledSession.id, produtoId: disabledProduct.id, volumeMl: 300 } });
    const disabledTap = await prisma.tap.create({ data: { cervejariaId: disabledCompany.id, pontoVendaId: disabledPoint.id, numero: 1, ativo: true } });
    await prisma.tapMontagem.create({ data: { tapId: disabledTap.id, produtoId: disabledProduct.id, sessaoCaixaId: disabledSession.id } });
    const disabledSale = await inject({ method: 'POST', url: '/api/operacao/vendas', headers: auth(disabledOwner), payload: { pontoVendaId: disabledPoint.id, itens: [{ produtoId: disabledProduct.id, quantidade: 1, tapId: disabledTap.id, volumeMl: 300 }], pagamentos: [{ forma: 'PIX', valor: 10 }] } });
    assert.equal(disabledSale.statusCode, 201, disabledSale.body);
    assert.equal(await prisma.inventoryMovement.count({ where: { cervejariaId: disabledCompany.id } }), 0);
    log('INVENTORY_DISABLED mode: sale accepted; no inventory ledger asserted.');
  });

  assert.equal(await prisma.inventoryMovement.count({ where: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, tipo: 'ESTORNO_VENDA' } }), 2);
  assert.ok(session?.id);
  log(`PASS TAP121_BROWSER_CHECKS=${checks.length}`);
  log('QA_TAP121_SCREENSHOTS=artifacts/tap121/modal-desktop.png,artifacts/tap121/modal-mobile.png');
} finally {
  await browser?.close().catch(() => undefined);
  if (vite && vite.exitCode === null) vite.kill('SIGTERM');
  await app.close();
  await prisma.$disconnect();
}
