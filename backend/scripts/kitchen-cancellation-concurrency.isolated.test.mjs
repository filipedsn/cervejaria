import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runKitchenCommandVisibleSyncQa } from './kitchen-command-visible-sync.browser.qa.mjs';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

validateIsolatedQaEnvironment(process.env);
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED, '1');

const { PrismaClient } = await import('@prisma/client');
const { buildApp, setupSocketIO } = await import('../src/app.ts');
const prisma = new PrismaClient();
const app = await buildApp();
const ioServer = setupSocketIO(app, app.server);
const runId = process.env.PDV_QA_RUN_ID;
const day = new Date('2026-10-09T00:00:00.000Z');

function asText(value) { return value == null ? null : String(value); }

async function tenantFixture(suffix, { canonical = false, kitchenItemsChargeAtLaunch = false, allowCloseComandaWithPendingKitchenOrders = false } = {}) {
  const tenantId = canonical ? 'cmr9yis3c0000hvu00q9fe7y1' : `qa_${runId}_${suffix}`;
  const ownerId = `${tenantId}_owner`;
  const noPermissionId = `${tenantId}_restricted`;
  const pointId = `${tenantId}_point`;
  const productId = `${tenantId}_product`;
  const commandId = `${tenantId}_command`;
  const orderId = `${tenantId}_order`;
  const itemId = `${tenantId}_item`;
  await prisma.cervejaria.create({ data: { id: tenantId, nome: `QA ${suffix}`, slug: `${tenantId}-slug` } });
  await prisma.usuario.createMany({ data: [
    { id: ownerId, nome: 'QA owner', email: `${tenantId}-owner@example.test`, senhaHash: 'qa-not-used', papel: 'DONO', cervejariaId: tenantId },
    { id: noPermissionId, nome: 'QA restricted', email: `${tenantId}-restricted@example.test`, senhaHash: 'qa-not-used', papel: 'ATENDENTE', cervejariaId: tenantId, permissoesOperacao: ['kitchen.read', 'kitchen.operate'] },
  ] });
  await prisma.configuracaoOperacional.create({ data: { cervejariaId: tenantId, inventoryEnabled: true, kitchenEnabled: true, plannedOperationsEnabled: false, kitchenItemsChargeAtLaunch, allowCloseComandaWithPendingKitchenOrders } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenantId, ativo: true, controlaEstoque: true, temCozinha: true } });
  await prisma.pontoVenda.create({ data: { id: pointId, cervejariaId: tenantId, nome: 'QA POS' } });
  if (canonical) await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: tenantId, pontoVendaId: pointId, tapsEnabled: false, inventoryEnabled: true, kitchenEnabled: true, kitchenItemsChargeAtLaunch, allowCloseComandaWithPendingKitchenOrders, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  await prisma.produto.create({ data: { id: productId, nome: 'QA item', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: true, cervejariaId: tenantId, pontoVendaId: pointId } });
  await prisma.inventoryBalance.create({ data: { cervejariaId: tenantId, pontoVendaId: pointId, produtoId: productId, quantidade: 4 } });
  await prisma.comanda.create({ data: { id: commandId, origem: 'CAIXA', status: 'ABERTA', tipo: 'MESA', pontoVendaId: pointId, diaOperacional: day, identificador: 'QA-1', total: 25, abertaPorId: ownerId } });
  await prisma.pedidoOperacao.create({ data: { id: orderId, cervejariaId: tenantId, comandaId: commandId, pontoVendaId: pointId, numero: 1, diaOperacional: day, criadoPorId: ownerId } });
  await prisma.itemComanda.create({ data: { id: itemId, comandaId: commandId, pedidoCozinhaId: orderId, produtoId: productId, nome: 'QA item', quantidade: 1, precoUnit: 25, exigePreparo: true } });
  await prisma.inventoryMovement.create({ data: { cervejariaId: tenantId, pontoVendaId: pointId, produtoId: productId, pedidoId: orderId, tipo: 'SAIDA_VENDA', quantidade: 1, registradoPorId: ownerId } });
  const [owner, restricted] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({ where: { id: ownerId } }),
    prisma.usuario.findUniqueOrThrow({ where: { id: noPermissionId } }),
  ]);
  return { tenantId, ownerId, noPermissionId, pointId, productId, commandId, orderId, itemId, ownerPasswordChangedAt: owner.passwordChangedAt, restrictedPasswordChangedAt: restricted.passwordChangedAt };
}

