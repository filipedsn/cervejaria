import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, databaseUrl);
assert.equal(new URL(databaseUrl).pathname, '/cervejaria_qa_pdv_unico');
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    cwd: backendRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, `Prisma ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
};

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `pdv-permissions-uploads-${process.pid}`);
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '1';
const [{ PrismaClient }, { buildApp, setupSocketIO }, { hashPassword }] = await Promise.all([
  import('@prisma/client'), import('../src/app.ts'), import('../src/lib/utils.ts'),
]);
const { io: connectSocket } = await import('socket.io-client');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const suffix = randomBytes(6).toString('hex');
const app = await buildApp();
setupSocketIO(app, app.server);
const ownerPassword = `QaOwner-${suffix}-only!`;
const attendantPassword = `QaStaff-${suffix}-only!`;
const otherOwnerPassword = `QaOther-${suffix}-only!`;
const [ownerHash, attendantHash, otherOwnerHash] = await Promise.all([
  hashPassword(ownerPassword), hashPassword(attendantPassword), hashPassword(otherOwnerPassword),
]);
const company = await prisma.cervejaria.create({ data: { nome: `Permission QA ${suffix}`, slug: `permission-qa-${suffix}` } });
const otherCompany = await prisma.cervejaria.create({ data: { nome: `Other permission QA ${suffix}`, slug: `other-permission-qa-${suffix}` } });
const owner = await prisma.usuario.create({ data: { nome: 'QA Owner', email: `owner-${suffix}@example.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: company.id } });
const staff = await prisma.usuario.create({ data: { nome: 'QA Attendant', email: `staff-${suffix}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: company.id } });
const otherOwner = await prisma.usuario.create({ data: { nome: 'Other Owner', email: `other-${suffix}@example.invalid`, senhaHash: otherOwnerHash, papel: 'DONO', cervejariaId: otherCompany.id } });
await prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, exclusivo: true } });
await prisma.configuracaoOperacional.create({ data: { cervejariaId: company.id, plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false } });
const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Principal' } });

function cookieFor(response) {
  const setCookie = response.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(value, 'login must set the authenticated session cookie');
  return value.split(';', 1)[0];
}
async function login(email, password) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: password } });
  assert.equal(response.statusCode, 200, response.body);
  return cookieFor(response);
}

const ownerCookie = await login(owner.email, ownerPassword);
const staffCookie = await login(staff.email, attendantPassword);
const foreignOwnerCookie = await login(otherOwner.email, otherOwnerPassword);
const authHeaders = (cookie) => ({ cookie });
const trailer = await prisma.trailer.create({ data: { nome: `QA trailer ${suffix}`, cervejariaId: company.id } });
const foreignTrailer = await prisma.trailer.create({ data: { nome: `Foreign QA trailer ${suffix}`, cervejariaId: otherCompany.id } });
const event = await prisma.evento.create({ data: { nome: `Event cash QA ${suffix}`, local: 'QA', cervejariaId: company.id, trailerId: trailer.id } });
const eventForPermissionGrants = await prisma.evento.create({ data: { nome: `Event permission QA ${suffix}`, local: 'QA', cervejariaId: company.id, trailerId: trailer.id } });
const foreignEvent = await prisma.evento.create({ data: { nome: `Foreign event QA ${suffix}`, local: 'QA', cervejariaId: otherCompany.id, trailerId: foreignTrailer.id } });
const eventCash = await prisma.sessaoCaixaEvento.create({
  data: { eventoId: event.id, abertoPorId: owner.id, trocoInicial: '734.21' },
});
await prisma.movimentoCaixaEvento.create({
  data: { sessaoId: eventCash.id, tipo: 'SUPRIMENTO', valor: '18.37', registradoPorId: owner.id },
});

function financialPhoto() {
  return Promise.all([
    prisma.sessaoCaixaEvento.findMany({ where: { eventoId: event.id }, orderBy: { id: 'asc' } }),
    prisma.movimentoCaixaEvento.findMany({ where: { sessaoId: eventCash.id }, orderBy: { id: 'asc' } }),
    prisma.pagamento.count({ where: { sessaoCaixaEventoId: eventCash.id } }),
  ]);
}

// The owner has integral authority; the attendant has no powers by default.
const ownerReport = await app.inject({ method: 'GET', url: '/api/relatorios/evento/not-found', headers: authHeaders(ownerCookie) });
assert.equal(ownerReport.statusCode, 404, ownerReport.body);
const deniedReport = await app.inject({ method: 'GET', url: '/api/relatorios/evento/not-found', headers: authHeaders(staffCookie) });
assert.equal(deniedReport.statusCode, 403, deniedReport.body);

// The alternate event cash routes expose only state to a restricted attendant.
const eventCashBefore = await financialPhoto();
const restrictedEventCash = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/caixa`, headers: authHeaders(staffCookie) });
assert.equal(restrictedEventCash.statusCode, 200, restrictedEventCash.body);
assert.equal(JSON.parse(restrictedEventCash.body).caixa.valoresRestritos, true);
for (const secret of ['734.21', '18.37', 'esperado', 'movimentos', 'recebidos']) {
  assert.equal(restrictedEventCash.body.includes(secret), false, `event cash read leaked ${secret}`);
}
const deniedEventOpen = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/caixa/abrir`, headers: authHeaders(staffCookie), payload: { trocoInicial: 32.17 } });
assert.equal(deniedEventOpen.statusCode, 403, deniedEventOpen.body);
const deniedEventMovement = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/caixa/movimentos`, headers: authHeaders(staffCookie), payload: { tipo: 'SANGRIA', valor: 7.19 } });
assert.equal(deniedEventMovement.statusCode, 403, deniedEventMovement.body);
const deniedEventClose = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/caixa/fechar`, headers: authHeaders(staffCookie), payload: { contadoDinheiro: 0, contadoPix: 0, contadoDebito: 0, contadoCredito: 0, contadoCartao: 0 } });
assert.equal(deniedEventClose.statusCode, 403, deniedEventClose.body);
const deniedEventDebtList = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/contas-pendentes`, headers: authHeaders(staffCookie) });
assert.equal(deniedEventDebtList.statusCode, 403, deniedEventDebtList.body);
const deniedEventDebtReceipt = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/contas-pendentes/not-found/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'PIX', valor: 1 }] } });
assert.equal(deniedEventDebtReceipt.statusCode, 403, deniedEventDebtReceipt.body);
assert.deepEqual(await financialPhoto(), eventCashBefore, 'event cash denials preserve session, movements, and payments');
const ownerEventCash = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/caixa`, headers: authHeaders(ownerCookie) });
assert.equal(ownerEventCash.statusCode, 200, ownerEventCash.body);
assert.equal(ownerEventCash.body.includes('734.21'), true, 'owner retains full event cash values');
const crossTenantEventCash = await app.inject({ method: 'GET', url: `/api/eventos/${foreignEvent.id}/caixa`, headers: authHeaders(ownerCookie) });
assert.equal(crossTenantEventCash.statusCode, 404, crossTenantEventCash.body);
const grantEventOpen = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.open'] } });
assert.equal(grantEventOpen.statusCode, 200, grantEventOpen.body);
const allowedEventOpen = await app.inject({ method: 'POST', url: `/api/eventos/${eventForPermissionGrants.id}/caixa/abrir`, headers: authHeaders(staffCookie), payload: { trocoInicial: 987.65 } });
assert.equal(allowedEventOpen.statusCode, 201, allowedEventOpen.body);
const allowedEventCashBody = JSON.parse(allowedEventOpen.body).caixa;
assert.equal(allowedEventCashBody.valoresRestritos, true);
assert.equal(allowedEventOpen.body.includes('987.65'), false, 'cash.open alone must not expose opening float');
const grantedEventSession = await prisma.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: allowedEventCashBody.id } });
assert.equal(Number(grantedEventSession.trocoInicial), 987.65, 'isolated cash.open permission persisted an actual event session');
const grantEventMovement = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.movement.write'] } });
assert.equal(grantEventMovement.statusCode, 200, grantEventMovement.body);
const allowedEventMovement = await app.inject({ method: 'POST', url: `/api/eventos/${eventForPermissionGrants.id}/caixa/movimentos`, headers: authHeaders(staffCookie), payload: { tipo: 'SUPRIMENTO', valor: 4.56 } });
assert.equal(allowedEventMovement.statusCode, 200, allowedEventMovement.body);
assert.equal(allowedEventMovement.body.includes('4.56'), false, 'cash.movement.write alone must return a redacted movement');
assert.equal(await prisma.movimentoCaixaEvento.count({ where: { sessaoId: grantedEventSession.id } }), 1, 'isolated cash.movement.write records the movement');
const beforeClosePermission = await prisma.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: grantedEventSession.id }, select: { status: true, fechadoEm: true } });
const closeWithoutRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.close'] } });
assert.equal(closeWithoutRead.statusCode, 200, closeWithoutRead.body);
const isolatedEventClose = await app.inject({ method: 'POST', url: `/api/eventos/${eventForPermissionGrants.id}/caixa/fechar`, headers: authHeaders(staffCookie), payload: { contadoDinheiro: 0, contadoPix: 0, contadoDebito: 0, contadoCredito: 0, contadoCartao: 0 } });
assert.equal(isolatedEventClose.statusCode, 403, isolatedEventClose.body);
assert.deepEqual(await prisma.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: grantedEventSession.id }, select: { status: true, fechadoEm: true } }), beforeClosePermission);
const grantEventClose = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.close', 'cash.values.read'] } });
assert.equal(grantEventClose.statusCode, 200, grantEventClose.body);
const allowedEventClose = await app.inject({ method: 'POST', url: `/api/eventos/${eventForPermissionGrants.id}/caixa/fechar`, headers: authHeaders(staffCookie), payload: { contadoDinheiro: 992.21, contadoPix: 0, contadoDebito: 0, contadoCredito: 0, contadoCartao: 0 } });
assert.equal(allowedEventClose.statusCode, 200, allowedEventClose.body);
assert.equal(JSON.parse(allowedEventClose.body).caixa.status, 'FECHADO');
assert.equal(Number((await prisma.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: grantedEventSession.id } })).contadoDinheiro), 992.21);
const debtClient = await prisma.cliente.create({ data: { nome: 'Debt QA customer', telefone: `119876${Date.now().toString().slice(-5)}`, cervejariaId: company.id } });
const debtCommand = await prisma.comanda.create({ data: { eventoId: event.id, clienteId: debtClient.id, status: 'FECHADA', tipo: 'COMANDA', total: '25.00', fechadaEm: new Date() } });
const debt = await prisma.contaReceber.create({ data: { comandaId: debtCommand.id, clienteId: debtClient.id, valorOriginal: '25.00', criadoPorId: owner.id } });
const deniedDebtPhoto = await financialPhoto();
const deniedDebtReceipt = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/contas-pendentes/${debt.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
assert.equal(deniedDebtReceipt.statusCode, 403, deniedDebtReceipt.body);
assert.deepEqual(await financialPhoto(), deniedDebtPhoto, 'debt receipt denial leaves event cash unchanged');
const grantDebt = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['debt.receive'] } });
assert.equal(grantDebt.statusCode, 200, grantDebt.body);
const allowedDebtReceipt = await app.inject({ method: 'POST', url: `/api/eventos/${event.id}/contas-pendentes/${debt.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
assert.equal(allowedDebtReceipt.statusCode, 200, allowedDebtReceipt.body);
assert.equal(JSON.parse(allowedDebtReceipt.body).conta.saldo, 15);
assert.equal(await prisma.pagamento.count({ where: { contaReceberId: debt.id, registradoPorId: staff.id } }), 1, 'debt.receive records the partial payment');
const allowedDebtList = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/contas-pendentes`, headers: authHeaders(staffCookie) });
assert.equal(allowedDebtList.statusCode, 200, allowedDebtList.body);
assert.equal(JSON.parse(allowedDebtList.body)[0].saldo, 15);

// Grant one permission, use the same already-authenticated cookie, then revoke it.
const grantDashboard = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['dashboard.read'] } });
assert.equal(grantDashboard.statusCode, 200, grantDashboard.body);
const grantedDashboard = await app.inject({ method: 'GET', url: '/api/cervejaria/dashboard', headers: authHeaders(staffCookie) });
assert.equal(grantedDashboard.statusCode, 200, grantedDashboard.body);
const revokeDashboard = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeDashboard.statusCode, 200, revokeDashboard.body);
const revokedDashboard = await app.inject({ method: 'GET', url: '/api/cervejaria/dashboard', headers: authHeaders(staffCookie) });
assert.equal(revokedDashboard.statusCode, 403, revokedDashboard.body);

// Unknown permission, self-edit, and cross-tenant attempts are rejected.
const unknown = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.superuser'] } });
assert.equal(unknown.statusCode, 400, unknown.body);
const selfEdit = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(staffCookie), payload: { permissoesOperacao: ['reports.read'] } });
assert.equal(selfEdit.statusCode, 403, selfEdit.body);
const crossTenant = await app.inject({ method: 'PATCH', url: `/api/usuarios/${otherOwner.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['reports.read'] } });
assert.equal(crossTenant.statusCode, 404, crossTenant.body);
const ownerSelfEdit = await app.inject({ method: 'PATCH', url: `/api/usuarios/${owner.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(ownerSelfEdit.statusCode, 409, ownerSelfEdit.body);

// The cash open route is denied before any operational write. With one explicit
// permission, the same request passes authorization and reaches normal validation.
const beforeDeniedOpen = await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: company.id } });
const openPayload = { pontoVendaId: point.id, trocoInicial: 0, cardapioId: `missing-${suffix}` };
const deniedOpen = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: authHeaders(staffCookie), payload: openPayload });
assert.equal(deniedOpen.statusCode, 403, deniedOpen.body);
assert.equal(await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: company.id } }), beforeDeniedOpen, 'denial does not create a cash session');
const grantOpen = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.open'] } });
assert.equal(grantOpen.statusCode, 200, grantOpen.body);
const allowedOpen = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: authHeaders(staffCookie), payload: openPayload });
assert.equal(allowedOpen.statusCode, 400, allowedOpen.body);
const occurrence = await prisma.ocorrenciaOperacional.create({
  data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Occurrence QA ${suffix}`, data: new Date('2026-10-07T00:00:00.000Z') },
});
const cashSession = await prisma.sessaoCaixaOperacao.create({
  data: {
    cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: new Date('2026-10-07T00:00:00.000Z'),
    status: 'ABERTO', trocoInicial: '123.45', abertoPorId: staff.id, ocorrenciaId: occurrence.id,
  },
  select: { id: true, diaOperacional: true },
});
const restrictedCash = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(restrictedCash.statusCode, 200, restrictedCash.body);
const restrictedCashBody = JSON.parse(restrictedCash.body);
assert.equal(restrictedCashBody.sessao.id, cashSession.id);
assert.equal(restrictedCashBody.sessao.ocorrenciaId, occurrence.id);
assert.equal(restrictedCashBody.sessao.ocorrencia.id, occurrence.id);
assert.equal(restrictedCashBody.sessao.ocorrencia.nome, occurrence.nome);
assert.equal(restrictedCashBody.sessao.diaOperacional, '2026-10-07');
assert.notEqual(restrictedCashBody.sessao.ocorrencia.nome, 'Sem ocorrência');
assert.equal(restrictedCashBody.valoresRestritos, true);
for (const restrictedField of ['trocoInicial', 'totalVendas', 'movimentos', '123.45']) {
assert.equal(restrictedCash.body.includes(restrictedField), false, `restricted cash response leaked ${restrictedField}`);
}
const deniedClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
assert.equal(deniedClose.statusCode, 403, deniedClose.body);
assert.equal((await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, select: { status: true, fechadoEm: true } })).fechadoEm, null, 'denied close leaves session open');

