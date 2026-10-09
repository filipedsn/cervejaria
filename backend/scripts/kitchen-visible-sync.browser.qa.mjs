import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated Vite exited (${child.exitCode})`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated Vite did not become ready');
}

export async function runKitchenVisibleBrowserQa({ app, prisma, baseUrl, token, tenantId, ownerId, productId, orderId, runId }) {
  const { chromium } = await import('../../node_modules/playwright/index.mjs');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const vite = spawn(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.join(root, 'frontend'), env: { ...process.env, VITE_API_PORT: String(new URL(baseUrl).port), VITE_SOCKET_URL: '' }, stdio: 'ignore', windowsHide: true,
  });
  const browser = await chromium.launch({ headless: true });
  const trailerId = `${tenantId}_browser_trailer`;
  const eventId = `${tenantId}_browser_event`;
  const foodId = `${tenantId}_browser_food`;
  let contexts = [];
  try {
    await waitForServer(origin, vite);
    await prisma.trailer.create({ data: { id: trailerId, nome: 'Disposable kitchen QA', cervejariaId: tenantId } });
    await prisma.evento.create({ data: { id: eventId, nome: 'Disposable kitchen QA', local: 'tmpfs', data: new Date(), horaInicio: '18:00', status: 'ABERTO', cervejariaId: tenantId, trailerId } });
    await prisma.produto.create({ data: { id: foodId, nome: 'QA visible dish', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: false, cervejariaId: tenantId, precos: { create: [{ volumeMl: 1, preco: 1 }] } } });
    await prisma.eventoProduto.create({ data: { eventoId: eventId, produtoId: foodId } });

    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    contexts = [contextA, contextB];
    for (const context of contexts) await context.addCookies([{ name: 'token', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const b = await contextB.newPage();
    const a = await contextA.newPage();
    await b.addInitScript(() => {
      const trace = window.__kitchenTrace = { events: [], requests: [], visible: [], snapshots: [], socketConnects: [] };
      const fetch0 = window.fetch.bind(window), json0 = Response.prototype.json, requestResponses = new WeakSet();
      window.fetch = async (...args) => {
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        const kitchen = url.includes('/api/operacao/cozinha');
        if (kitchen) trace.requests.push({ phase: 'start', at: performance.now(), url });
        const response = await fetch0(...args);
        if (kitchen) { requestResponses.add(response); trace.requests.push({ phase: 'response', at: performance.now(), url, status: response.status }); }
        return response;
      };
      Response.prototype.json = async function(...args) {
        const result = await json0.apply(this, args);
        if (requestResponses.has(this)) trace.requests.push({ phase: 'data', at: performance.now() });
        return result;
      };
      const WebSocket0 = window.WebSocket;
      const WebSocketTrace = function(...args) {
        const ws = new WebSocket0(...args);
        ws.addEventListener('message', ({ data }) => {
          if (typeof data !== 'string') return;
          for (const part of data.split('\u001e')) {
            if (part.startsWith('40')) trace.socketConnects.push({ at: performance.now() });
            if (part.startsWith('42')) try {
              const [name, payload] = JSON.parse(part.slice(2));
              if (name.startsWith('operacao:pedido-')) trace.events.push({ name, id: payload?.id, at: performance.now() });
            } catch {}
          }
        });
        return ws;
      };
      Object.assign(WebSocketTrace, WebSocket0); WebSocketTrace.prototype = WebSocket0.prototype; window.WebSocket = WebSocketTrace;
      const observe = () => {
        const grid = document.querySelector('.cozinha-tv-grid'); if (!grid) return;
        const g = grid.getBoundingClientRect();
        const ids = [...grid.querySelectorAll('[data-kitchen-order-id]')].map((card) => card.dataset.kitchenOrderId);
        trace.snapshots.push({ at: performance.now(), ids, text: grid.innerText });
        for (const card of grid.querySelectorAll('[data-kitchen-order-id]')) {
          const r = card.getBoundingClientRect(), s = getComputedStyle(card);
          const w = Math.min(g.right, r.right) - Math.max(g.left, r.left), h = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
          if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || w <= 0 || h <= 0) continue;
          trace.visible.push({ id: card.dataset.kitchenOrderId, at: performance.now(), text: card.innerText, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, grid: { x: g.x, y: g.y, width: g.width, height: g.height }, intersection: { width: w, height: h }, hiddenMeasurement: Boolean(card.closest('.cozinha-tv-measure')) });
        }
      };
      new MutationObserver(() => requestAnimationFrame(observe)).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      window.addEventListener('load', observe);
    });
    await b.goto(`${origin}/operacao/cozinha/tv`, { waitUntil: 'domcontentloaded' });
    await a.goto(origin, { waitUntil: 'domcontentloaded' });
    await b.locator('.cozinha-tv-grid').waitFor({ state: 'visible', timeout: 15_000 });
    await b.waitForFunction(() => document.querySelector('.cozinha-tv-grid [data-kitchen-order-id]'), { timeout: 15_000 });
    assert.ok(await b.locator('.cozinha-tv-grid [data-kitchen-order-id]').count() >= 1, 'the kitchen page has a real visible seeded order');

    const comandaRes = await fetch(`${baseUrl}/api/comandas`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ eventoId: eventId, clienteNome: 'QA browser session', clienteTelefone: '11987654321' }) });
    const comanda = await comandaRes.json();
    assert.equal(comandaRes.status, 201, JSON.stringify(comanda));
    let newOrderId;
    const measurements = [];
    async function measure(label, request, eventName, targetId, { expectedText, disappears = false } = {}) {
      const start = await b.evaluate(() => performance.now());
      const response = await a.evaluate(async ({ request, token }) => {
        const result = await fetch(request.url, { method: request.method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: request.body ? JSON.stringify(request.body) : undefined });
        return { status: result.status, body: await result.json() };
      }, { request, token });
      assert.ok([200, 201].includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);
      try { await b.waitForFunction(({ eventName, targetId, expectedText, disappears, start }) => {
        const trace = window.__kitchenTrace;
        const event = trace.events.some((item) => item.at >= start && item.name === eventName && (!targetId || item.id === targetId));
        const resolvedId = targetId ?? trace.events.find((item) => item.at >= start && item.name === eventName)?.id;
        const card = [...document.querySelectorAll('.cozinha-tv-grid [data-kitchen-order-id]')].find((item) => item.dataset.kitchenOrderId === resolvedId);
        const visible = card && card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0 && (!expectedText || card.innerText.includes(expectedText));
        return event && (disappears ? !card : visible);
      }, { eventName, targetId, expectedText, disappears, start }, { timeout: 8000 }); }
      catch (error) {
        const diagnostic = await b.evaluate(() => ({ events: window.__kitchenTrace.events.slice(-8), requests: window.__kitchenTrace.requests.slice(-8), visible: window.__kitchenTrace.visible.slice(-8), cards: [...document.querySelectorAll('.cozinha-tv-grid [data-kitchen-order-id]')].map((card) => ({ id: card.dataset.kitchenOrderId, text: card.innerText, cls: card.className })), gridText: document.querySelector('.cozinha-tv-grid')?.innerText }));
        throw new Error(`${label} visible sync timeout: ${JSON.stringify(diagnostic)}; ${error.message}`);
      }
      const resolvedTargetId = targetId ?? await b.evaluate(({ start, eventName }) => window.__kitchenTrace.events.find((item) => item.at >= start && item.name === eventName)?.id, { start, eventName });
      assert.ok(resolvedTargetId, `${label}: event contains the created kitchen order ID`);
      const m = await b.evaluate(({ start, eventName, targetId, disappears }) => {
        const trace = window.__kitchenTrace;
        const event = trace.events.find((item) => item.at >= start && item.name === eventName && item.id === targetId);
        const requests = trace.requests.filter((item) => item.at >= start);
        const dataAt = requests.find((item) => item.phase === 'data')?.at;
        const visible = [...trace.visible].reverse().find((item) => item.at >= (dataAt ?? start) && item.id === targetId && !item.hiddenMeasurement);
        const removed = [...trace.snapshots].find((item) => item.at >= (dataAt ?? start) && !item.ids.includes(targetId));
        const grid = document.querySelector('.cozinha-tv-grid'), card = [...grid.querySelectorAll('[data-kitchen-order-id]')].find((item) => item.dataset.kitchenOrderId === targetId);
        const rect = card?.getBoundingClientRect(), gr = grid.getBoundingClientRect();
        return { eventAt: event?.at, requestStart: requests.find((item) => item.phase === 'start')?.at, requestResponse: requests.find((item) => item.phase === 'response')?.at, dataAt, paintAt: disappears ? removed?.at : visible?.at, text: visible?.text ?? removed?.text, rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, grid: { x: gr.x, y: gr.y, width: gr.width, height: gr.height }, removed: Boolean(removed), hiddenMeasurement: disappears ? false : !visible || Boolean(card?.closest('.cozinha-tv-measure')) };
      }, { start, eventName, targetId: resolvedTargetId, disappears });
      assert.ok(m.eventAt && m.requestStart && m.requestResponse && m.dataAt && m.paintAt, `${label}: complete Socket.IO/refetch/visible-DOM trace ${JSON.stringify(m)}`);
      assert.equal(m.hiddenMeasurement, false, `${label}: visible node must not be the measurement clone`);
      if (disappears) assert.equal(m.removed, true, `${label}: target is removed from visible grid`);
      else {
        assert.ok(m.rect?.width > 0 && m.rect?.height > 0, `${label}: visible target has a non-zero bounding box`);
        assert.ok(m.rect.x < m.grid.x + m.grid.width && m.rect.x + m.rect.width > m.grid.x && m.rect.y < m.grid.y + m.grid.height && m.rect.y + m.rect.height > m.grid.y, `${label}: visible target intersects the grid box`);
      }
      const refetchCount = await b.evaluate((start) => window.__kitchenTrace.requests.filter((item) => item.phase === 'start' && item.at >= start).length, start);
      const result = { label, refetchCount, actionToBrowserEventMs: +((m.eventAt - start).toFixed(2)), eventToRefetchStartMs: +((m.requestStart - m.eventAt).toFixed(2)), refetchStartToResponseMs: +((m.requestResponse - m.requestStart).toFixed(2)), responseToDataMs: +((m.dataAt - m.requestResponse).toFixed(2)), refetchStartToDataMs: +((m.dataAt - m.requestStart).toFixed(2)), dataToVisibleDomMs: +((m.paintAt - m.dataAt).toFixed(2)), totalToVisibleUpdateMs: +((m.paintAt - start).toFixed(2)), visibleText: m.text, cardRect: m.rect, gridRect: m.grid, visibleRemoval: disappears ? m.removed : undefined, viewport: '1280x800' };
      measurements.push(result); return { body: response.body, orderId: resolvedTargetId };
    }

    const first = await measure('criação de pedido na cozinha', { url: `${origin}/api/comandas/${comanda.id}/itens`, method: 'POST', body: { produtoId: foodId, volumeMl: 1, quantidade: 1, observacao: 'QA observável' } }, 'operacao:pedido-novo', null);
    newOrderId = first.orderId;
    await b.waitForFunction((id) => [...document.querySelectorAll('.cozinha-tv-grid [data-kitchen-order-id]')].some((card) => card.dataset.kitchenOrderId === id && card.innerText.includes('QA visible dish')), newOrderId, { timeout: 8000 });
    assert.ok(first.body && newOrderId);
    const inclusion = await measure('inclusão de item', { url: `${origin}/api/comandas/${comanda.id}/itens`, method: 'POST', body: { produtoId: foodId, volumeMl: 1, quantidade: 1, observacao: 'QA inclusão' } }, 'operacao:pedido-novo', null);
    newOrderId = inclusion.orderId;
    await measure('início de preparo', { url: `${origin}/api/operacao/cozinha/${newOrderId}/status`, method: 'PATCH', body: { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' } }, 'operacao:pedido-atualizado', newOrderId, { expectedText: 'PREPARANDO' });
    await measure('conclusão do preparo', { url: `${origin}/api/operacao/cozinha/${newOrderId}/status`, method: 'PATCH', body: { status: 'PRONTO', expectedStatus: 'EM_PREPARO' } }, 'operacao:pedido-atualizado', newOrderId, { expectedText: 'PRONTO' });
    await measure('entrega', { url: `${origin}/api/operacao/cozinha/${newOrderId}/status`, method: 'PATCH', body: { status: 'ENTREGUE', expectedStatus: 'PRONTO' } }, 'operacao:pedido-atualizado', newOrderId, { disappears: true });
    await measure('solicitação de cancelamento', { url: `${origin}/api/operacao/cozinha/${orderId}/status`, method: 'PATCH', body: { status: 'CANCELAMENTO_PENDENTE', expectedStatus: 'RECEBIDO' } }, 'operacao:pedido-atualizado', orderId, { expectedText: 'CANCELAMENTO SOLICITADO' });
    await measure('confirmação de cancelamento', { url: `${origin}/api/operacao/cozinha/${orderId}/status`, method: 'PATCH', body: { status: 'CANCELADO', expectedStatus: 'CANCELAMENTO_PENDENTE' } }, 'operacao:pedido-atualizado', orderId, { disappears: true });

    const room = `cervejaria:${tenantId}:cozinha`;
    const reconnectStart = await b.evaluate(() => ({ at: performance.now(), dataCount: window.__kitchenTrace.requests.filter((item) => item.phase === 'data').length, connectCount: window.__kitchenTrace.socketConnects.length }));
    const browserSocket = (await app.io.in(room).fetchSockets()).find((socket) => socket.handshake.headers.origin === origin);
    assert.ok(browserSocket, 'observer browser is subscribed to the real tenant kitchen room');
    app.io.sockets.sockets.get(browserSocket.id).conn.close();
    const deadline = Date.now() + 10_000; let rejoined = false;
    while (Date.now() < deadline) {
      const sockets = await app.io.in(room).fetchSockets();
      if (sockets.some((socket) => socket.id !== browserSocket.id && socket.handshake.headers.origin === origin)) { rejoined = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(rejoined, 'browser socket reconnects and rejoins tenant kitchen room');
    await b.waitForFunction((counts) => window.__kitchenTrace.requests.filter((item) => item.phase === 'data').length > counts.dataCount && window.__kitchenTrace.socketConnects.length > counts.connectCount, reconnectStart, { timeout: 10_000 });
    const viewport = await b.evaluate(async ({ start }) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const grid = document.querySelector('.cozinha-tv-grid');
      const cards = [...(grid?.querySelectorAll('[data-kitchen-order-id]') ?? [])].map((card) => { const r = card.getBoundingClientRect(); return { id: card.dataset.kitchenOrderId, text: card.innerText, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; });
      const data = window.__kitchenTrace.requests.find((item) => item.phase === 'data' && item.at >= start);
      const connect = window.__kitchenTrace.socketConnects.find((item) => item.at >= start);
      return { width: innerWidth, height: innerHeight, page: document.querySelector('.cozinha-tv-pager-bar')?.innerText, paintAt: performance.now(), dataAt: data?.at, connectAt: connect?.at, refetchCount: window.__kitchenTrace.requests.filter((item) => item.phase === 'start' && item.at >= start).length, cards };
    }, { start: reconnectStart.at });
    assert.ok(viewport.cards.length > 0 && viewport.cards.every((card) => card.rect.width > 0 && card.rect.height > 0));
    console.log(JSON.stringify({ scenario: 'two-session-real-socket-visible-grid', sourceSha: process.env.PDV_QA_SOURCE_SHA ?? 'workspace HEAD', viewport: `${viewport.width}x${viewport.height}`, measurements, reconnection: { rejoined, socketReconnectMs: +(viewport.connectAt - reconnectStart.at).toFixed(2), reconnectToRefetchDataMs: +(viewport.dataAt - viewport.connectAt).toFixed(2), refetchDataToPaintMs: +(viewport.paintAt - viewport.dataAt).toFixed(2), totalRecoveryMs: +(viewport.paintAt - reconnectStart.at).toFixed(2), refetchCount: viewport.refetchCount, visibleCards: viewport.cards.length, page: viewport.page }, method: 'Playwright browser B displays actual TV route and real backend Socket.IO; isolated session A calls application API routes; performance.now from B timestamps action marker, frames, query fetch/JSON and MutationObserver after paint; visible card restricted to .cozinha-tv-grid and verified by nonzero bounding box plus intersection with grid; hidden .cozinha-tv-measure excluded' }, null, 2));
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close();
    vite.kill(); await once(vite, 'exit').catch(() => {});
  }
}
