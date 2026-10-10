import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

async function waitForVite(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated Vite exited (${child.exitCode})`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated Vite did not become ready');
}

export async function runKitchenCommandVisibleSyncQa({ app, prisma, baseUrl, fixture, token, runId }) {
  const { chromium } = await import('../../node_modules/playwright/index.mjs');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const vite = spawn(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.join(root, 'frontend'), env: { ...process.env, VITE_API_PORT: String(new URL(baseUrl).port), VITE_SOCKET_URL: '' }, stdio: 'ignore', windowsHide: true,
  });
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  const secondOrderId = `${fixture.tenantId}_reconnect_order`;
  const secondItemId = `${fixture.tenantId}_reconnect_item`;
  const results = [];
  try {
    await waitForVite(origin, vite);
    await prisma.pedidoOperacao.create({ data: { id: secondOrderId, cervejariaId: fixture.tenantId, comandaId: fixture.commandId, pontoVendaId: fixture.pointId, numero: 2, diaOperacional: new Date('2026-10-09T00:00:00.000Z'), criadoPorId: fixture.ownerId } });
    await prisma.itemComanda.create({ data: { id: secondItemId, comandaId: fixture.commandId, pedidoCozinhaId: secondOrderId, produtoId: fixture.productId, nome: 'QA reconnect item', quantidade: 1, precoUnit: 12, exigePreparo: true } });
    await prisma.inventoryMovement.create({ data: { cervejariaId: fixture.tenantId, pontoVendaId: fixture.pointId, produtoId: fixture.productId, pedidoId: secondOrderId, tipo: 'SAIDA_VENDA', quantidade: 1, registradoPorId: fixture.ownerId } });

    const contextsAB = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
    contexts.push(...contextsAB);
    for (const context of contextsAB) {
      await context.addCookies([{ name: 'token', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
      await context.addInitScript(() => {
        const trace = window.__commandSyncTrace = { events: [], requests: [], connects: 0 };
        const fetch0 = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const raw = args[0] instanceof Request ? args[0].url : String(args[0]);
          const url = new URL(raw, location.href);
          const command = url.pathname.includes('/api/operacao/comandas/');
          const entry = command ? { phase: 'start', path: url.pathname, at: performance.now() } : null;
          if (entry) trace.requests.push(entry);
          const response = await fetch0(...args);
          if (entry) trace.requests.push({ ...entry, phase: 'response', status: response.status, at: performance.now() });
          return response;
        };
        const WebSocket0 = window.WebSocket;
        const TraceWebSocket = function(...args) {
          const socket = new WebSocket0(...args);
          socket.addEventListener('open', () => { trace.connects += 1; });
          socket.addEventListener('message', ({ data }) => {
            if (typeof data !== 'string') return;
            for (const part of data.split('\u001e')) if (part.startsWith('42')) try {
              const [name, payload] = JSON.parse(part.slice(2));
              if (name === 'operacao:comanda-atualizada') trace.events.push({ name, comandaId: payload?.comandaId, at: performance.now() });
            } catch {}
          });
          return socket;
        };
        Object.assign(TraceWebSocket, WebSocket0); TraceWebSocket.prototype = WebSocket0.prototype; window.WebSocket = TraceWebSocket;
      });
    }

    const [commandPage, kitchenPage] = await Promise.all(contextsAB.map((context) => context.newPage()));
    await Promise.all([
      commandPage.goto(`${origin}/operacao/comandas/${fixture.commandId}`, { waitUntil: 'domcontentloaded' }),
      kitchenPage.goto(`${origin}/operacao/cozinha/tv`, { waitUntil: 'domcontentloaded' }),
    ]);
    const apiPage = await contextsAB[1].newPage();
    await apiPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await apiPage.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await commandPage.getByText('QA item', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await kitchenPage.locator('.cozinha-tv-grid').waitFor({ state: 'visible', timeout: 15_000 });
    const commandRoom = `cervejaria:${fixture.tenantId}:comandas`;
    const kitchenRoom = `cervejaria:${fixture.tenantId}:cozinha`;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [commandSockets, kitchenSockets] = await Promise.all([app.io.in(commandRoom).fetchSockets(), app.io.in(kitchenRoom).fetchSockets()]);
      if (commandSockets.length >= 1 && kitchenSockets.length >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const commandRoomSockets = await app.io.in(commandRoom).fetchSockets();
    const kitchenRoomSockets = await app.io.in(kitchenRoom).fetchSockets();
    assert.ok(commandRoomSockets.some((socket) => socket.handshake.headers.origin === origin), `command session joined the tenant commands room: ${JSON.stringify(commandRoomSockets.map((socket) => ({ id: socket.id, origin: socket.handshake.headers.origin, userId: socket.data.user?.sub })))}`);
    assert.ok(kitchenRoomSockets.some((socket) => socket.handshake.headers.origin === origin), `kitchen session joined the tenant kitchen room: ${JSON.stringify(kitchenRoomSockets.map((socket) => ({ id: socket.id, origin: socket.handshake.headers.origin, userId: socket.data.user?.sub })))}`);

    const requestResponse = await apiPage.evaluate(async ({ commandId, itemId, token }) => {
      const response = await fetch(`/api/operacao/comandas/${commandId}/itens/${itemId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      return { status: response.status, body: await response.text() };
    }, { commandId: fixture.commandId, itemId: fixture.itemId, token });
    assert.equal(requestResponse.status, 200, requestResponse.body);
    await commandPage.getByText('Cancelamento solicitado', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
    const requestVisible = await commandPage.evaluate((commandId) => ({
      event: window.__commandSyncTrace.events.find((entry) => entry.comandaId === commandId),
      dataRequests: window.__commandSyncTrace.requests.filter((entry) => entry.phase === 'response' && entry.path === `/api/operacao/comandas/${commandId}`).length,
    }), fixture.commandId);
    assert.ok(requestVisible.event, `request event reached the command page: ${JSON.stringify(requestVisible)}`);
    assert.ok(requestVisible.dataRequests >= 2, 'the command page refetched after the request event');
    results.push({ phase: 'request', socketEvent: requestVisible.event.name, commandRoom: true, visible: 'Cancelamento solicitado', commandRefetches: requestVisible.dataRequests });

    const confirmationResponse = await apiPage.evaluate(async ({ orderId, itemId, token }) => {
      const response = await fetch(`/api/operacao/cozinha/${orderId}/itens/${itemId}/confirmar-cancelamento`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      return { status: response.status, body: await response.text() };
    }, { orderId: fixture.orderId, itemId: fixture.itemId, token });
    assert.equal(confirmationResponse.status, 200, confirmationResponse.body);
    await commandPage.getByText('Cancelamento solicitado', { exact: true }).waitFor({ state: 'hidden', timeout: 5_000 });
    const confirmationVisible = await commandPage.evaluate((commandId) => ({
      events: window.__commandSyncTrace.events.filter((entry) => entry.comandaId === commandId),
      dataRequests: window.__commandSyncTrace.requests.filter((entry) => entry.phase === 'response' && entry.path === `/api/operacao/comandas/${commandId}`).length,
    }), fixture.commandId);
    assert.ok(confirmationVisible.events.length >= 2, 'both request and confirmation events arrived on the command session');
    assert.ok(confirmationVisible.dataRequests >= 3, 'the command page refetched after confirmation');
    assert.equal(await prisma.pagamento.count({ where: { comandaId: fixture.commandId } }), 0);
    assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessao: { cervejariaId: fixture.tenantId } } }), 0);
    assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: fixture.orderId, tipo: 'ESTORNO_VENDA' } }), 1);
    results.push({ phase: 'confirmation', socketEventCount: confirmationVisible.events.length, visible: 'Cancelado', commandRefetches: confirmationVisible.dataRequests, noDuplicateFinanceOrStockEffects: true });

    const previousSockets = (await app.io.in(commandRoom).fetchSockets()).filter((socket) => socket.handshake.headers.origin === origin);
    assert.ok(previousSockets.length >= 1, 'command browser socket is connected before forced reconnect');
    for (const browserSocket of previousSockets) app.io.sockets.sockets.get(browserSocket.id).conn.close();
    const disconnectDeadline = Date.now() + 3_000;
    while (Date.now() < disconnectDeadline) {
      if (!(await app.io.in(commandRoom).fetchSockets()).some((socket) => socket.handshake.headers.origin === origin)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal((await app.io.in(commandRoom).fetchSockets()).filter((socket) => socket.handshake.headers.origin === origin).length, 0, 'all browser sockets left the commands room before the missed update');
    let offlineState;
    let stableSince = Date.now();
    let previousRequestCount = -1;
    const settleDeadline = Date.now() + 3_000;
    while (Date.now() < settleDeadline) {
      offlineState = await commandPage.evaluate((commandId) => ({ requests: window.__commandSyncTrace.requests.filter((entry) => entry.phase === 'response' && entry.path === `/api/operacao/comandas/${commandId}`).length, connects: window.__commandSyncTrace.connects }), fixture.commandId);
      if (offlineState.requests !== previousRequestCount) {
        previousRequestCount = offlineState.requests;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 500) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(Date.now() - stableSince >= 500, 'command requests settled after disconnect before taking the no-polling baseline');
    const missedEventResponse = await apiPage.evaluate(async ({ commandId, itemId, token }) => {
      const response = await fetch(`/api/operacao/comandas/${commandId}/itens/${itemId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      return { status: response.status, body: await response.text() };
    }, { commandId: fixture.commandId, itemId: secondItemId, token });
    assert.equal(missedEventResponse.status, 200, missedEventResponse.body);
    assert.ok((await prisma.itemComanda.findUniqueOrThrow({ where: { id: secondItemId } })).cancelamentoPendenteEm);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const whileOffline = await commandPage.evaluate((commandId) => ({ requests: window.__commandSyncTrace.requests.filter((entry) => entry.phase === 'response' && entry.path === `/api/operacao/comandas/${commandId}`).length, connects: window.__commandSyncTrace.connects }), fixture.commandId);
    assert.equal(whileOffline.requests, offlineState.requests, 'no command polling or missed-event refetch while disconnected');
    const reconnectDeadline = Date.now() + 12_000;
    while (Date.now() < reconnectDeadline) {
      const sockets = await app.io.in(commandRoom).fetchSockets();
      if (sockets.some((socket) => socket.handshake.headers.origin === origin)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await commandPage.getByText('Cancelamento solicitado', { exact: true }).waitFor({ state: 'visible', timeout: 12_000 });
    const reconnected = await commandPage.evaluate((commandId) => ({
      requests: window.__commandSyncTrace.requests.filter((entry) => entry.phase === 'response').length,
      connects: window.__commandSyncTrace.connects,
      eventCount: window.__commandSyncTrace.events.filter((entry) => entry.comandaId === commandId).length,
    }), fixture.commandId);
    assert.ok((await app.io.in(commandRoom).fetchSockets()).some((socket) => socket.handshake.headers.origin === origin), 'the Socket.IO browser session rejoined the commands room');
    assert.ok(reconnected.requests > whileOffline.requests, 'connect invalidated and refetched the command after the missed event');
    results.push({ phase: 'reconnect', refetchAfterReconnect: true, noPollingWhileDisconnected: true, visible: 'Cancelamento solicitado', socketConnects: reconnected.connects, runId });
    console.log(JSON.stringify({ scenario: 'real-api-command-visible-sync-two-browser-sessions', steps: results, eventToVisibleUpdate: true, tenantCommandAndKitchenRooms: true }, null, 2));
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await browser.close();
    vite.kill();
  }
}