// Both item-removal APIs and quantity reduction share the dedicated item
// cancellation capability. The PATCH decision is made from the row read after
// acquiring the same comanda lock used by stock and ledger writes.
await prisma.configuracaoOperacao.update({ where: { cervejariaId: company.id }, data: { controlaEstoque: true, temCozinha: true } });
await prisma.configuracaoOperacional.update({ where: { cervejariaId: company.id }, data: { inventoryEnabled: true, kitchenEnabled: true } });
const stockProduct = await prisma.produto.create({ data: { nome: `Stock QA ${suffix}`, tipo: 'COMIDA', controlaEstoque: true, cervejariaId: company.id } });
const stockBalance = await prisma.inventoryBalance.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: stockProduct.id, quantidade: '10.000' } });
const operationalCommand = await prisma.comanda.create({
  data: { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id, diaOperacional: cashSession.diaOperacional, tipo: 'MESA', identificador: `QA-${suffix}`, status: 'ABERTA', abertaPorId: owner.id, total: '30.00' },
});
const operationalOrder = await prisma.pedidoOperacao.create({
  data: { cervejariaId: company.id, comandaId: operationalCommand.id, pontoVendaId: point.id, numero: 810001, diaOperacional: cashSession.diaOperacional, criadoPorId: owner.id, status: 'RECEBIDO' },
});
const operationalItem = await prisma.itemComanda.create({
  data: { comandaId: operationalCommand.id, produtoId: stockProduct.id, pedidoCozinhaId: operationalOrder.id, nome: stockProduct.nome, quantidade: 3, precoUnit: '10.00', exigePreparo: false },
});
const optionalSnapshot = await prisma.itemComandaOpcional.create({ data: { itemComandaId: operationalItem.id, nome: 'QA optional', precoAdicional: '1.25', quantidade: 2 } });
async function itemCancellationPhoto() {
  return {
    command: await prisma.comanda.findUniqueOrThrow({ where: { id: operationalCommand.id }, select: { total: true, status: true } }),
    item: await prisma.itemComanda.findUniqueOrThrow({ where: { id: operationalItem.id }, include: { opcionais: true } }),
    optional: await prisma.itemComandaOpcional.findUniqueOrThrow({ where: { id: optionalSnapshot.id } }),
    balance: await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } }),
    ledger: await prisma.inventoryMovement.findMany({ where: { cervejariaId: company.id, produtoId: stockProduct.id }, orderBy: { createdAt: 'asc' } }),
  };
}
const itemBeforeDenials = await itemCancellationPhoto();
const legacyItemDeleteDenied = await app.inject({ method: 'DELETE', url: `/api/comandas/${debtCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie) });
assert.equal(legacyItemDeleteDenied.statusCode, 403, legacyItemDeleteDenied.body);
const operationalItemDeleteDenied = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${operationalCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie) });
assert.equal(operationalItemDeleteDenied.statusCode, 403, operationalItemDeleteDenied.body);
const quantityReductionDenied = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie), payload: { quantidade: 2 } });
assert.equal(quantityReductionDenied.statusCode, 403, quantityReductionDenied.body);
const fullCancelDenied = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${operationalCommand.id}/cancelar`, headers: authHeaders(staffCookie), payload: {} });
assert.equal(fullCancelDenied.statusCode, 403, fullCancelDenied.body, 'item cancellation does not authorize full command cancellation');
assert.deepEqual(await itemCancellationPhoto(), itemBeforeDenials, 'denied item removal/reduction preserves quantity, total, optionals, stock and ledger');
const grantItemCancellation = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.item.cancel'] } });
assert.equal(grantItemCancellation.statusCode, 200, grantItemCancellation.body);
const reducedQuantity = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie), payload: { quantidade: 2 } });
assert.equal(reducedQuantity.statusCode, 200, reducedQuantity.body);
assert.equal(JSON.parse(reducedQuantity.body).pedidos[0].itens.find((item) => item.id === operationalItem.id).quantidade, 2, 'authorized reduction returns the persisted updated command');
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: operationalItem.id } })).quantidade, 2);
assert.equal(Number((await prisma.comanda.findUniqueOrThrow({ where: { id: operationalCommand.id } })).total), 20);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } })).quantidade), 11);
assert.equal(await prisma.inventoryMovement.count({ where: { cervejariaId: company.id, produtoId: stockProduct.id, tipo: 'ESTORNO_VENDA' } }), 1);
const revokeItemCancellation = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeItemCancellation.statusCode, 200, revokeItemCancellation.body);
const increasedQuantity = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie), payload: { quantidade: 3 } });
assert.equal(increasedQuantity.statusCode, 200, increasedQuantity.body, 'quantity increases remain permitted without item cancellation permission');
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: operationalItem.id } })).quantidade, 3);

