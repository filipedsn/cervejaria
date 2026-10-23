import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { AUTH_COOKIE_NAME } from '../src/lib/security-config.js';
import { chromium } from '../../node_modules/playwright/index.mjs';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const app = await buildApp();
await app.ready();
function day(value) { return new Date(`${value}T00:00:00.000Z`); }
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function check(name, fn) { process.stdout.write(`RUN ${name}\n`); await fn(); process.stdout.write(`PASS ${name}\n`); }
try {
  const company = await prisma.cervejaria.create({ data: { nome: `CIA Ranking QA ${suffix}`, slug: `cia-rank-${suffix}` } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `CIA Outra QA ${suffix}`, slug: `cia-other-${suffix}` } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Principal QA', ativo: true, usaCaixa: true } });
  const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Outro PDV QA', ativo: true, usaCaixa: true } });
  for (const [tenant, pdv] of [[company, point], [foreignCompany, foreignPoint]]) {
    await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenant.id, ativo: true, exclusivo: true } });
    await prisma.configuracaoOperacional.create({ data: { cervejariaId: tenant.id, setupCompletedAt: day('2026-10-01'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } });
    await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: tenant.id, pontoVendaId: pdv.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  }
  const owner = await prisma.usuario.create({ data: { nome: 'Owner QA', email: `owner-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO' } });
  const denied = await prisma.usuario.create({ data: { nome: 'Denied QA', email: `denied-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: [] } });
  const viewer = await prisma.usuario.create({ data: { nome: 'Viewer QA', email: `viewer-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: ['command.read'] } });
  const foreignOwner = await prisma.usuario.create({ data: { nome: 'Foreign QA', email: `foreign-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: foreignCompany.id, papel: 'DONO' } });
  const primaryClient = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const homonym = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const foreignClient = await prisma.cliente.create({ data: { cervejariaId: foreignCompany.id, nome: 'Cliente Homônimo QA', telefone: null } });
  await prisma.clienteEstatisticas.create({ data: { clienteId: primaryClient.id } });
  const agenda = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Sextas QA', diaSemana: 5, primeiraData: day('2025-07-01'), ultimaData: day('2026-11-30'), horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const occurrenceRows = [];
  for (const value of ['2025-07-01', '2026-10-01', '2026-10-31', '2026-11-01']) {
    occurrenceRows.push(await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agenda.id, nome: 'Sextas QA', data: day(value), horaInicio: '18:00', horaFim: '22:00' } }));
  }
  const product = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Chope QA', tipo: 'BEBIDA', formato: 'CHOPE' } });
  async function sale({ client = primaryClient, origin = 'EVENTO', occurrence, operationalDate, volume, status = 'FECHADA', canceled = false, paid = false, discount = 0 }) {
    const command = await prisma.comanda.create({ data: { origem: origin, clienteId: client.id, status, tipo: 'COMANDA', pontoVendaId: point.id, ocorrenciaId: occurrence?.id ?? null, diaOperacional: operationalDate ? day(operationalDate) : null, total: 10 - discount, desconto: discount, fechadaEm: day(occurrence?.data.toISOString().slice(0, 10) ?? operationalDate ?? '2026-10-01') } });
    await prisma.itemComanda.create({ data: { comandaId: command.id, produtoId: product.id, volumeMl: volume, quantidade: 1, precoUnit: 10, ...(canceled ? { canceladoEm: day('2026-10-02') } : {}) } });
    if (paid) await prisma.pagamento.create({ data: { comandaId: command.id, forma: 'PIX', valor: 10 - discount } });
    return command;
  }
  await sale({ occurrence: occurrenceRows[0], volume: 1500, paid: true, discount: 2 });
  await sale({ occurrence: occurrenceRows[1], volume: 500 });
  await sale({ origin: 'CAIXA', occurrence: occurrenceRows[1], operationalDate: '2026-10-01', volume: 300 });
  await sale({ occurrence: occurrenceRows[2], volume: 1000, client: homonym });
  await sale({ occurrence: occurrenceRows[3], volume: 700 });
  await sale({ occurrence: occurrenceRows[1], volume: 900, canceled: true, status: 'CANCELADA' });
  await sale({ client: foreignClient, occurrence: null, volume: 500, status: 'FECHADA' });

  const cardinalityDays = new Map();
  for (const [count, date] of [[1, '2026-12-02'], [2, '2026-12-03'], [3, '2026-12-04'], [12, '2026-12-05']]) {
    const clients = [];
    for (let index = 0; index < count; index++) {
      const clientName = count === 12 && index === 11
        ? `Participante 12 com nome extenso para testar quebra em telas menores QA ${suffix}`
        : `Participante ${String(index + 1).padStart(2, '0')} QA ${suffix}`;
      const client = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: clientName, telefone: null } });
      clients.push(client);
      await sale({ client, origin: 'CAIXA', operationalDate: date, volume: (count - index) * 100 });
    }
    cardinalityDays.set(count, { date, clients });
  }

  await check('ranking is canonical by tenant and PDV and accepts migrated EVENTO and current CAIXA origins', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?ocorrenciaId=${occurrenceRows[1].id}&dia=2026-10-01`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ocorrencia.data, '2026-10-01');
    assert.deepEqual(body.ranking.map((row) => [row.clienteId, row.totalMl]), [[primaryClient.id, 800]]);
    const deniedResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(denied) });
    assert.equal(deniedResponse.statusCode, 403, deniedResponse.body);
    const foreignResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(foreignOwner) });
    assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
  });

  await check('daily API returns the same participant count, total, and stable position for 0, 1, 2, 3, and many participants', async () => {
    const empty = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=2026-12-01`, headers: auth(owner) });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().ranking, []);
    for (const count of [1, 2, 3, 12]) {
      const { date, clients } = cardinalityDays.get(count);
      const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${date}`, headers: auth(owner) });
      assert.equal(response.statusCode, 200, response.body);
      const rows = response.json().ranking;
      assert.equal(rows.length, count);
      assert.equal(rows.reduce((sum, row) => sum + row.totalMl, 0), clients.reduce((sum, _client, index) => sum + (count - index) * 100, 0));
      assert.deepEqual(rows.map((row) => row.posicao), Array.from({ length: count }, (_, index) => index + 1));
      assert.deepEqual(rows.map((row) => row.clienteId), clients.map((client) => client.id));
    }
  });

  await check('monthly DATE boundaries include October 1 and 31, exclude November 1, and list months from sales', async () => {
    const previousTz = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati';
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?mes=2026-10`, headers: auth(owner) });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.deepEqual(body.mesesDisponiveis, ['2026-12', '2026-11', '2026-10', '2025-07']);
      assert.equal(body.entries.reduce((sum, row) => sum + row.totalMl, 0), 1800);
      assert.equal(body.entries.length, 2, 'same-name clients remain separate identities');
      assert.deepEqual(new Set(body.entries.map((row) => row.clienteId)), new Set([primaryClient.id, homonym.id]));
    } finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
  });

  await check('recurrence aggregation preserves exact agenda identity and occurrence picker reaches older history', async () => {
    const ranking = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(ranking.statusCode, 200, ranking.body);
    assert.equal(ranking.json().ranking.reduce((sum, row) => sum + row.totalMl, 0), 4000);
    const rankingBeforeEdit = ranking.json().ranking;
    await prisma.agendaOperacional.update({ where: { id: agenda.id }, data: { nome: 'Sextas QA editada', diaSemana: 4, horaInicio: '19:00' } });
    const afterDefinitionEdit = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(afterDefinitionEdit.statusCode, 200, afterDefinitionEdit.body);
    assert.deepEqual(afterDefinitionEdit.json().ranking, rankingBeforeEdit, 'definition changes do not change agenda identity or historical ranking');
    const list = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/ocorrencias`, headers: auth(owner) });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().ocorrencias.some((row) => row.id === occurrenceRows[0].id && row.data === '2025-07-01'));
  });

  await check('customer history keeps unpaid closed sale, exposes canonical context, and never fabricates an event ID', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}/historico`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const rows = response.json().items;
    assert.ok(rows.some((row) => row.ocorrencia?.id === occurrenceRows[1].id && row.evento === null && row.pontoVenda.id === point.id));
    assert.ok(rows.some((row) => row.status === 'CANCELADA'));
    assert.ok(rows.some((row) => row.total === 0 && row.valorPendente === 10));
    assert.ok(rows.some((row) => row.total === 8 && row.desconto === 2 && row.valorPendente === 0));
    const detail = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}`, headers: auth(owner) });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().estatisticas.totalComandasFechadas, 4);
    assert.equal(detail.json().estatisticas.totalMlChope, 3000);
    assert.equal(detail.json().estatisticas.totalGasto, 8);
    const foreignHistory = await app.inject({ method: 'GET', url: `/api/clientes/${foreignClient.id}/historico`, headers: auth(owner) });
    assert.equal(foreignHistory.statusCode, 404, foreignHistory.body);
  });

  await check('ranking desktop, mobile, TV, filters, and permissions use the real local API and disposable PostgreSQL fixtures', async () => {
    const apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    const apiPort = app.server.address().port;
    const portProbe = net.createServer();
    await new Promise((resolve, reject) => portProbe.once('error', reject).listen(0, '127.0.0.1', resolve));
    const frontendPort = portProbe.address().port;
    await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
    const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
    const frontendRoot = path.resolve('../frontend');
    const vite = spawn(process.execPath, [path.join(frontendRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: frontendRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, VITE_API_PORT: String(apiPort), VITE_SOCKET_URL: apiOrigin },
    });
    let browser;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (vite.exitCode !== null) throw new Error(`Vite exited before readiness: ${vite.exitCode}`);
        try { if ((await fetch(frontendOrigin)).ok) { ready = true; break; } } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(ready, true, 'Vite frontend did not become ready');
      browser = await chromium.launch({ headless: true });
      const screenshots = path.resolve('../.worktrees/ranking-header-ci-8ff017e/evidence/ranking-canonical-disposable');
      await mkdir(screenshots, { recursive: true });

      const ownerToken = signUserToken(app, owner);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      await context.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${owner.id}`);
      await context.addCookies([{ name: AUTH_COOKIE_NAME, value: ownerToken, url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const rankingUrl = (params) => `${frontendOrigin}/operacao/ranking?${new URLSearchParams({ pontoVendaId: point.id, ...params })}`;
      const waitForSuccessfulRefresh = async (target) => {
        await target.locator('.tap-champions-updated').waitFor();
        await target.waitForFunction(() => !document.querySelector('.tap-champions-updated')?.textContent?.includes('aguardando'), null, { timeout: 15000 });
      };

      for (const [count, date] of [[0, '2026-12-01'], [1, '2026-12-02'], [2, '2026-12-03'], [3, '2026-12-04'], [12, '2026-12-05']]) {
        await page.goto(rankingUrl({ dia: date }), { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Ranking de chope', exact: true }).waitFor({ timeout: 15000 });
        await page.locator('.tap-champions-stats').waitFor();
        await waitForSuccessfulRefresh(page);
        const apiResult = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}?dia=${date}`);
        assert.equal(apiResult.ranking.length, count);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), count);
        assert.equal(await page.locator('.tap-champions-podium-card').count(), Math.min(count, 3));
        assert.equal(await page.locator('.tap-champions-rest-card').count(), Math.max(0, count - 3));
        if (count === 1 || count === 2) {
          const layoutColumns = await page.locator('.tap-champions-podium').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length);
          assert.equal(layoutColumns, count, `${count} participant(s) use an adapted podium grid`);
        }
        const rendered = await page.locator('.tap-champions-podium-card,.tap-champions-rest-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
        const expected = apiResult.ranking.map((row) => `${row.posicao}º lugar: ${row.nome}`).sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]));
        assert.deepEqual(rendered.sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0])), expected);
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
        assert.ok(viewport.documentWidth <= viewport.width, `horizontal overflow at ${viewport.width}px: ${viewport.documentWidth}px`);
        if (count === 12) {
          assert.equal(await page.locator('.ranking-client-link').count(), 12, 'owner can open customer history');
          await page.addStyleTag({ content: '.app-bottom-nav,.app-shell-header,.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
          await page.locator('.ranking-operational').screenshot({ path: path.join(screenshots, 'desktop.png') });
        }
      }

      await check('browser refresh shows a new launch and removes a canceled item under the canonical policy', async () => {
        await page.goto(rankingUrl({ dia: '2026-12-06' }), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.ranking-operational-state')?.textContent?.includes('consumo registrado'));
        const launched = await sale({ client: cardinalityDays.get(12).clients[0], origin: 'CAIXA', operationalDate: '2026-12-06', volume: 450 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.tap-champions-podium-card').waitFor();
        await waitForSuccessfulRefresh(page);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), 1);
        assert.equal(await page.locator('.tap-champions-podium-volume').innerText(), '0,45 L');
        await prisma.itemComanda.updateMany({ where: { comandaId: launched.id }, data: { canceladoEm: day('2026-12-06') } });
        await prisma.comanda.update({ where: { id: launched.id }, data: { status: 'CANCELADA' } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.ranking-operational-state')?.textContent?.includes('consumo registrado'));
        assert.equal(await page.locator('.tap-champions-podium-card').count(), 0);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), 0);
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(rankingUrl({ dia: '2026-12-05' }), { waitUntil: 'domcontentloaded' });
      await page.locator('.tap-champions-rest-card').first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile layout has no horizontal overflow');
      assert.ok(await page.getByText(/nome extenso para testar quebra/i).isVisible());
      await page.addStyleTag({ content: '.app-bottom-nav,.app-shell-header,.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      await page.locator('.ranking-operational').screenshot({ path: path.join(screenshots, 'mobile.png') });

      const monthly = new URLSearchParams({ pontoVendaId: point.id, escopo: 'mensal', mes: '2026-10', dia: '2026-10-01' });
      await page.goto(`${frontendOrigin}/operacao/ranking?${monthly}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(/Mensal · outubro de 2026/i).waitFor();
      const monthApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/periodo?mes=2026-10`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), monthApi.entries.length);

      const general = new URLSearchParams({ pontoVendaId: point.id, escopo: 'geral', dia: '2026-10-01' });
      await page.goto(`${frontendOrigin}/operacao/ranking?${general}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Geral · todo o período').waitFor();
      const generalApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/periodo`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), generalApi.entries.length);

      const agendaParams = new URLSearchParams({ pontoVendaId: point.id, escopo: 'agenda', agendaId: agenda.id, dia: '2026-10-01' });
      await page.goto(`${frontendOrigin}/operacao/ranking?${agendaParams}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Agenda recorrente · Sextas QA editada').waitFor();
      const agendaApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), agendaApi.ranking.length);
      await page.getByRole('link', { name: 'Abrir modo TV' }).click();
      await page.locator('.qt-tv .tap-champions').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'agenda');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id);
      await page.getByRole('link', { name: 'Sair da tela cheia' }).click();
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'agenda');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id);

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(rankingUrl({ dia: '2026-12-05' }), { waitUntil: 'domcontentloaded' });
      await page.locator('.ranking-operational').waitFor();
      const originalSearch = new URL(page.url()).search;
      await page.getByRole('link', { name: 'Abrir modo TV' }).click();
      await page.locator('.qt-tv .tap-champions').waitFor();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking/tv');
      assert.equal(new URL(page.url()).search, originalSearch, 'TV navigation preserves all ranking filters');
      assert.equal(await page.getByText('AO VIVO', { exact: true }).count(), 0, 'polling status is not mislabeled as live socket');
      await page.getByText('Atualiza a cada minuto').waitFor();
      assert.equal(await page.locator('.tap-champions-podium-card').count(), 3);
      assert.equal(await page.locator('.tap-champions-rest-card').count(), 9);
      const tvBody = await page.locator('body').innerText();
      assert.equal(tvBody.includes(viewer.email), false);
      assert.equal(tvBody.includes('@qa.test'), false, 'TV contains no email or personal contact details');
      await page.screenshot({ path: path.join(screenshots, 'tv.png'), fullPage: true });
      const fullscreenButton = page.getByRole('button', { name: 'Tela cheia do navegador' });
      await page.keyboard.press('Tab');
      assert.equal(await fullscreenButton.evaluate((el) => el.matches(':focus-visible')), true, 'fullscreen action has visible keyboard focus');
      await page.getByRole('link', { name: 'Sair da tela cheia' }).click();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking');
      assert.equal(new URL(page.url()).search, originalSearch, 'TV exit returns to the exact ranking context');

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${frontendOrigin}/operacao/comandas?pontoVendaId=${encodeURIComponent(point.id)}`, { waitUntil: 'domcontentloaded' });
      const trophy = page.getByRole('link', { name: 'Ranking de chope', exact: true });
      const qr = page.getByRole('button', { name: 'Abrir QR Code para comandas' });
      await trophy.waitFor();
      assert.equal(await page.locator('text=Ranking de chope').count(), 0, 'text-only ranking access is absent');
      assert.equal(await qr.count(), 1, 'QR Code control remains in the header');
      assert.equal(await trophy.getAttribute('title'), 'Ranking de chope', 'accessible name has a tooltip');
      const desktopHeaderGeometry = await page.locator('.app-shell-header').evaluate((header) => {
        const elements = [...header.querySelectorAll('a[aria-label="Ranking de chope"],button[aria-label="Abrir QR Code para comandas"]')];
        const rects = elements.map((element) => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; });
        return { width: document.documentElement.scrollWidth, viewport: window.innerWidth, rects };
      });
      assert.equal(desktopHeaderGeometry.rects.length, 2);
      assert.ok(desktopHeaderGeometry.rects[0].right <= desktopHeaderGeometry.rects[1].left || desktopHeaderGeometry.rects[1].right <= desktopHeaderGeometry.rects[0].left, 'QR and trophy do not overlap on desktop');
      assert.ok(desktopHeaderGeometry.width <= desktopHeaderGeometry.viewport, 'desktop header has no horizontal overflow');
      await trophy.focus();
      assert.equal(await trophy.evaluate((element) => element.matches(':focus-visible')), true, 'trophy has visible keyboard focus');
      await page.addStyleTag({ content: '.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      await page.locator('.app-shell-header').screenshot({ path: path.join(screenshots, 'header-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addStyleTag({ content: '.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      const mobileGeometry = await page.locator('.app-shell-header').evaluate((header) => ({
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        rects: [...header.querySelectorAll('a[aria-label="Ranking de chope"],button[aria-label="Abrir QR Code para comandas"]')].map((element) => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; }),
      }));
      assert.equal(mobileGeometry.rects.length, 2);
      assert.ok(mobileGeometry.rects[0].right <= mobileGeometry.rects[1].left || mobileGeometry.rects[1].right <= mobileGeometry.rects[0].left, 'QR and trophy do not overlap at 390 px');
      assert.ok(mobileGeometry.width <= mobileGeometry.viewport, 'mobile header has no horizontal overflow');
      await page.locator('.app-shell-header').screenshot({ path: path.join(screenshots, 'header-mobile.png') });
      await prisma.configuracaoPontoVenda.updateMany({ where: { cervejariaId: company.id, pontoVendaId: point.id }, data: { tapsEnabled: false } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.getByRole('link', { name: 'Ranking de chope', exact: true }).count(), 0, 'trophy is hidden when Taps is disabled');
      await prisma.configuracaoPontoVenda.updateMany({ where: { cervejariaId: company.id, pontoVendaId: point.id }, data: { tapsEnabled: true } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Ranking de chope', exact: true }).waitFor();
      await trophy.click();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking');
      assert.equal(new URL(page.url()).searchParams.get('pontoVendaId'), point.id, 'ranking link preserves the selected PDV');
      await context.close();

      const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await staffContext.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${viewer.id}`);
      await staffContext.addCookies([{ name: AUTH_COOKIE_NAME, value: signUserToken(app, viewer), url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const staffPage = await staffContext.newPage();
      await staffPage.goto(rankingUrl({ dia: '2026-12-05' }), { waitUntil: 'domcontentloaded' });
      await staffPage.locator('.tap-champions-podium-card').first().waitFor();
      await waitForSuccessfulRefresh(staffPage);
      assert.equal(await staffPage.locator('.ranking-client-link').count(), 0, 'command.read without clients.manage has no customer-history link');
      await staffPage.goto(`${frontendOrigin}/operacao/comandas?pontoVendaId=${encodeURIComponent(point.id)}`, { waitUntil: 'domcontentloaded' });
      assert.equal(await staffPage.getByRole('link', { name: 'Ranking de chope', exact: true }).count(), 0, 'staff without command.read has no trophy in the header');
      await staffContext.close();

      const deniedContext = await browser.newContext({ serviceWorkers: 'block' });
      await deniedContext.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${denied.id}`);
      await deniedContext.addCookies([{ name: AUTH_COOKIE_NAME, value: signUserToken(app, denied), url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const deniedPage = await deniedContext.newPage();
      await deniedPage.goto(`${frontendOrigin}/operacao/ranking/tv?pontoVendaId=${point.id}&dia=2026-12-05`, { waitUntil: 'domcontentloaded' });
      await deniedPage.waitForTimeout(500);
      assert.notEqual(new URL(deniedPage.url()).pathname, '/operacao/ranking/tv', 'TV remains protected by command.read');
      await deniedContext.close();
      console.log(`RANKING_UI_EVIDENCE=${screenshots}`);
      console.log(`RANKING_UI_API=${apiOrigin}`);
    } finally {
      await browser?.close();
      vite.kill();
    }
  });
} finally {
  await app.close();
  await prisma.$disconnect();
}