function auth(f, userId = f.ownerId, tenantId = f.tenantId) {
  const passwordChangedAt = userId === f.noPermissionId ? f.restrictedPasswordChangedAt : f.ownerPasswordChangedAt;
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.test`, nome: 'QA', papel: userId === f.noPermissionId ? 'ATENDENTE' : 'DONO', cervejariaId: tenantId, pwdAt: passwordChangedAt.getTime() });
  return { authorization: `Bearer ${token}` };
}

async function inject(f, method, url, userId = f.ownerId, tenantId = f.tenantId, body) {
  return app.inject({ method, url: `/api${url}`, headers: auth(f, userId, tenantId), ...(body === undefined ? {} : { payload: body }) });
}

async function readState(f) {
  const [item, order, command, payments, balance, stockMovements, cashMovements, transacoes] = await Promise.all([
    prisma.itemComanda.findUnique({ where: { id: f.itemId } }),
    prisma.pedidoOperacao.findUnique({ where: { id: f.orderId } }),
    prisma.comanda.findUnique({ where: { id: f.commandId } }),
    prisma.pagamento.count({ where: { comandaId: f.commandId } }),
    prisma.inventoryBalance.findUnique({ where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.productId } } }),
    prisma.inventoryMovement.findMany({ where: { pedidoId: f.orderId }, orderBy: { createdAt: 'asc' } }),
    prisma.movimentoCaixaOperacao.count({ where: { sessao: { cervejariaId: f.tenantId } } }),
    prisma.transacaoLog.count({ where: { cervejariaId: f.tenantId, comandaId: f.commandId } }),
  ]);
  return {
    item: item && { id: item.id, pending: Boolean(item.cancelamentoPendenteEm), canceled: Boolean(item.canceladoEm), quantity: item.quantidade },
    order: order && { id: order.id, status: order.status },
    command: command && { id: command.id, status: command.status, total: asText(command.total) },
    payments,
    balance: asText(balance?.quantidade),
    stockMovements: stockMovements.map((row) => ({ type: row.tipo, quantity: asText(row.quantidade) })),
    cashMovements,
    transactionAuditRows: transacoes,
  };
}

async function waitUntilTwoAdvisoryLockWaiters() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%pg_advisory_xact_lock%'`;
    if (rows[0]?.count >= 2) return rows[0].count;
    await delay(40);
  }
  const rows = await prisma.$queryRaw`SELECT pid, state, wait_event_type, wait_event, left(query, 180) AS query FROM pg_stat_activity WHERE query ILIKE '%pg_advisory_xact_lock%'`;
  throw new Error(`two confirmation requests did not reach the observable advisory lock: ${JSON.stringify(rows)}`);
}