// Authenticated sale, payment, kitchen cancellation/refund, stock reversal and
// debt settlement execute against the isolated PostgreSQL database.
await prisma.produto.update({ where: { id: stockProduct.id }, data: { pontoVendaId: point.id, exigePreparo: true } });
await prisma.preco.create({ data: { produtoId: stockProduct.id, volumeMl: 0, preco: '10.00' } });
const cardapio = await prisma.cardapio.create({ data: { nome: `QA menu ${suffix}`, cervejariaId: company.id, pontoVendaId: point.id } });
await prisma.cardapioProduto.create({ data: { cardapioId: cardapio.id, produtoId: stockProduct.id, cervejariaId: company.id, pontoVendaId: point.id, volumeMl: 0, precoUnit: '10.00' } });
await prisma.sessaoCaixaOperacao.update({ where: { id: cashSession.id }, data: { cardapioId: cardapio.id } });
await prisma.sessaoCaixaProdutoOperacao.create({ data: { sessaoCaixaId: cashSession.id, produtoId: stockProduct.id, volumeMl: 0, precoUnit: '10.00' } });
const salePayload = { pontoVendaId: point.id, itens: [{ produtoId: stockProduct.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 10 }] };
async function commercePhoto() {
  return {
    balance: await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } }),
    movement: await prisma.inventoryMovement.findMany({ where: { cervejariaId: company.id, produtoId: stockProduct.id }, orderBy: { createdAt: 'asc' } }),
    payments: await prisma.pagamento.findMany({ where: { registradoPorId: staff.id, comanda: { pontoVendaId: point.id } }, orderBy: { pagoEm: 'asc' } }),
    commands: await prisma.comanda.findMany({ where: { pontoVendaId: point.id }, select: { id: true, status: true, total: true }, orderBy: { id: 'asc' } }),
  };
}
const saleBeforeDenial = await commercePhoto();
const deniedSale = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: authHeaders(staffCookie), payload: salePayload });
assert.equal(deniedSale.statusCode, 403, deniedSale.body);
assert.deepEqual(await commercePhoto(), saleBeforeDenial, 'payment.receive denial causes no sale, payment or stock write');
const grantPayment = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['payment.receive'] } });
assert.equal(grantPayment.statusCode, 200, grantPayment.body);
const completedSale = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: authHeaders(staffCookie), payload: salePayload });
assert.equal(completedSale.statusCode, 201, completedSale.body);
const completedSaleBody = JSON.parse(completedSale.body);
assert.equal(completedSaleBody.status, 'FECHADA');
const saleCommand = await prisma.comanda.findUniqueOrThrow({ where: { id: completedSaleBody.id }, include: { pagamentos: true } });
assert.equal(saleCommand.status, 'FECHADA');
assert.equal(saleCommand.pagamentos.length, 1);
assert.equal(Number(saleCommand.pagamentos[0].valor), 10);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } })).quantidade), 9);
const saleOrder = await prisma.pedidoOperacao.findFirstOrThrow({ where: { comandaId: saleCommand.id } });
const beforeRefundDenial = await commercePhoto();
const deniedRefund = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${saleOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'CANCELAMENTO_PENDENTE' } });
assert.equal(deniedRefund.statusCode, 403, deniedRefund.body);
assert.deepEqual(await commercePhoto(), beforeRefundDenial, 'refund denial preserves sale, payment, stock and ledger');
const grantRefund = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['payment.receive', 'kitchen.cancel', 'sale.refund'] } });
assert.equal(grantRefund.statusCode, 200, grantRefund.body);
const approvedRefund = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${saleOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'CANCELAMENTO_PENDENTE' } });
assert.equal(approvedRefund.statusCode, 200, approvedRefund.body);
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: saleOrder.id } })).status, 'CANCELAMENTO_PENDENTE');
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } })).quantidade), 10);
const salePaymentsAfterRefund = await prisma.pagamento.findMany({ where: { comandaId: saleCommand.id }, orderBy: { pagoEm: 'asc' } });
assert.equal(salePaymentsAfterRefund.length, 2);
assert.equal(Number(salePaymentsAfterRefund[1].valor), -10);
assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: saleOrder.id, tipo: 'ESTORNO_VENDA' } }), 1);
const commandForClose = await prisma.comanda.create({
  data: { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id, diaOperacional: cashSession.diaOperacional, tipo: 'MESA', identificador: `Close-${suffix}`, status: 'ABERTA', abertaPorId: owner.id, total: '10.00' },
});
const closeItem = await prisma.itemComanda.create({ data: { comandaId: commandForClose.id, produtoId: stockProduct.id, nome: stockProduct.nome, quantidade: 1, precoUnit: '10.00' } });
const beforeCommandCloseDenial = await commercePhoto();
const deniedCommandClose = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${commandForClose.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'DINHEIRO', valor: 10 }], deixarPendente: false } });
assert.equal(deniedCommandClose.statusCode, 403, deniedCommandClose.body);
assert.deepEqual(await commercePhoto(), beforeCommandCloseDenial, 'command.close denial preserves command, payment, stock and ledger');
const grantCommandClose = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['payment.receive', 'command.close', 'kitchen.cancel', 'sale.refund'] } });
assert.equal(grantCommandClose.statusCode, 200, grantCommandClose.body);
const allowedCommandClose = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${commandForClose.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'DINHEIRO', valor: 10 }], deixarPendente: false } });
assert.equal(allowedCommandClose.statusCode, 200, allowedCommandClose.body);
assert.equal(JSON.parse(allowedCommandClose.body).status, 'FECHADA');
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: commandForClose.id } })).status, 'FECHADA');
assert.equal(await prisma.pagamento.count({ where: { comandaId: commandForClose.id, registradoPorId: staff.id } }), 1);
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: closeItem.id } })).quantidade, 1);
const emptyCommand = await prisma.comanda.create({ data: { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id, diaOperacional: cashSession.diaOperacional, tipo: 'FICHA', identificador: `Cancel-${suffix}`, status: 'ABERTA', abertaPorId: owner.id, total: 0 } });
const deniedFullCancel = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${emptyCommand.id}/cancelar`, headers: authHeaders(staffCookie), payload: {} });
assert.equal(deniedFullCancel.statusCode, 403, deniedFullCancel.body);
const ownerFullCancel = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${emptyCommand.id}/cancelar`, headers: authHeaders(ownerCookie), payload: {} });
assert.equal(ownerFullCancel.statusCode, 200, ownerFullCancel.body);
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: emptyCommand.id } })).status, 'CANCELADA');

