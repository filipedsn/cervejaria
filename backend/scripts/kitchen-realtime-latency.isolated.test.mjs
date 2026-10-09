import assert from 'node:assert/strict';
import { test } from 'node:test';
import { io as clientIo } from 'socket.io-client';
import { runKitchenVisibleBrowserQa } from './kitchen-visible-sync.browser.qa.mjs';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

validateIsolatedQaEnvironment(process.env);
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED, '1');

const { PrismaClient } = await import('@prisma/client');
const { buildApp, setupSocketIO } = await import('../src/app.ts');
const prisma = new PrismaClient();
const app = await buildApp();
let ioServer;
const runId = process.env.PDV_QA_RUN_ID;
const tenantId = `qa_${runId}_latency`;
const ownerId = `${tenantId}_owner`;
const orderId = `${tenantId}_order`;
const commandId = `${tenantId}_command`;
let token;
let baseUrl;

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const summary = (values) => ({ n: values.length, minMs: +Math.min(...values).toFixed(2), p50Ms: +percentile(values, 0.5).toFixed(2), p95Ms: +percentile(values, 0.95).toFixed(2), maxMs: +Math.max(...values).toFixed(2) });

async function connectKitchen(userToken, tenant) {
  const socket = clientIo(baseUrl, { auth: { token: userToken }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  socket.emit('join:cervejaria', tenant);
  const room = `cervejaria:${tenant}:cozinha`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const sockets = await app.io.in(room).fetchSockets();
    if (sockets.some((entry) => entry.id === socket.id)) return socket;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Socket did not join the tenant kitchen room');
}

test('Socket.IO real: commit, emit e recebimento pela cozinha em duas sessões', async (t) => {
  const day = new Date('2026-10-09T00:00:00.000Z');
  await prisma.cervejaria.create({ data: { id: tenantId, nome: 'QA socket latency', slug: `${tenantId}-slug` } });
  await prisma.usuario.create({ data: { id: ownerId, nome: 'QA owner', email: `${ownerId}@example.test`, senhaHash: 'unused', papel: 'DONO', cervejariaId: tenantId } });
  await prisma.configuracaoOperacional.create({ data: { cervejariaId: tenantId, inventoryEnabled: false, kitchenEnabled: true, plannedOperationsEnabled: false } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenantId, ativo: true, controlaEstoque: false, temCozinha: true } });
  const pointId = `${tenantId}_point`;
  const productId = `${tenantId}_product`;
  await prisma.pontoVenda.create({ data: { id: pointId, cervejariaId: tenantId, nome: 'QA POS' } });
  await prisma.produto.create({ data: { id: productId, nome: 'QA food', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: false, cervejariaId: tenantId, pontoVendaId: pointId } });
  await prisma.comanda.create({ data: { id: commandId, origem: 'CAIXA', status: 'ABERTA', tipo: 'MESA', pontoVendaId: pointId, identificador: 'QA-LATENCY', total: 0, abertaPorId: ownerId } });
  await prisma.pedidoOperacao.create({ data: { id: orderId, cervejariaId: tenantId, comandaId: commandId, pontoVendaId: pointId, numero: 1, diaOperacional: day, criadoPorId: ownerId } });
  await prisma.itemComanda.create({ data: { id: `${tenantId}_item`, comandaId: commandId, pedidoCozinhaId: orderId, produtoId: productId, nome: 'QA food', quantidade: 1, precoUnit: 0, exigePreparo: true } });
  const user = await prisma.usuario.findUniqueOrThrow({ where: { id: ownerId } });
  token = app.jwt.sign({ sub: user.id, email: user.email, nome: user.nome, papel: user.papel, cervejariaId: tenantId, pwdAt: user.passwordChangedAt.getTime() });

  ioServer = setupSocketIO(app, app.server);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  const emitTimes = [];
  const originalTo = app.io.to.bind(app.io);
  app.io.to = (room) => {
    const operator = originalTo(room);
    const originalEmit = operator.emit.bind(operator);
    operator.emit = (event, ...args) => {
      if (room === `cervejaria:${tenantId}:cozinha` && (event === 'operacao:pedido-novo' || event === 'operacao:pedido-atualizado')) emitTimes.push(performance.now());
      return originalEmit(event, ...args);
    };
    return operator;
  };

  const kitchen = await connectKitchen(token, tenantId);
  const producer = await connectKitchen(token, tenantId);
  const received = [];
  kitchen.on('operacao:pedido-atualizado', (event) => {
    if (event.id === orderId) received.push(performance.now());
  });
  producer.on('operacao:pedido-atualizado', () => {});
  t.after(() => { kitchen.close(); producer.close(); });

  const requestMs = [];
  const emitReceiveMs = [];
  const receiveAfterResponseMs = [];
  for (let i = 0; i < 12; i++) {
    const from = i % 2 === 0 ? 'RECEBIDO' : 'EM_PREPARO';
    const to = from === 'RECEBIDO' ? 'EM_PREPARO' : 'RECEBIDO';
    const beforeEmitCount = emitTimes.length;
    const beforeReceiveCount = received.length;
    const start = performance.now();
    const response = await fetch(`${baseUrl}/api/operacao/cozinha/${orderId}/status`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: to, expectedStatus: from }),
    });
    assert.equal(response.status, 200, await response.text());
    const responseAt = performance.now();
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Kitchen event was not received')), 3000);
      const check = () => {
        if (received.length > beforeReceiveCount && emitTimes.length > beforeEmitCount) { clearTimeout(deadline); resolve(); }
        else setTimeout(check, 1);
      };
      check();
    });
    requestMs.push(responseAt - start);
    emitReceiveMs.push(received.at(-1) - emitTimes.at(-1));
    receiveAfterResponseMs.push(received.at(-1) - responseAt);
  }
  assert.equal(emitTimes.length, 12);
  assert.equal(received.length, 12);
  assert.equal(await prisma.pedidoOperacao.count({ where: { id: orderId, status: 'RECEBIDO' } }), 1);

  console.log(JSON.stringify({ scenario: 'real-socket-two-sessions-status-update', measurements: { requestIncludingCommitAndEmitMs: summary(requestMs), serverEmitToKitchenReceiveMs: summary(emitReceiveMs), kitchenReceiveRelativeToHttpResponseMs: summary(receiveAfterResponseMs) }, eventCount: received.length, noPollUsed: true, tenantRoom: `cervejaria:${tenantId}:cozinha` }, null, 2));

  await runKitchenVisibleBrowserQa({ app, prisma, baseUrl, token, tenantId, ownerId, productId, orderId, runId });
});

test.after(async () => { await new Promise((resolve) => ioServer?.close(() => resolve())); await app.close(); await prisma.$disconnect(); });