test('cancelamento concorrente mantém exatamente um estorno e não duplica efeitos', async (t) => {
  const f = await tenantFixture('primary');

  const initial = await readState(f);
  assert.deepEqual(initial, {
    item: { id: f.itemId, pending: false, canceled: false, quantity: 1 },
    order: { id: f.orderId, status: 'RECEBIDO' },
    command: { id: f.commandId, status: 'ABERTA', total: '25' },
    payments: 0,
    balance: '4',
    stockMovements: [{ type: 'SAIDA_VENDA', quantity: '1' }],
    cashMovements: 0,
    transactionAuditRows: 0,
  });

  const requestCancellation = await inject(f, 'DELETE', `/operacao/comandas/${f.commandId}/itens/${f.itemId}`, f.ownerId, f.tenantId, {});
  assert.equal(requestCancellation.statusCode, 200, requestCancellation.body);
  const pending = await readState(f);
  assert.equal(pending.item.pending, true);
  assert.equal(pending.item.canceled, false);
  assert.equal(pending.balance, '5');
  assert.equal(pending.stockMovements.filter((row) => row.type === 'ESTORNO_VENDA').length, 1);
  assert.equal(pending.payments, 0);
  assert.equal(pending.cashMovements, 0);

  const lockKey = `comanda-items:${f.commandId}`;
  let releaseBlocker;
  let acquired;
  const holdAcquired = new Promise((resolve) => { acquired = resolve; });
  const blockerGate = new Promise((resolve) => { releaseBlocker = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${lockKey})))`;
    acquired();
    await blockerGate;
  }, { timeout: 30000 });
  await holdAcquired;
  const endpoint = `/operacao/cozinha/${f.orderId}/itens/${f.itemId}/confirmar-cancelamento`;
  const first = inject(f, 'PATCH', endpoint);
  const second = inject(f, 'PATCH', endpoint);
  const waiterCount = await waitUntilTwoAdvisoryLockWaiters();
  assert.equal(waiterCount, 2);
  releaseBlocker();
  await blocker;
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.match(results.find((result) => result.statusCode === 409).body, /Este item n.o possui cancelamento pendente/);

  const afterConcurrent = await readState(f);
  assert.equal(afterConcurrent.item.pending, false);
  assert.equal(afterConcurrent.item.canceled, true);
  assert.equal(afterConcurrent.order.status, 'CANCELADO');
  assert.equal(afterConcurrent.command.status, 'ABERTA');
  assert.equal(afterConcurrent.command.total, '0');
  assert.equal(afterConcurrent.balance, '5');
  assert.deepEqual(afterConcurrent.stockMovements, pending.stockMovements);
  assert.equal(afterConcurrent.payments, pending.payments);
  assert.equal(afterConcurrent.cashMovements, pending.cashMovements);
  assert.equal(afterConcurrent.transactionAuditRows, pending.transactionAuditRows);

  const retry = await inject(f, 'PATCH', endpoint);
  assert.equal(retry.statusCode, 409);
  assert.match(retry.body, /Este item n.o possui cancelamento pendente/);
  assert.deepEqual(await readState(f), afterConcurrent);
  assert.ok(afterConcurrent.stockMovements.filter((row) => row.type === 'ESTORNO_VENDA').length === 1, 'one operational stock refund only');
  console.log(JSON.stringify({ scenario: 'simultaneous-confirmation', lockWaiters: waiterCount, statusCodes: results.map((result) => result.statusCode), initial, afterCancellationRequest: pending, afterConcurrentConfirmation: afterConcurrent, retryStatus: retry.statusCode }, null, 2));
});

test('permissão, tenant e conflitos sem cancelamento pendente não geram efeitos', async (t) => {
  const f = await tenantFixture('denials');
  const other = await tenantFixture('other-tenant');
  await prisma.itemComanda.update({ where: { id: f.itemId }, data: { cancelamentoPendenteEm: new Date() } });
  const before = await readState(f);
  const endpoint = `/operacao/cozinha/${f.orderId}/itens/${f.itemId}/confirmar-cancelamento`;
  const forbidden = await inject(f, 'PATCH', endpoint, f.noPermissionId);
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(await readState(f), before);
  const wrongTenant = await inject(other, 'PATCH', endpoint, other.ownerId, other.tenantId);
  assert.equal(wrongTenant.statusCode, 404);
  assert.deepEqual(await readState(f), before);

  await prisma.itemComanda.update({ where: { id: f.itemId }, data: { cancelamentoPendenteEm: null } });
  const noPendingBefore = await readState(f);
  const noPending = await inject(f, 'PATCH', endpoint);
  assert.equal(noPending.statusCode, 409);
  assert.match(noPending.body, /Este item n.o possui cancelamento pendente/);
  assert.deepEqual(await readState(f), noPendingBefore);
  console.log(JSON.stringify({ scenario: 'denials-and-specific-409', permissionStatus: forbidden.statusCode, otherTenantStatus: wrongTenant.statusCode, noPendingStatus: noPending.statusCode, unchanged: true, state: noPendingBefore }, null, 2));
});

test('status concorrente é idempotente, comando atrasado não desfaz estado e Voltar segue explícito', async () => {
  const f = await tenantFixture('status-concurrency');
  // Keep the synthetic fixture at its calculated open-command total before
  // comparing status-only actions, which recalculate the operational command.
  await prisma.comanda.update({ where: { id: f.commandId }, data: { total: 0 } });
  const endpoint = `/operacao/cozinha/${f.orderId}/status`;
  const initialHistory = await prisma.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: f.orderId } });
  const lockKey = `comanda-items:${f.commandId}`;
  let releaseBlocker;
  let acquired;
  const holdAcquired = new Promise((resolve) => { acquired = resolve; });
  const blockerGate = new Promise((resolve) => { releaseBlocker = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${lockKey})))`;
    acquired();
    await blockerGate;
  }, { timeout: 30000 });
  await holdAcquired;
  const first = inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' });
  const second = inject(f, 'PATCH', endpoint, f.noPermissionId, f.tenantId, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' });
  const waiterCount = await waitUntilTwoAdvisoryLockWaiters();
  assert.equal(waiterCount, 2);
  releaseBlocker();
  await blocker;
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.statusCode), [200, 200]);
  assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: f.orderId } })).status, 'EM_PREPARO');
  assert.equal(await prisma.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: f.orderId, status: 'EM_PREPARO' } }), 1);

  const retryAlreadyApplied = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' });
  assert.equal(retryAlreadyApplied.statusCode, 200);
  assert.equal(await prisma.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: f.orderId } }), initialHistory + 1);

  const ready = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'PRONTO', expectedStatus: 'EM_PREPARO' });
  assert.equal(ready.statusCode, 200, ready.body);
  const delayedStart = await inject(f, 'PATCH', endpoint, f.noPermissionId, f.tenantId, { status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' });
  assert.equal(delayedStart.statusCode, 409);
  assert.equal(JSON.parse(delayedStart.body).code, 'KITCHEN_ORDER_STATUS_CONFLICT');
  assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: f.orderId } })).status, 'PRONTO');
  const invalid = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'RECEBIDO', expectedStatus: 'PRONTO' });
  assert.equal(invalid.statusCode, 409);
  assert.equal(JSON.parse(invalid.body).code, 'KITCHEN_ORDER_TRANSITION_INVALID');
  assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: f.orderId } })).status, 'PRONTO');

  const voltar = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'EM_PREPARO', expectedStatus: 'PRONTO' });
  assert.equal(voltar.statusCode, 200, voltar.body);
  const pronto = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'PRONTO', expectedStatus: 'EM_PREPARO' });
  assert.equal(pronto.statusCode, 200, pronto.body);
  const entregue = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'ENTREGUE', expectedStatus: 'PRONTO' });
  assert.equal(entregue.statusCode, 200, entregue.body);
  const voltarDeEntregue = await inject(f, 'PATCH', endpoint, f.ownerId, f.tenantId, { status: 'PRONTO', expectedStatus: 'ENTREGUE' });
  assert.equal(voltarDeEntregue.statusCode, 200, voltarDeEntregue.body);

  const finalOrder = await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: f.orderId } });
  const finalHistory = await prisma.pedidoOperacaoStatusHistorico.findMany({ where: { pedidoId: f.orderId }, orderBy: { registradoEm: 'asc' } });
  assert.equal(finalOrder.status, 'PRONTO');
  assert.deepEqual(finalHistory.map((row) => row.status), ['EM_PREPARO', 'PRONTO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'PRONTO']);
  const finalState = await readState(f);
  assert.equal(finalState.item.canceled, false);
  assert.equal(finalState.command.total, '0');
  assert.equal(finalState.balance, '4');
  assert.deepEqual(finalState.stockMovements, [{ type: 'SAIDA_VENDA', quantity: '1' }]);
  console.log(JSON.stringify({ scenario: 'status-concurrency-and-stale-command', lockWaiters: waiterCount, concurrentStatuses: results.map((result) => result.statusCode), retryStatus: retryAlreadyApplied.statusCode, delayedStartStatus: delayedStart.statusCode, incompatibleStatus: invalid.statusCode, finalStatus: finalOrder.status, history: finalHistory.map((row) => row.status), noFinancialOrStockEffects: true }, null, 2));
});