// The operational cash session keeps status/occurrence visible, while final
// close still requires both close authority and financial read authority.
await prisma.comanda.update({ where: { id: operationalCommand.id }, data: { status: 'CANCELADA' } });
const beforeCashCloseDenial = await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, select: { status: true, fechadoEm: true } });
const readOnlyCashClose = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.values.read'] } });
assert.equal(readOnlyCashClose.statusCode, 200, readOnlyCashClose.body);
const deniedOperationalCashClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, contadoDinheiro: 133.45, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
assert.equal(deniedOperationalCashClose.statusCode, 403, deniedOperationalCashClose.body);
assert.deepEqual(await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, select: { status: true, fechadoEm: true } }), beforeCashCloseDenial);
const grantOperationalCashClose = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.close', 'cash.values.read'] } });
assert.equal(grantOperationalCashClose.statusCode, 200, grantOperationalCashClose.body);
const allowedOperationalCashClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, contadoDinheiro: 133.45, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
assert.equal(allowedOperationalCashClose.statusCode, 200, allowedOperationalCashClose.body);
assert.equal((await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id } })).status, 'FECHADO');

// Real local Socket.IO session: assert server-side room membership before each
// event, then verify the actual authenticated kitchen launch/update emitters.
const revokeSocketRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeSocketRead.statusCode, 200, revokeSocketRead.body);
const localAddress = await app.listen({ host: '127.0.0.1', port: 0 });
const socket = connectSocket(localAddress, { extraHeaders: { cookie: staffCookie }, transports: ['websocket'], reconnection: false });
const financeSocket = connectSocket(localAddress, { extraHeaders: { cookie: ownerCookie }, transports: ['websocket'], reconnection: false });
const socketEventFor = (client, name, predicate = () => true, timeoutMs = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { client.off(name, listener); reject(new Error(`Timed out waiting for Socket.IO ${name}`)); }, timeoutMs);
  const listener = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    client.off(name, listener);
    resolve(payload);
  };
  client.on(name, listener);
});
const socketEvent = (name, predicate = () => true, timeoutMs = 3000) => socketEventFor(socket, name, predicate, timeoutMs);
const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out observing server state: ${description}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const connect = (client) => new Promise((resolve, reject) => {
  client.once('connect', resolve);
  client.once('connect_error', reject);
});
await Promise.all([connect(socket), connect(financeSocket)]);
const socketIdBeforeRevoke = socket.id;
socket.emit('join:evento', event.id);
socket.emit('join:cervejaria', company.id);
financeSocket.emit('join:cervejaria', company.id);
await waitFor(() => {
  const staffServerSocket = app.io.sockets.sockets.get(socket.id);
  const financeServerSocket = app.io.sockets.sockets.get(financeSocket.id);
  return staffServerSocket?.rooms.has(`cervejaria:${company.id}:operacao`)
    && staffServerSocket?.rooms.has(`evento:${event.id}:operacao`)
    && staffServerSocket?.data.tenantSubscriptions?.has(company.id)
    && staffServerSocket?.data.eventoSubscriptions?.has(event.id)
    && financeServerSocket?.rooms.has(`cervejaria:${company.id}:financeiro`);
}, 'flag-on staff and owner joins');
const { emitFinancialToEvento, emitToCervejaria, emitToEvento } = await import('../src/lib/realtime.ts');

// Launch a persisted order over the authenticated API with a linked optional.
const socketOptional = await prisma.opcional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `QA topping ${suffix}`, preco: '2.50' } });
await prisma.produtoOpcionalVinculo.create({ data: { produtoId: stockProduct.id, opcionalId: socketOptional.id, cervejariaId: company.id, pontoVendaId: point.id } });
const socketSession = await prisma.sessaoCaixaOperacao.create({ data: {
  cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: cashSession.diaOperacional,
  status: 'ABERTO', trocoInicial: '20.00', abertoPorId: staff.id, ocorrenciaId: occurrence.id, cardapioId: cardapio.id,
} });
await prisma.sessaoCaixaProdutoOperacao.create({ data: { sessaoCaixaId: socketSession.id, produtoId: stockProduct.id, volumeMl: 0, precoUnit: '10.00' } });
const newRestrictedOrder = socketEvent('operacao:pedido-novo');
const newFinanceOrder = new Promise((resolve, reject) => {
  const timer = setTimeout(() => { financeSocket.off('operacao:pedido-novo', listener); reject(new Error('Timed out waiting for finance kitchen order')); }, 3000);
  const listener = (payload) => { clearTimeout(timer); financeSocket.off('operacao:pedido-novo', listener); resolve(payload); };
  financeSocket.on('operacao:pedido-novo', listener);
});
const launchedSocketCommand = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: authHeaders(staffCookie), payload: {
  pontoVendaId: point.id, tipo: 'MESA', identificador: `Socket-${suffix}`, paraViagem: true, observacao: 'sem cebola',
  itens: [{ produtoId: stockProduct.id, quantidade: 2, paraViagem: true, observacao: 'bem passado', opcionais: [{ opcionalId: socketOptional.id, quantidade: 2 }] }],
} });
assert.equal(launchedSocketCommand.statusCode, 201, launchedSocketCommand.body);
const launchedSocketCommandId = JSON.parse(launchedSocketCommand.body).id;
const persistedSocketOrder = await prisma.pedidoOperacao.findFirstOrThrow({ where: { comandaId: launchedSocketCommandId }, include: { itensComanda: { include: { opcionais: true } } } });
assert.equal(persistedSocketOrder.criadoPorId, staff.id);
assert.equal(persistedSocketOrder.itensComanda.length, 1);
assert.equal(persistedSocketOrder.itensComanda[0].opcionais[0].nome, socketOptional.nome);
const [restrictedNewOrder, financeNewOrder] = await Promise.all([newRestrictedOrder, newFinanceOrder]);
assert.equal(restrictedNewOrder.itensComanda[0].id, persistedSocketOrder.itensComanda[0].id);
assert.equal(restrictedNewOrder.itensComanda[0].nome, stockProduct.nome);
assert.equal(restrictedNewOrder.itensComanda[0].quantidade, 2);
assert.equal(restrictedNewOrder.itensComanda[0].observacao, 'bem passado');
assert.equal(restrictedNewOrder.itensComanda[0].paraViagem, true);
assert.deepEqual(restrictedNewOrder.itensComanda[0].opcionais.map(({ nome, quantidade }) => ({ nome, quantidade })), [{ nome: socketOptional.nome, quantidade: 2 }]);
assert.equal(JSON.stringify(restrictedNewOrder).includes('preco'), false, 'restricted order removes all price fields');
assert.equal(financeNewOrder.itens[0].id, persistedSocketOrder.itensComanda[0].id);
assert.equal(financeNewOrder.itens[0].precoUnit, 15);
assert.equal(financeNewOrder.itens[0].opcionais[0].precoAdicional, 2.5);