test('confirmação em segunda sessão atualiza a comanda via socket e recupera após reconexão', async () => {
  const f = await tenantFixture('visible-sync');
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const token = auth(f).authorization.slice('Bearer '.length);
  await runKitchenCommandVisibleSyncQa({ app, prisma, baseUrl: `http://127.0.0.1:${address.port}`, fixture: f, token, runId });
});

test('API só fecha comanda pendente quando cobrar ao lançar e permitir fechamento (LEGACY/CANONICAL)', async () => {
  const modes = [
    { name: 'LEGACY', canonical: false },
    { name: 'CANONICAL_PDV', canonical: true },
  ];
  const combos = [
    { charge: false, allow: false, expected: 409 },
    { charge: false, allow: true, expected: 409 },
    { charge: true, allow: false, expected: 409 },
    { charge: true, allow: true, expected: 200 },
  ];
  const evidence = [];

  for (const mode of modes) {
    if (mode.canonical) process.env.PDV_CANONICAL_TENANTS = 'cmr9yis3c0000hvu00q9fe7y1';
    else delete process.env.PDV_CANONICAL_TENANTS;
    const f = await tenantFixture(`close-${mode.name}`, { canonical: mode.canonical });
    const session = await prisma.sessaoCaixaOperacao.create({ data: {
      cervejariaId: f.tenantId, pontoVendaId: f.pointId, diaOperacional: day, trocoInicial: 0, abertoPorId: f.ownerId,
    } });
    const stockBefore = await prisma.inventoryMovement.findMany({ where: { pedidoId: f.orderId }, orderBy: { createdAt: 'asc' } });

    for (const combo of combos) {
      if (mode.canonical) {
        await prisma.configuracaoPontoVenda.update({ where: { pontoVendaId: f.pointId }, data: {
          kitchenItemsChargeAtLaunch: combo.charge,
          allowCloseComandaWithPendingKitchenOrders: combo.allow,
        } });
      } else {
        await prisma.configuracaoOperacional.update({ where: { cervejariaId: f.tenantId }, data: {
          kitchenItemsChargeAtLaunch: combo.charge,
          allowCloseComandaWithPendingKitchenOrders: combo.allow,
        } });
      }

      if (combo.expected === 200 && mode.canonical) {
        const noPermission = await inject(f, 'POST', `/operacao/comandas/${f.commandId}/pagamentos`, f.noPermissionId, f.tenantId, {
          pagamentos: [{ forma: 'PIX', valor: 25 }],
        });
        assert.equal(noPermission.statusCode, 403);
        assert.equal(await prisma.pagamento.count({ where: { comandaId: f.commandId } }), 0);
        assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: f.commandId } })).status, 'ABERTA');
      }

      const response = await inject(f, 'POST', `/operacao/comandas/${f.commandId}/pagamentos`, f.ownerId, f.tenantId, {
        pagamentos: [{ forma: 'PIX', valor: 25 }],
      });
      assert.equal(response.statusCode, combo.expected, `${mode.name} charge=${combo.charge} allow=${combo.allow}: ${response.body}`);

      if (combo.expected === 409) {
        assert.match(response.body, /Aguarde a entrega dos itens da cozinha antes de fechar a comanda/);
        assert.equal(await prisma.pagamento.count({ where: { comandaId: f.commandId } }), 0);
        assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: f.commandId } })).status, 'ABERTA');
        assert.deepEqual(await prisma.inventoryMovement.findMany({ where: { pedidoId: f.orderId }, orderBy: { createdAt: 'asc' } }), stockBefore);
      } else {
        const closed = await prisma.comanda.findUniqueOrThrow({ where: { id: f.commandId } });
        assert.equal(closed.status, 'FECHADA');
        assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: f.orderId } })).status, 'RECEBIDO');
        assert.equal(await prisma.pagamento.count({ where: { comandaId: f.commandId } }), 1);
        assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessaoId: session.id } }), 0);
        assert.deepEqual(await prisma.inventoryMovement.findMany({ where: { pedidoId: f.orderId }, orderBy: { createdAt: 'asc' } }), stockBefore);
      }

      evidence.push({ mode: mode.name, charge: combo.charge, allow: combo.allow, status: response.statusCode, sessionId: session.id });
    }
    delete process.env.PDV_CANONICAL_TENANTS;
  }

  console.log(JSON.stringify({ scenario: 'pending-kitchen-api-close-gate', cases: evidence, authorizedCloseOnlyWhenBothFlagsTrue: true, unauthorizedUserDenied: true, noDuplicateStockEffects: true }, null, 2));
});

test.after(async () => {
  await new Promise((resolve) => ioServer.close(() => resolve()));
  await app.close();
  await prisma.$disconnect();
});