// A failed authenticated launch rolls back the stock/order transaction and
// emits nothing because notification runs only after a committed transaction.
const eventsBeforeRollback = [];
const onNewOrderForRollback = (payload) => eventsBeforeRollback.push(payload);
socket.on('operacao:pedido-novo', onNewOrderForRollback);
const balanceBeforeRollback = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } });
await prisma.inventoryBalance.update({ where: { id: stockBalance.id }, data: { quantidade: '0.000' } });
const ordersBeforeRollback = await prisma.pedidoOperacao.count({ where: { cervejariaId: company.id } });
const rollbackLaunch = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: authHeaders(staffCookie), payload: {
  pontoVendaId: point.id, tipo: 'MESA', identificador: `Rollback-${suffix}`,
  itens: [{ produtoId: stockProduct.id, quantidade: 1 }],
} });
assert.notEqual(rollbackLaunch.statusCode, 201, rollbackLaunch.body);
assert.equal(await prisma.pedidoOperacao.count({ where: { cervejariaId: company.id } }), ordersBeforeRollback);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } })).quantidade), 0);
await prisma.inventoryBalance.update({ where: { id: stockBalance.id }, data: { quantidade: balanceBeforeRollback.quantidade } });
await new Promise((resolve) => setTimeout(resolve, 80));
socket.off('operacao:pedido-novo', onNewOrderForRollback);
assert.equal(eventsBeforeRollback.length, 0, 'rolled back kitchen order emits no pedido novo');

const statusUpdateRestricted = socketEvent('operacao:pedido-atualizado', (payload) => payload.id === persistedSocketOrder.id);
const statusUpdateFinance = new Promise((resolve, reject) => {
  const timer = setTimeout(() => { financeSocket.off('operacao:pedido-atualizado', listener); reject(new Error('Timed out waiting for finance kitchen status')); }, 3000);
  const listener = (payload) => { if (payload.id !== persistedSocketOrder.id) return; clearTimeout(timer); financeSocket.off('operacao:pedido-atualizado', listener); resolve(payload); };
  financeSocket.on('operacao:pedido-atualizado', listener);
});
const statusChanged = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${persistedSocketOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'EM_PREPARO' } });
assert.equal(statusChanged.statusCode, 200, statusChanged.body);
const [restrictedStatus, financeStatus] = await Promise.all([statusUpdateRestricted, statusUpdateFinance]);
assert.equal(restrictedStatus.status, 'EM_PREPARO');
assert.equal(restrictedStatus.itensComanda[0].id, persistedSocketOrder.itensComanda[0].id);
assert.deepEqual(restrictedStatus.itensComanda[0].opcionais.map(({ nome, quantidade }) => ({ nome, quantidade })), [{ nome: socketOptional.nome, quantidade: 2 }]);
assert.equal(JSON.stringify(restrictedStatus).includes('preco'), false);
assert.equal(financeStatus.status, 'EM_PREPARO');
assert.equal(financeStatus.itens[0].precoUnit, 15);
assert.equal(financeStatus.itens[0].opcionais[0].precoAdicional, 2.5);

const socketGrant = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.values.read'] } });
assert.equal(socketGrant.statusCode, 200, socketGrant.body);
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:financeiro`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:operacao`), 'grant moves existing socket into finance room');
const financialEvent = socketEvent('evento-caixa:financial-updated');
emitFinancialToEvento(app.io, event.id, { type: 'evento-caixa:financial-updated', data: { eventoId: event.id, trocoInicial: 734.21, esperado: { DINHEIRO: 752.58 } } });
assert.equal((await financialEvent).trocoInicial, 734.21, 'grant reaches the financial room on the established socket');
const socketRevoke = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(socketRevoke.statusCode, 200, socketRevoke.body);
assert.equal(socket.connected, true);
assert.equal(socket.id, socketIdBeforeRevoke, 'permission revocation does not replace the authenticated session');
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:operacao`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:financeiro`), 'revoke moves same socket back to operations room');
let postRevocationFinancialEvents = 0;
socket.on('evento-caixa:financial-updated', () => postRevocationFinancialEvents++);
emitFinancialToEvento(app.io, event.id, { type: 'evento-caixa:financial-updated', data: { eventoId: event.id, trocoInicial: 999.99 } });
const postRevocationKitchenEvent = socketEvent('operacao:pedido-atualizado', (payload) => payload.id === persistedSocketOrder.id);
const postRevocationStatus = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${persistedSocketOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'PRONTO' } });
assert.equal(postRevocationStatus.statusCode, 200, postRevocationStatus.body);
const receivedKitchenAfterRevoke = await postRevocationKitchenEvent;
await new Promise((resolve) => setTimeout(resolve, 120));
assert.equal(postRevocationFinancialEvents, 0, 'revoked socket receives no new financial-only event');
assert.equal(receivedKitchenAfterRevoke.itensComanda[0].nome, stockProduct.nome, 'allowed kitchen update survives revocation');
assert.equal(receivedKitchenAfterRevoke.itensComanda[0].opcionais[0].nome, socketOptional.nome);
assert.equal(receivedKitchenAfterRevoke.itensComanda[0].precoUnit, undefined);
const foreignSocket = connectSocket(localAddress, { extraHeaders: { cookie: foreignOwnerCookie }, transports: ['websocket'], reconnection: false });
await connect(foreignSocket);
foreignSocket.emit('join:cervejaria', company.id);
await waitFor(() => !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:financeiro`)
  && !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:operacao`), 'foreign tenant denial');
let foreignTenantEvents = 0;
foreignSocket.on('operacao:comanda-atualizada', () => foreignTenantEvents++);
emitToCervejaria(app.io, company.id, { type: 'operacao:comanda-atualizada', data: { comandaId: launchedSocketCommandId } });
await new Promise((resolve) => setTimeout(resolve, 120));
assert.equal(foreignTenantEvents, 0, 'company room remains isolated across tenants');

// With activation disabled, staff and ADMIN join the legacy rooms used by
// emitScoped; leave:evento removes that exact legacy event subscription.
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '0';
const legacySocket = connectSocket(localAddress, { extraHeaders: { cookie: staffCookie }, transports: ['websocket'], reconnection: false });
await connect(legacySocket);
legacySocket.emit('join:evento', event.id);
legacySocket.emit('join:cervejaria', company.id);
await waitFor(() => {
  const serverSocket = app.io.sockets.sockets.get(legacySocket.id);
  return serverSocket?.rooms.has(`evento:${event.id}`) && serverSocket?.rooms.has(`cervejaria:${company.id}`)
    && serverSocket?.data.eventoSubscriptions?.has(event.id) && serverSocket?.data.tenantSubscriptions?.has(company.id);
}, 'flag-off legacy event and company room joins');
await waitFor(() => !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}`), 'foreign tenant is not in the legacy company room');
let foreignLegacyEvents = 0;
foreignSocket.on('comanda:updated', () => foreignLegacyEvents++);
emitToCervejaria(app.io, company.id, { type: 'comanda:updated', data: { id: 'flag-off-company-isolation' } });
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(foreignLegacyEvents, 0, 'legacy company room remains isolated across tenants when activation is disabled');
let legacyDeliveryCount = 0;
legacySocket.on('evento:updated', () => legacyDeliveryCount++);
const legacyEventDelivery = socketEventFor(legacySocket, 'evento:updated');
emitToEvento(app.io, event.id, { type: 'evento:updated', data: { id: event.id } });
await legacyEventDelivery;
legacySocket.emit('leave:evento', event.id);
await waitFor(() => !app.io.sockets.sockets.get(legacySocket.id)?.rooms.has(`evento:${event.id}`)
  && !app.io.sockets.sockets.get(legacySocket.id)?.data.eventoSubscriptions?.has(event.id), 'flag-off leave:evento');
emitToEvento(app.io, event.id, { type: 'evento:updated', data: { id: event.id } });
const legacyCompanyDelivery = socketEventFor(legacySocket, 'comanda:updated');
let legacyCompanyDeliveryCount = 0;
legacySocket.on('comanda:updated', () => legacyCompanyDeliveryCount++);
emitToCervejaria(app.io, company.id, { type: 'comanda:updated', data: { id: 'legacy-company-event' } });
await legacyCompanyDelivery;
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(legacyDeliveryCount, 1, 'leave:evento stops only the event subscription while company subscription remains');
assert.equal(legacyCompanyDeliveryCount, 1, 'flag-off company emitter delivers exactly once to its legacy room');
const admin = await prisma.usuario.create({ data: { nome: 'QA Admin', email: `admin-${suffix}@example.invalid`, senhaHash: ownerHash, papel: 'ADMIN' } });
const adminCookie = await login(admin.email, ownerPassword);
const adminSocket = connectSocket(localAddress, { extraHeaders: { cookie: adminCookie }, transports: ['websocket'], reconnection: false });
await connect(adminSocket);
adminSocket.emit('join:cervejaria', company.id);
await waitFor(() => app.io.sockets.sockets.get(adminSocket.id)?.rooms.has(`cervejaria:${company.id}`), 'flag-off ADMIN legacy company room');
adminSocket.emit('join:evento', event.id);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(app.io.sockets.sockets.get(adminSocket.id)?.rooms.has(`evento:${event.id}`), false, 'ADMIN keeps legacy no-op join:evento behavior');
let adminCompanyEvents = 0;
adminSocket.on('comanda:updated', () => adminCompanyEvents++);
emitToCervejaria(app.io, company.id, { type: 'comanda:updated', data: { id: 'admin-legacy-company' } });
await socketEventFor(adminSocket, 'comanda:updated');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(adminCompanyEvents, 1);
socket.disconnect();
financeSocket.disconnect();
foreignSocket.disconnect();
legacySocket.disconnect();
adminSocket.disconnect();
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '1';

// The API response exposes the persisted list, including an explicit empty list.
const listed = await app.inject({ method: 'GET', url: '/api/usuarios', headers: authHeaders(ownerCookie) });
assert.equal(listed.statusCode, 200, listed.body);
assert.deepEqual(JSON.parse(listed.body).find((user) => user.id === staff.id).permissoesOperacao, []);

await app.close();
await prisma.$disconnect();

// Rehearse data preservation by removing only this candidate from the disposable
// schema history, inserting pre-migration employees, then deploying it again.
const { prisma: sharedPrisma } = await import('../src/lib/prisma.ts');
await sharedPrisma.$disconnect();
const dbBeforeMigration = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
await dbBeforeMigration.$executeRawUnsafe('ALTER TABLE public."Usuario" DROP COLUMN IF EXISTS "permissoesOperacao"');
await dbBeforeMigration.$executeRawUnsafe('DELETE FROM public."_prisma_migrations" WHERE migration_name = $1', '20261007220000_individual_operational_permissions');
const legacyGrantedId = `legacy-granted-${suffix}`;
const legacyDeniedId = `legacy-denied-${suffix}`;
for (const [id, email, canDiscount] of [
  [legacyGrantedId, `legacy-granted-${suffix}@example.invalid`, true],
  [legacyDeniedId, `legacy-denied-${suffix}@example.invalid`, false],
]) {
  await dbBeforeMigration.$executeRawUnsafe(
    'INSERT INTO public."Usuario" ("id","nome","email","senhaHash","papel","podeDarDescontoOperacao","cervejariaId","passwordChangedAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::public."UserRole",$6,$7,NOW(),NOW(),NOW())',
    id, 'Pre-migration attendant', email, 'not-used-in-qa', 'ATENDENTE', canDiscount, company.id,
  );
}
await dbBeforeMigration.$disconnect();
  run(['migrate', 'deploy', `--schema=${process.env.PDV_QA_SCHEMA_PATH}`]);
const dbAfterMigration = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const legacyGrantedPermissions = (await dbAfterMigration.usuario.findUniqueOrThrow({ where: { id: legacyGrantedId }, select: { permissoesOperacao: true } })).permissoesOperacao;
const legacyDeniedPermissions = (await dbAfterMigration.usuario.findUniqueOrThrow({ where: { id: legacyDeniedId }, select: { permissoesOperacao: true } })).permissoesOperacao;
const { usuarioPode } = await import('../src/lib/operacao/permissoes.ts');
assert.equal(legacyGrantedPermissions.includes('discount.apply'), true, 'legacy true discount setting preserves discount access');
assert.equal(legacyDeniedPermissions.includes('discount.apply'), false, 'legacy false discount setting does not gain discount access');
assert.equal(legacyGrantedPermissions.includes('command.item.cancel'), true, 'attendant retains legacy item removal access');
assert.equal(legacyDeniedPermissions.includes('command.item.cancel'), true, 'discount flag does not change existing item removal access');
assert.equal(legacyDeniedPermissions.includes('command.cancel'), false, 'migration does not grant full command cancellation');
assert.equal(legacyGrantedPermissions.includes('command.cancel'), false, 'discount true does not grant full command cancellation');
assert.equal(legacyDeniedPermissions.includes('cash.open'), true);
assert.equal(await usuarioPode({ sub: legacyGrantedId, cervejariaId: company.id, papel: 'ATENDENTE' }, 'discount.apply'), true, 'legacy discount=true preserves effective route authorization');
assert.equal(await usuarioPode({ sub: legacyDeniedId, cervejariaId: company.id, papel: 'ATENDENTE' }, 'discount.apply'), false, 'legacy discount=false remains denied');
assert.equal(await usuarioPode({ sub: legacyDeniedId, cervejariaId: company.id, papel: 'ATENDENTE' }, 'command.item.cancel'), true, 'attendant can still remove items through old authority');
assert.equal(await usuarioPode({ sub: legacyDeniedId, cervejariaId: company.id, papel: 'ATENDENTE' }, 'command.cancel'), false, 'attendant is not promoted to integral cancellation');
const newEmployee = await dbAfterMigration.usuario.create({ data: { nome: 'New QA attendant', email: `new-${suffix}@example.invalid`, senhaHash: 'not-used-in-qa', papel: 'ATENDENTE', cervejariaId: company.id }, select: { permissoesOperacao: true } });
assert.deepEqual(newEmployee.permissoesOperacao, [], 'new employees receive no permission by default');
await dbAfterMigration.$executeRawUnsafe('ALTER TABLE public."Usuario" DROP COLUMN IF EXISTS "permissoesOperacao"');
await dbAfterMigration.$disconnect();

// Compatibility probe against a pre-column schema: normal auth, identity and
// legacy user listing must not select the additive column when activation is off.
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '0';
const [{ buildApp: buildLegacyApp }, { PrismaClient: Client }] = await Promise.all([import('../src/app.ts'), import('@prisma/client')]);
const legacyApp = await buildLegacyApp();
const legacyLogin = await legacyApp.inject({ method: 'POST', url: '/api/auth/login', payload: { email: owner.email, senha: ownerPassword } });
assert.equal(legacyLogin.statusCode, 200, legacyLogin.body);
const legacyCookie = cookieFor(legacyLogin);
assert.equal((await legacyApp.inject({ method: 'GET', url: '/api/auth/me', headers: authHeaders(legacyCookie) })).statusCode, 200);
assert.equal((await legacyApp.inject({ method: 'GET', url: '/api/usuarios', headers: authHeaders(legacyCookie) })).statusCode, 200);
const legacyEventCash = await legacyApp.inject({ method: 'GET', url: `/api/eventos/${event.id}/caixa`, headers: authHeaders(staffCookie) });
assert.equal(legacyEventCash.statusCode, 200, legacyEventCash.body);
assert.equal(legacyEventCash.body.includes('734.21'), true, 'disabled permission mode retains the full event cash response');
assert.equal(JSON.parse(legacyEventCash.body).caixa.valoresRestritos, undefined);
const legacyEventMovement = await legacyApp.inject({ method: 'POST', url: `/api/eventos/${event.id}/caixa/movimentos`, headers: authHeaders(staffCookie), payload: { tipo: 'SUPRIMENTO', valor: 3.21 } });
assert.equal(legacyEventMovement.statusCode, 200, legacyEventMovement.body);
assert.equal(legacyEventMovement.body.includes('3.21'), true, 'disabled permission mode preserves legacy event cash writes and response');
await legacyApp.close();
await new Client({ datasources: { db: { url: databaseUrl } } }).$disconnect();
await sharedPrisma.$disconnect();
await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
console.log('PDV_INDIVIDUAL_PERMISSIONS_QA=PASS; auth/revoke/tenant/self-edit/unknown/no-write/pre-column checks completed on disposable PostgreSQL');
process.exit(0);
