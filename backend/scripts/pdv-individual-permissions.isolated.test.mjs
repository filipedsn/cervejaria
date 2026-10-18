import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { access, rm, writeFile } from 'node:fs/promises';
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
const { diaOperacional } = await import('../src/lib/operacao/venda.ts');
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
await prisma.cervejaria.update({ where: { id: otherCompany.id }, data: { usaCardapio: true } });
await prisma.configuracaoOperacional.create({ data: { cervejariaId: otherCompany.id, plannedOperationsEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, setupCompletedAt: new Date() } });
const owner = await prisma.usuario.create({ data: { nome: 'QA Owner', email: `owner-${suffix}@example.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: company.id } });
const staff = await prisma.usuario.create({ data: { nome: 'QA Attendant', email: `staff-${suffix}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: company.id } });
const staffTwo = await prisma.usuario.create({ data: { nome: 'QA Attendant Two', email: `staff-two-${suffix}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: company.id } });
const eventMenuStaff = await prisma.usuario.create({ data: { nome: 'QA Event Menu Attendant', email: `event-menu-staff-${suffix}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: otherCompany.id } });
const otherOwner = await prisma.usuario.create({ data: { nome: 'Other Owner', email: `other-${suffix}@example.invalid`, senhaHash: otherOwnerHash, papel: 'DONO', cervejariaId: otherCompany.id } });
await prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, exclusivo: true } });
await prisma.configuracaoOperacional.create({ data: { cervejariaId: company.id, plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, setupCompletedAt: new Date() } });
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
const staffTwoCookie = await login(staffTwo.email, attendantPassword);
const eventMenuStaffCookie = await login(eventMenuStaff.email, attendantPassword);
const foreignOwnerCookie = await login(otherOwner.email, otherOwnerPassword);
const authHeaders = (cookie) => ({ cookie });
const trailer = await prisma.trailer.create({ data: { nome: `QA trailer ${suffix}`, cervejariaId: company.id } });
const foreignTrailer = await prisma.trailer.create({ data: { nome: `Foreign QA trailer ${suffix}`, cervejariaId: otherCompany.id } });
const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: otherCompany.id, nome: 'Foreign point' } });
const event = await prisma.evento.create({ data: { nome: `Event cash QA ${suffix}`, local: 'QA', cervejariaId: company.id, trailerId: trailer.id } });
const eventForPermissionGrants = await prisma.evento.create({ data: { nome: `Event permission QA ${suffix}`, local: 'QA', cervejariaId: company.id, trailerId: trailer.id } });
const foreignEvent = await prisma.evento.create({ data: { nome: `Foreign event QA ${suffix}`, local: 'QA', data: new Date(), cervejariaId: otherCompany.id, trailerId: foreignTrailer.id } });
await prisma.configuracaoOperacional.update({ where: { cervejariaId: otherCompany.id }, data: { tapsEnabled: true } });
const foreignTapChope = await prisma.produto.create({ data: { nome: `Event tap chope QA ${suffix}`, tipo: 'BEBIDA', formato: 'CHOPE', cervejariaId: otherCompany.id } });
const eventPermissionTap = await prisma.tap.create({ data: { numero: 9902, nome: 'RBAC event tap', cervejariaId: otherCompany.id, trailerId: foreignTrailer.id } });
const foreignClient = await prisma.cliente.create({ data: { nome: 'Foreign permission QA', telefone: `119876${Date.now().toString().slice(-5)}`, cervejariaId: otherCompany.id } });
const foreignProduct = await prisma.produto.create({ data: { nome: `Foreign product QA ${suffix}`, tipo: 'COMIDA', cervejariaId: otherCompany.id } });
const foreignCommand = await prisma.comanda.create({ data: { eventoId: foreignEvent.id, clienteId: foreignClient.id, status: 'ABERTA', tipo: 'COMANDA', total: 0 } });
const foreignOrder = await prisma.pedidoOperacao.create({ data: { cervejariaId: otherCompany.id, comandaId: foreignCommand.id, pontoVendaId: foreignPoint.id, numero: 880001, diaOperacional: new Date('2026-10-07T00:00:00.000Z'), criadoPorId: otherOwner.id } });
const tapChope = await prisma.produto.create({ data: { nome: `Tap permission QA ${suffix}`, tipo: 'BEBIDA', formato: 'CHOPE', cervejariaId: company.id } });
const permissionTap = await prisma.tap.create({ data: { numero: 9001, nome: 'Permission QA tap', cervejariaId: company.id, trailerId: trailer.id } });
const moduleFinancePhoto = async () => ({
  eventSessions: await prisma.sessaoCaixaEvento.count(),
  eventMovements: await prisma.movimentoCaixaEvento.count(),
  operationalSessions: await prisma.sessaoCaixaOperacao.count(),
  payments: await prisma.pagamento.count(),
});
const moduleFinanceBeforeTapAndAgenda = await moduleFinancePhoto();
const tapMountCountBeforeDenial = await prisma.tapMontagem.count({ where: { eventoId: eventForPermissionGrants.id, tapId: permissionTap.id } });
const tapMountDenied = await app.inject({ method: 'PUT', url: `/api/eventos/${eventForPermissionGrants.id}/taps/${permissionTap.id}/chope`, headers: authHeaders(staffCookie), payload: { produtoId: tapChope.id } });
assert.equal(tapMountDenied.statusCode, 403, tapMountDenied.body);
assert.equal(await prisma.tapMontagem.count({ where: { eventoId: eventForPermissionGrants.id, tapId: permissionTap.id } }), tapMountCountBeforeDenial, 'tap denial leaves mounting history unchanged');
const grantTapOperation = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['taps.operate'] } });
assert.equal(grantTapOperation.statusCode, 200, grantTapOperation.body);
const tapMountAllowed = await app.inject({ method: 'PUT', url: `/api/eventos/${eventForPermissionGrants.id}/taps/${permissionTap.id}/chope`, headers: authHeaders(staffCookie), payload: { produtoId: tapChope.id } });
assert.equal(tapMountAllowed.statusCode, 200, tapMountAllowed.body);
assert.equal(await prisma.tapMontagem.count({ where: { eventoId: eventForPermissionGrants.id, tapId: permissionTap.id, encerradoEm: null, produtoId: tapChope.id } }), 1, 'taps.operate persists the active event mounting');
const crossTenantTapMount = await app.inject({ method: 'PUT', url: `/api/eventos/${foreignEvent.id}/taps/${permissionTap.id}/chope`, headers: authHeaders(staffCookie), payload: { produtoId: tapChope.id } });
assert.equal(crossTenantTapMount.statusCode, 404, crossTenantTapMount.body);
const clearTapPermission = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(clearTapPermission.statusCode, 200, clearTapPermission.body);
await prisma.configuracaoPontoVenda.create({ data: {
  cervejariaId: company.id, pontoVendaId: point.id, tapsEnabled: false, inventoryEnabled: true, kitchenEnabled: true,
  kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false,
  whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
}});
process.env.PDV_CANONICAL_CONFIG_QA = '1';
const canonicalProductResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos', headers: authHeaders(ownerCookie), payload: {
  nome: `Canonical product ${suffix}`, categoria: 'Comidas', tipo: 'COMIDA', precoUnit: 9.5, exigePreparo: false, controlaEstoque: false,
} });
assert.equal(canonicalProductResponse.statusCode, 201, canonicalProductResponse.body);
const canonicalProduct = JSON.parse(canonicalProductResponse.body);
assert.equal(canonicalProduct.pontoVendaId, point.id, 'operational product derives the validated canonical PDV');
assert.equal(canonicalProduct.cervejariaId, company.id);
const canonicalOptionalGenericResponse = await app.inject({ method: 'POST', url: '/api/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Canonical generic optional ${suffix}`, preco: 1.2, pontoVendaId: foreignPoint.id,
} });
assert.equal(canonicalOptionalGenericResponse.statusCode, 201, canonicalOptionalGenericResponse.body);
const canonicalOptionalGeneric = JSON.parse(canonicalOptionalGenericResponse.body);
assert.equal(canonicalOptionalGeneric.cervejariaId, company.id);
assert.equal(canonicalOptionalGeneric.pontoVendaId, point.id, 'generic optional ignores PDV payload and derives canonical scope');
const canonicalOptionalOperationalResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Canonical operational optional ${suffix}`, preco: 0.8,
} });
assert.equal(canonicalOptionalOperationalResponse.statusCode, 201, canonicalOptionalOperationalResponse.body);
const canonicalOptionalOperational = JSON.parse(canonicalOptionalOperationalResponse.body);
assert.equal(canonicalOptionalOperational.pontoVendaId, point.id, 'operational optional uses the validated effective PDV');
assert.equal(canonicalOptionalOperational.cervejariaId, company.id);
const canonicalLink = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${canonicalProduct.id}/opcionais`, headers: authHeaders(ownerCookie), payload: {
  opcionalIds: [canonicalOptionalGeneric.id, canonicalOptionalOperational.id],
} });
assert.equal(canonicalLink.statusCode, 200, canonicalLink.body);
const canonicalLinkRead = await app.inject({ method: 'GET', url: `/api/operacao/produtos/${canonicalProduct.id}/opcionais`, headers: authHeaders(ownerCookie) });
assert.equal(canonicalLinkRead.statusCode, 200, canonicalLinkRead.body);
const canonicalLinks = JSON.parse(canonicalLinkRead.body);
assert.deepEqual(canonicalLinks.map(({ opcional }) => ({ companyId: opcional.cervejariaId, pointId: opcional.pontoVendaId })), [
  { companyId: company.id, pointId: point.id }, { companyId: company.id, pointId: point.id },
]);
const agendaPayload = { nome: `Agenda permission QA ${suffix}`, diaSemana: 3, horaInicio: '18:00', horaFim: '22:00' };
const agendaDeniedBefore = await prisma.agendaOperacional.count({ where: { cervejariaId: company.id, pontoVendaId: point.id } });
const agendaCreateDenied = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendas', headers: authHeaders(staffCookie), payload: agendaPayload });
assert.equal(agendaCreateDenied.statusCode, 403, agendaCreateDenied.body);
assert.equal(await prisma.agendaOperacional.count({ where: { cervejariaId: company.id, pontoVendaId: point.id } }), agendaDeniedBefore, 'agenda denial creates no schedule');
const grantAgendaManage = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['agenda.manage'] } });
assert.equal(grantAgendaManage.statusCode, 200, grantAgendaManage.body);
const agendaCreateAllowed = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendas', headers: authHeaders(staffCookie), payload: agendaPayload });
assert.equal(agendaCreateAllowed.statusCode, 201, agendaCreateAllowed.body);
const savedAgenda = await prisma.agendaOperacional.findFirstOrThrow({ where: { cervejariaId: company.id, pontoVendaId: point.id, nome: agendaPayload.nome } });
assert.equal(savedAgenda.diaSemana, agendaPayload.diaSemana, 'agenda.manage persists the authorized schedule');
const foreignAgenda = await prisma.agendaOperacional.create({ data: { cervejariaId: otherCompany.id, pontoVendaId: foreignPoint.id, nome: `Foreign agenda ${suffix}`, diaSemana: 3 } });
const crossTenantAgenda = await app.inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${foreignAgenda.id}`, headers: authHeaders(staffCookie), payload: { ativa: false } });
assert.equal(crossTenantAgenda.statusCode, 404, crossTenantAgenda.body);
const revokeAgendaManage = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeAgendaManage.statusCode, 200, revokeAgendaManage.body);
const agendaOccurrencesDeniedAfterRevoke = await app.inject({ method: 'POST', url: '/api/operacao/agenda/ocorrencias', headers: authHeaders(staffCookie), payload: { nome: 'Denied occurrence', data: '2026-10-08' } });
assert.equal(agendaOccurrencesDeniedAfterRevoke.statusCode, 403, agendaOccurrencesDeniedAfterRevoke.body);
assert.deepEqual(await moduleFinancePhoto(), moduleFinanceBeforeTapAndAgenda, 'TAP and agenda operations do not mutate cash sessions, movements, or payments');
process.env.PDV_CANONICAL_CONFIG_QA = '0';
const legacyOptionalGenericResponse = await app.inject({ method: 'POST', url: '/api/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Legacy generic optional ${suffix}`, preco: 0.5,
} });
assert.equal(legacyOptionalGenericResponse.statusCode, 201, legacyOptionalGenericResponse.body);
assert.equal(JSON.parse(legacyOptionalGenericResponse.body).pontoVendaId, null, 'legacy generic optional remains global when canonical activation is off');
const legacyOptionalOperationalResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Legacy operational optional ${suffix}`, preco: 0.6,
} });
assert.equal(legacyOptionalOperationalResponse.statusCode, 201, legacyOptionalOperationalResponse.body);
assert.equal(JSON.parse(legacyOptionalOperationalResponse.body).pontoVendaId, null, 'legacy operational optional remains global when canonical activation is off');
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

const eventDashboardDenied = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/dashboard`, headers: authHeaders(staffCookie) });
assert.equal(eventDashboardDenied.statusCode, 403, eventDashboardDenied.body);
const grantEventDashboard = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['event.dashboard.read'] } });
assert.equal(grantEventDashboard.statusCode, 200, grantEventDashboard.body);
const eventDashboardAllowed = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/dashboard`, headers: authHeaders(staffCookie) });
assert.equal(eventDashboardAllowed.statusCode, 200, eventDashboardAllowed.body);
const revokeEventDashboard = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeEventDashboard.statusCode, 200, revokeEventDashboard.body);
assert.equal((await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/dashboard`, headers: authHeaders(staffCookie) })).statusCode, 403);

const reportsDenied = await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/transacoes`, headers: authHeaders(staffCookie) });
assert.equal(reportsDenied.statusCode, 403, reportsDenied.body);
const grantReports = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['reports.read'] } });
assert.equal(grantReports.statusCode, 200, grantReports.body);
assert.equal((await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/transacoes`, headers: authHeaders(staffCookie) })).statusCode, 200);
const revokeReports = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeReports.statusCode, 200, revokeReports.body);
assert.equal((await app.inject({ method: 'GET', url: `/api/eventos/${event.id}/transacoes`, headers: authHeaders(staffCookie) })).statusCode, 403);

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
const permissionOperationalDay = diaOperacional();
const occurrence = await prisma.ocorrenciaOperacional.create({
  data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Occurrence QA ${suffix}`, data: permissionOperationalDay },
});
const cashSession = await prisma.sessaoCaixaOperacao.create({
  data: {
    cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: permissionOperationalDay,
    status: 'ABERTO', trocoInicial: '123.45', abertoPorId: staff.id, ocorrenciaId: occurrence.id,
  },
  select: { id: true, diaOperacional: true, ocorrenciaId: true },
});
const restrictedCash = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(restrictedCash.statusCode, 200, restrictedCash.body);
const restrictedCashBody = JSON.parse(restrictedCash.body);
assert.equal(restrictedCashBody.sessao.id, cashSession.id);
assert.equal(restrictedCashBody.sessao.ocorrenciaId, occurrence.id);
assert.equal(restrictedCashBody.sessao.ocorrencia.id, occurrence.id);
assert.equal(restrictedCashBody.sessao.ocorrencia.nome, occurrence.nome);
assert.equal(restrictedCashBody.sessao.diaOperacional, permissionOperationalDay.toISOString().slice(0, 10));
assert.notEqual(restrictedCashBody.sessao.ocorrencia.nome, 'Sem ocorrência');
assert.equal(restrictedCashBody.valoresRestritos, true);
assert.equal(Object.hasOwn(restrictedCashBody.sessao, 'gaveta'), false, 'sanitized cash contract omits the drawer object rather than zeroing its values');
assert.equal(Object.hasOwn(restrictedCashBody.sessao, 'esperado'), false, 'sanitized cash contract omits expected payment totals');
assert.equal(Object.hasOwn(restrictedCashBody.sessao, 'movimentos'), false, 'sanitized cash contract omits movement details');
for (const restrictedField of ['trocoInicial', 'totalVendas', 'movimentos', '123.45']) {
assert.equal(restrictedCash.body.includes(restrictedField), false, `restricted cash response leaked ${restrictedField}`);
}
const grantCashValueRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.open', 'cash.values.read'] } });
assert.equal(grantCashValueRead.statusCode, 200, grantCashValueRead.body);
const fullCashRead = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(fullCashRead.statusCode, 200, fullCashRead.body);
const fullCashReadBody = JSON.parse(fullCashRead.body);
assert.equal(fullCashReadBody.valoresRestritos, undefined);
assert.equal(Number(fullCashReadBody.sessao.gaveta.esperadoDinheiro), 123.45, 'cash.values.read returns the actual drawer value');
const revokeCashValueRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.open'] } });
assert.equal(revokeCashValueRead.statusCode, 200, revokeCashValueRead.body);
const revokedCashRead = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(revokedCashRead.statusCode, 200, revokedCashRead.body);
assert.equal(JSON.parse(revokedCashRead.body).valoresRestritos, true, 'same authenticated session receives sanitized cash data after revocation');
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
const manuallyAdjustedProduct = await prisma.produto.create({ data: { nome: `Manual adjustment QA ${suffix}`, tipo: 'COMIDA', controlaEstoque: true, cervejariaId: company.id, pontoVendaId: point.id } });
const manuallyAdjustedBalance = await prisma.inventoryBalance.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: manuallyAdjustedProduct.id, quantidade: '4.000' } });
const manualInventoryPhoto = async () => ({
  balance: await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: manuallyAdjustedBalance.id } }),
  movements: await prisma.inventoryMovement.findMany({ where: { cervejariaId: company.id, produtoId: manuallyAdjustedProduct.id }, orderBy: { createdAt: 'asc' } }),
});
const manualInventoryBeforeDenial = await manualInventoryPhoto();
const manualInventoryReadDenied = await app.inject({ method: 'GET', url: `/api/operacao/estoque?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(manualInventoryReadDenied.statusCode, 403, manualInventoryReadDenied.body);
const grantInventoryRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['inventory.read'] } });
assert.equal(grantInventoryRead.statusCode, 200, grantInventoryRead.body);
assert.equal((await app.inject({ method: 'GET', url: `/api/operacao/estoque?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) })).statusCode, 200);
const crossTenantInventoryRead = await app.inject({ method: 'GET', url: `/api/operacao/estoque?pontoVendaId=${foreignPoint.id}`, headers: authHeaders(staffCookie) });
assert.equal(crossTenantInventoryRead.statusCode, 404, crossTenantInventoryRead.body);
const manualInventoryWriteDenied = await app.inject({ method: 'POST', url: '/api/operacao/estoque/entrada', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, produtoId: manuallyAdjustedProduct.id, quantidade: 1 } });
assert.equal(manualInventoryWriteDenied.statusCode, 403, manualInventoryWriteDenied.body);
assert.deepEqual(await manualInventoryPhoto(), manualInventoryBeforeDenial, 'manual inventory denials preserve stock balance and movement ledger');
const grantInventoryAdjust = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['inventory.adjust'] } });
assert.equal(grantInventoryAdjust.statusCode, 200, grantInventoryAdjust.body);
const manualInventoryWriteAllowed = await app.inject({ method: 'POST', url: '/api/operacao/estoque/entrada', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, produtoId: manuallyAdjustedProduct.id, quantidade: 1, observacao: 'QA permission grant' } });
assert.equal(manualInventoryWriteAllowed.statusCode, 201, manualInventoryWriteAllowed.body);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: manuallyAdjustedBalance.id } })).quantidade), 5);
assert.equal(await prisma.inventoryMovement.count({ where: { cervejariaId: company.id, produtoId: manuallyAdjustedProduct.id, tipo: 'ENTRADA' } }), 1);
const operationalCommand = await prisma.comanda.create({
  data: { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id, diaOperacional: cashSession.diaOperacional, tipo: 'MESA', identificador: `QA-${suffix}`, status: 'ABERTA', abertaPorId: owner.id, total: '30.00' },
});
const commandReadDeniedPhoto = await prisma.comanda.findMany({ where: { pontoVendaId: point.id }, select: { id: true, status: true }, orderBy: { id: 'asc' } });
const commandReadDenied = await app.inject({ method: 'GET', url: '/api/operacao/comandas', headers: authHeaders(staffCookie) });
assert.equal(commandReadDenied.statusCode, 403, commandReadDenied.body);
assert.deepEqual(await prisma.comanda.findMany({ where: { pontoVendaId: point.id }, select: { id: true, status: true }, orderBy: { id: 'asc' } }), commandReadDeniedPhoto);
const grantCommandOperateRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.read'] } });
assert.equal(grantCommandOperateRead.statusCode, 200, grantCommandOperateRead.body);
assert.equal((await app.inject({ method: 'GET', url: '/api/operacao/comandas', headers: authHeaders(staffCookie) })).statusCode, 200);
assert.equal((await app.inject({ method: 'GET', url: `/api/operacao/comandas/${operationalCommand.id}`, headers: authHeaders(staffCookie) })).statusCode, 200);
const crossTenantCommandRead = await app.inject({ method: 'GET', url: `/api/operacao/comandas/${foreignCommand.id}`, headers: authHeaders(staffCookie) });
assert.equal(crossTenantCommandRead.statusCode, 404, crossTenantCommandRead.body);
const readOnlyOpenPhoto = await prisma.comanda.count({ where: { pontoVendaId: point.id } });
const readOnlyOpenDenied = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, tipo: 'MESA', identificador: `ReadOnly-${suffix}`, itens: [] } });
assert.equal(readOnlyOpenDenied.statusCode, 403, readOnlyOpenDenied.body);
assert.equal(await prisma.comanda.count({ where: { pontoVendaId: point.id } }), readOnlyOpenPhoto, 'command.read does not permit opening a command');
const grantCommandOperateOnly = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.operate'] } });
assert.equal(grantCommandOperateOnly.statusCode, 200, grantCommandOperateOnly.body);
const openedByOperator = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, tipo: 'MESA', identificador: `Operate-${suffix}`, itens: [] } });
assert.equal(openedByOperator.statusCode, 201, openedByOperator.body);
const openedByOperatorRecord = await prisma.comanda.findUniqueOrThrow({ where: { id: JSON.parse(openedByOperator.body).id } });
assert.equal(openedByOperatorRecord.abertaPorId, staff.id);
assert.equal((await app.inject({ method: 'GET', url: '/api/operacao/comandas', headers: authHeaders(staffCookie) })).statusCode, 403, 'command.operate alone does not grant command.read');
const revokeCommandOperateRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeCommandOperateRead.statusCode, 200, revokeCommandOperateRead.body);
assert.equal((await app.inject({ method: 'GET', url: '/api/operacao/comandas', headers: authHeaders(staffCookie) })).statusCode, 403);
const grantCommandCancelForFixture = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.cancel'] } });
assert.equal(grantCommandCancelForFixture.statusCode, 200, grantCommandCancelForFixture.body);
const cancelOpenedByOperator = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${openedByOperatorRecord.id}/cancelar`, headers: authHeaders(staffCookie), payload: {} });
assert.equal(cancelOpenedByOperator.statusCode, 200, cancelOpenedByOperator.body);
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: openedByOperatorRecord.id } })).status, 'CANCELADA');
const operationalOrder = await prisma.pedidoOperacao.create({
  data: { cervejariaId: company.id, comandaId: operationalCommand.id, pontoVendaId: point.id, numero: 810001, diaOperacional: cashSession.diaOperacional, criadoPorId: owner.id, status: 'RECEBIDO' },
});
const operationalItem = await prisma.itemComanda.create({
  data: { comandaId: operationalCommand.id, produtoId: stockProduct.id, pedidoCozinhaId: operationalOrder.id, nome: stockProduct.nome, quantidade: 3, precoUnit: '10.00', exigePreparo: false },
});
const discountPhoto = async () => prisma.comanda.findUniqueOrThrow({ where: { id: operationalCommand.id }, select: { desconto: true, total: true } });
const discountBeforeDenial = await discountPhoto();
const discountDenied = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/desconto`, headers: authHeaders(staffCookie), payload: { desconto: 5 } });
assert.equal(discountDenied.statusCode, 403, discountDenied.body);
assert.deepEqual(await discountPhoto(), discountBeforeDenial, 'missing discount.apply preserves the command financial fields');
const grantDiscount = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['discount.apply'] } });
assert.equal(grantDiscount.statusCode, 200, grantDiscount.body);
const discountAllowed = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/desconto`, headers: authHeaders(staffCookie), payload: { desconto: 5 } });
assert.equal(discountAllowed.statusCode, 200, discountAllowed.body);
assert.equal(Number((await discountPhoto()).desconto), 5, 'discount.apply persists the requested business discount');
const discountAfterGrant = await discountPhoto();
const revokeDiscount = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeDiscount.statusCode, 200, revokeDiscount.body);
assert.equal((await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/desconto`, headers: authHeaders(staffCookie), payload: { desconto: 2 } })).statusCode, 403);
assert.deepEqual(await discountPhoto(), discountAfterGrant, 'revoked discount.apply blocks another update in the same session');
await prisma.comanda.update({ where: { id: operationalCommand.id }, data: { desconto: 0, total: '30.00' } });
const optionalSnapshot = await prisma.itemComandaOpcional.create({ data: { itemComandaId: operationalItem.id, nome: 'QA optional', precoAdicional: '1.25', quantidade: 2 } });
const kitchenReadDenied = await app.inject({ method: 'GET', url: '/api/operacao/cozinha', headers: authHeaders(staffCookie) });
assert.equal(kitchenReadDenied.statusCode, 403, kitchenReadDenied.body);
const grantKitchenRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.read'] } });
assert.equal(grantKitchenRead.statusCode, 200, grantKitchenRead.body);
assert.equal((await app.inject({ method: 'GET', url: '/api/operacao/cozinha', headers: authHeaders(staffCookie) })).statusCode, 200);
const kitchenReadOnlyDenied = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${operationalOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'EM_PREPARO' } });
assert.equal(kitchenReadOnlyDenied.statusCode, 403, kitchenReadOnlyDenied.body);
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: operationalOrder.id } })).status, 'RECEBIDO', 'kitchen.read alone cannot transition a queue item');
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
const grantCommandOperateForIncrease = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.operate'] } });
assert.equal(grantCommandOperateForIncrease.statusCode, 200, grantCommandOperateForIncrease.body);
const increasedQuantity = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${operationalCommand.id}/itens/${operationalItem.id}`, headers: authHeaders(staffCookie), payload: { quantidade: 3 } });
assert.equal(increasedQuantity.statusCode, 200, increasedQuantity.body, 'quantity increases remain permitted without item cancellation permission');
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: operationalItem.id } })).quantidade, 3);

// Authenticated sale, payment, kitchen cancellation/refund, stock reversal and
// debt settlement execute against the isolated PostgreSQL database.
await prisma.produto.update({ where: { id: stockProduct.id }, data: { pontoVendaId: point.id, exigePreparo: true } });
await prisma.preco.create({ data: { produtoId: stockProduct.id, volumeMl: 0, preco: '10.00' } });
const cardapio = await prisma.cardapio.create({ data: { nome: `QA menu ${suffix}`, cervejariaId: company.id, pontoVendaId: point.id } });
const eventMenuBefore = await prisma.eventoProduto.findMany({ where: { eventoId: eventForPermissionGrants.id }, orderBy: { produtoId: 'asc' } });
const eventMenuDenied = await app.inject({ method: 'PUT', url: `/api/eventos/${eventForPermissionGrants.id}/cardapio`, headers: authHeaders(staffCookie), payload: { produtoIds: [stockProduct.id] } });
assert.equal(eventMenuDenied.statusCode, 403, eventMenuDenied.body);
assert.deepEqual(await prisma.eventoProduto.findMany({ where: { eventoId: eventForPermissionGrants.id }, orderBy: { produtoId: 'asc' } }), eventMenuBefore, 'denied event-menu change preserves the selected products');
const grantEventMenu = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['event.menu.manage'] } });
assert.equal(grantEventMenu.statusCode, 200, grantEventMenu.body);
const eventMenuAllowed = await app.inject({ method: 'PUT', url: `/api/eventos/${eventForPermissionGrants.id}/cardapio`, headers: authHeaders(staffCookie), payload: { produtoIds: [stockProduct.id] } });
assert.equal(eventMenuAllowed.statusCode, 200, eventMenuAllowed.body);
assert.deepEqual((await prisma.eventoProduto.findMany({ where: { eventoId: eventForPermissionGrants.id }, select: { produtoId: true } })).map((row) => row.produtoId), [stockProduct.id], 'event.menu.manage persists the event-specific menu');
const eventMenuAfterGrant = await prisma.eventoProduto.findMany({ where: { eventoId: eventForPermissionGrants.id }, orderBy: { produtoId: 'asc' } });
const revokeEventMenu = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeEventMenu.statusCode, 200, revokeEventMenu.body);
assert.equal((await app.inject({ method: 'PUT', url: `/api/eventos/${eventForPermissionGrants.id}/cardapio`, headers: authHeaders(staffCookie), payload: { produtoIds: [] } })).statusCode, 403);
assert.deepEqual(await prisma.eventoProduto.findMany({ where: { eventoId: eventForPermissionGrants.id }, orderBy: { produtoId: 'asc' } }), eventMenuAfterGrant, 'revoked event.menu.manage leaves the selected products unchanged');
await prisma.cardapioProduto.create({ data: { cardapioId: cardapio.id, produtoId: stockProduct.id, cervejariaId: company.id, pontoVendaId: point.id, volumeMl: 0, precoUnit: '10.00' } });
await prisma.sessaoCaixaOperacao.update({ where: { id: cashSession.id }, data: { cardapioId: cardapio.id } });
await prisma.sessaoCaixaProdutoOperacao.create({ data: { sessaoCaixaId: cashSession.id, produtoId: stockProduct.id, volumeMl: 0, precoUnit: '10.00' } });
// This fixture represents a product already migrated into the canonical PDV.
// New optionals from both public catalog entry points must fit that scope.
process.env.PDV_CANONICAL_CONFIG_QA = '1';
const migratedGenericOptionalResponse = await app.inject({ method: 'POST', url: '/api/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Migrated product optional ${suffix}`, preco: 1.25,
} });
assert.equal(migratedGenericOptionalResponse.statusCode, 201, migratedGenericOptionalResponse.body);
const migratedGenericOptional = JSON.parse(migratedGenericOptionalResponse.body);
const migratedOperationalOptionalResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos/opcionais', headers: authHeaders(ownerCookie), payload: {
  nome: `Migrated product operational optional ${suffix}`, preco: 0.75,
} });
assert.equal(migratedOperationalOptionalResponse.statusCode, 201, migratedOperationalOptionalResponse.body);
const migratedOperationalOptional = JSON.parse(migratedOperationalOptionalResponse.body);
assert.equal(migratedGenericOptional.pontoVendaId, point.id);
assert.equal(migratedOperationalOptional.pontoVendaId, point.id);
const migratedProductLink = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${stockProduct.id}/opcionais`, headers: authHeaders(ownerCookie), payload: {
  opcionalIds: [migratedGenericOptional.id, migratedOperationalOptional.id],
} });
assert.equal(migratedProductLink.statusCode, 200, migratedProductLink.body);
const migratedProductLinksRead = await app.inject({ method: 'GET', url: `/api/operacao/produtos/${stockProduct.id}/opcionais`, headers: authHeaders(ownerCookie) });
assert.equal(migratedProductLinksRead.statusCode, 200, migratedProductLinksRead.body);
const migratedProductRead = await app.inject({ method: 'GET', url: `/api/produtos/${stockProduct.id}`, headers: authHeaders(ownerCookie) });
assert.equal(migratedProductRead.statusCode, 200, migratedProductRead.body);
const migratedProductFromApi = JSON.parse(migratedProductRead.body);
assert.equal(migratedProductFromApi.cervejariaId, company.id);
assert.equal(migratedProductFromApi.pontoVendaId, point.id);
assert.deepEqual(JSON.parse(migratedProductLinksRead.body).map(({ opcional }) => ({ companyId: opcional.cervejariaId, pointId: opcional.pontoVendaId })), [
  { companyId: company.id, pointId: point.id }, { companyId: company.id, pointId: point.id },
]);
process.env.PDV_CANONICAL_CONFIG_QA = '0';
const deliveredStockProduct = await prisma.produto.create({ data: { nome: `Delivered stock QA ${suffix}`, tipo: 'COMIDA', controlaEstoque: true, cervejariaId: company.id, pontoVendaId: point.id } });
const deliveredStockBalance = await prisma.inventoryBalance.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, produtoId: deliveredStockProduct.id, quantidade: '50.000' } });
const deliveredTestFixtures = [];
const createDeliveredFixture = async ({ quantity = 2, payment = false, stockDebit = false, status = 'ENTREGUE', controlsStock = true } = {}) => {
  const command = await prisma.comanda.create({ data: {
    origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id,
    diaOperacional: cashSession.diaOperacional, tipo: 'MESA', identificador: `Delivered-${randomBytes(3).toString('hex')}`,
    status: status === 'FECHADA' ? 'FECHADA' : 'ABERTA', abertaPorId: owner.id,
    total: (quantity * 10).toFixed(2), ...(status === 'FECHADA' ? { fechadaEm: new Date() } : {}),
  } });
  const order = await prisma.pedidoOperacao.create({ data: {
    cervejariaId: company.id, comandaId: command.id, pontoVendaId: point.id,
    numero: 850000 + Math.floor(Math.random() * 10000), diaOperacional: cashSession.diaOperacional,
    criadoPorId: owner.id, status: 'ENTREGUE',
  } });
  const product = controlsStock ? deliveredStockProduct : await prisma.produto.create({ data: {
    nome: `No-stock product ${randomBytes(3).toString('hex')}`, tipo: 'COMIDA', controlaEstoque: false, cervejariaId: company.id,
  } });
  const item = await prisma.itemComanda.create({ data: {
    comandaId: command.id, produtoId: product.id, pedidoCozinhaId: order.id,
    nome: product.nome, quantidade: quantity, precoUnit: '10.00', exigePreparo: true,
  } });
  if (stockDebit) {
    await prisma.inventoryBalance.update({ where: { id: deliveredStockBalance.id }, data: { quantidade: { decrement: quantity } } });
    await prisma.inventoryMovement.create({ data: {
      cervejariaId: company.id, pontoVendaId: point.id, produtoId: deliveredStockProduct.id,
      tipo: 'SAIDA_VENDA', quantidade: quantity, registradoPorId: owner.id, pedidoId: order.id,
    } });
  }
  if (payment) await prisma.pagamento.create({ data: { comandaId: command.id, forma: 'PIX', valor: '1.00', registradoPorId: owner.id } });
  const fixture = { command, order, item, product };
  deliveredTestFixtures.push(fixture);
  return fixture;
};
const deliveredBody = ({ fixture, quantity = 1, reason = 'Erro de lançamento confirmado', treatment = 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey = randomUUID(), expected = fixture.item.quantidade } = {}) => ({
  quantidade: quantity, quantidadeEsperada: expected, motivo: reason, tratamentoEstoque: treatment, idempotencyKey,
});
const deliveredCommonOnly = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.item.cancel'] } });
assert.equal(deliveredCommonOnly.statusCode, 200, deliveredCommonOnly.body);
const deniedDeliveredFixture = await createDeliveredFixture();
const deniedDeliveredPhoto = async () => ({
  item: await prisma.itemComanda.findUniqueOrThrow({ where: { id: deniedDeliveredFixture.item.id } }),
  command: await prisma.comanda.findUniqueOrThrow({ where: { id: deniedDeliveredFixture.command.id }, select: { total: true, status: true } }),
  audit: await prisma.itemComandaCancelamentoEntregue.count({ where: { itemComandaId: deniedDeliveredFixture.item.id } }),
});
const deniedDeliveredBefore = await deniedDeliveredPhoto();
const commonOnlyDelivered = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${deniedDeliveredFixture.command.id}/itens/${deniedDeliveredFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: deniedDeliveredFixture }) });
assert.equal(commonOnlyDelivered.statusCode, 403, commonOnlyDelivered.body);
assert.deepEqual(await deniedDeliveredPhoto(), deniedDeliveredBefore, 'common cancellation permission alone cannot change a delivered item');
const foreignDelivered = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${foreignCommand.id}/itens/not-an-item`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: deniedDeliveredFixture }) });
assert.equal(foreignDelivered.statusCode, 404, foreignDelivered.body, 'tenant scoping hides foreign commands');
const ownerDeliveredFixture = await createDeliveredFixture();
const ownerDelivered = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${ownerDeliveredFixture.command.id}/itens/${ownerDeliveredFixture.item.id}`, headers: authHeaders(ownerCookie), payload: deliveredBody({ fixture: ownerDeliveredFixture, quantity: 2 }) });
assert.equal(ownerDelivered.statusCode, 200, ownerDelivered.body);
assert.equal(ownerDelivered.json().total, 0, 'owner can cancel the full delivered item');
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: ownerDeliveredFixture.order.id } })).status, 'ENTREGUE', 'cancellation never returns the kitchen order to its queue');
const authorized = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.item.cancel', 'command.item.cancel.delivered'] } });
assert.equal(authorized.statusCode, 200, authorized.body);
const preparedFixture = await createDeliveredFixture();
const preparedKey = randomUUID();
const preparedBefore = Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } })).quantidade);
const preparedBody = deliveredBody({ fixture: preparedFixture, quantity: 1, treatment: 'PREPARADO_ENTREGUE_OU_PERDIDO', idempotencyKey: preparedKey });
const preparedCancel = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${preparedFixture.command.id}/itens/${preparedFixture.item.id}`, headers: authHeaders(staffCookie), payload: preparedBody });
assert.equal(preparedCancel.statusCode, 200, preparedCancel.body);
assert.equal(preparedCancel.json().total, 10);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } })).quantidade), preparedBefore, 'prepared/delivered product never returns to stock');
assert.equal(preparedCancel.json().pedidos[0].itens[0].quantidade, 1, 'partial cancellation preserves the remaining item row and its snapshot');
assert.equal(preparedCancel.json().pedidos[0].itens[0].cancelamentosEntregue[0].motivo, preparedBody.motivo, 'API includes the item-level cancellation result');
const preparedRetry = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${preparedFixture.command.id}/itens/${preparedFixture.item.id}`, headers: authHeaders(staffCookie), payload: preparedBody });
assert.equal(preparedRetry.statusCode, 200, preparedRetry.body);
assert.equal(preparedRetry.json().total, 10, 'same idempotency key does not apply the financial change twice');
const staleSecondSession = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${preparedFixture.command.id}/itens/${preparedFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: preparedFixture, expected: 2 }) });
assert.equal(staleSecondSession.statusCode, 409, staleSecondSession.body, 'stale quantity from another session cannot cancel the same units twice');
const errorLaunchFixture = await createDeliveredFixture({ stockDebit: true });
const balanceBeforeErrorReverse = Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } })).quantidade);
const movementCountBeforeErrorReverse = await prisma.inventoryMovement.count({ where: { pedidoId: errorLaunchFixture.order.id } });
const errorLaunchCancel = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${errorLaunchFixture.command.id}/itens/${errorLaunchFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: errorLaunchFixture, treatment: 'ERRO_LANCAMENTO' }) });
assert.equal(errorLaunchCancel.statusCode, 200, errorLaunchCancel.body);
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } })).quantidade), balanceBeforeErrorReverse + 1, 'launch error reverses only the matching one-unit debit');
assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: errorLaunchFixture.order.id } }), movementCountBeforeErrorReverse + 1, 'launch error writes one stock reversal');
const missingReasonFixture = await createDeliveredFixture();
const missingReason = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${missingReasonFixture.command.id}/itens/${missingReasonFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: missingReasonFixture, reason: 'x' }) });
assert.equal(missingReason.statusCode, 400, missingReason.body);
const invalidQuantity = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${missingReasonFixture.command.id}/itens/${missingReasonFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: missingReasonFixture, quantity: 3 }) });
assert.equal(invalidQuantity.statusCode, 400, invalidQuantity.body);
const paymentFixture = await createDeliveredFixture({ payment: true });
const paymentPhoto = { item: await prisma.itemComanda.findUniqueOrThrow({ where: { id: paymentFixture.item.id } }), balance: await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } }), auditCount: await prisma.itemComandaCancelamentoEntregue.count({ where: { itemComandaId: paymentFixture.item.id } }) };
const paymentRefused = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${paymentFixture.command.id}/itens/${paymentFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: paymentFixture }) });
assert.equal(paymentRefused.statusCode, 409, paymentRefused.body);
assert.deepEqual({ item: await prisma.itemComanda.findUniqueOrThrow({ where: { id: paymentFixture.item.id } }), balance: await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: deliveredStockBalance.id } }), auditCount: await prisma.itemComandaCancelamentoEntregue.count({ where: { itemComandaId: paymentFixture.item.id } }) }, paymentPhoto, 'payment refusal has no partial stock or audit effects');
const closedFixture = await createDeliveredFixture({ status: 'FECHADA' });
const closedRefused = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${closedFixture.command.id}/itens/${closedFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: closedFixture }) });
assert.equal(closedRefused.statusCode, 409, closedRefused.body);
const noInventoryFixture = await createDeliveredFixture({ controlsStock: false });
const noInventoryCancel = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${noInventoryFixture.command.id}/itens/${noInventoryFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: noInventoryFixture }) });
assert.equal(noInventoryCancel.statusCode, 200, noInventoryCancel.body);
assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: noInventoryFixture.order.id } }), 0, 'uncontrolled product creates no inventory movement');
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '0';
const legacyFixture = await createDeliveredFixture();
const legacyStaffDenied = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${legacyFixture.command.id}/itens/${legacyFixture.item.id}`, headers: authHeaders(staffCookie), payload: deliveredBody({ fixture: legacyFixture }) });
assert.equal(legacyStaffDenied.statusCode, 403, legacyStaffDenied.body, 'legacy permission fallback never grants delivered cancellation to staff');
const legacyOwnerAllowed = await app.inject({ method: 'DELETE', url: `/api/operacao/comandas/${legacyFixture.command.id}/itens/${legacyFixture.item.id}`, headers: authHeaders(ownerCookie), payload: deliveredBody({ fixture: legacyFixture, quantity: 2 }) });
assert.equal(legacyOwnerAllowed.statusCode, 200, legacyOwnerAllowed.body, 'owner authorization is preserved in legacy mode');
process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED = '1';
await prisma.comanda.updateMany({
  where: { id: { in: deliveredTestFixtures.map((fixture) => fixture.command.id) }, status: 'ABERTA' },
  data: { status: 'FECHADA', fechadaEm: new Date() },
});
const salePayload = { pontoVendaId: point.id, itens: [{ produtoId: stockProduct.id, quantidade: 1, opcionais: [{ opcionalId: migratedGenericOptional.id, quantidade: 2 }] }], pagamentos: [{ forma: 'PIX', valor: 12.5 }] };
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
const grantPayment = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.operate', 'payment.receive', 'catalog.shift.manage'] } });
assert.equal(grantPayment.statusCode, 200, grantPayment.body);
const delegatedCardapioSave = await app.inject({ method: 'PUT', url: `/api/operacao/caixa/cardapio?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie), payload: { cardapioId: cardapio.id } });
assert.equal(delegatedCardapioSave.statusCode, 200, delegatedCardapioSave.body);
assert.deepEqual(delegatedCardapioSave.json().permissoesEdicao, { cardapioTurno: true, precoTurno: true, precoTemplate: false }, 'PUT response projects only shift maintenance for catalog.shift.manage');
const completedSale = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: authHeaders(staffCookie), payload: salePayload });
assert.equal(completedSale.statusCode, 201, completedSale.body);
const completedSaleBody = JSON.parse(completedSale.body);
assert.equal(completedSaleBody.status, 'FECHADA');
const saleCommand = await prisma.comanda.findUniqueOrThrow({ where: { id: completedSaleBody.id }, include: { pagamentos: true } });
assert.equal(saleCommand.status, 'FECHADA');
assert.equal(saleCommand.pagamentos.length, 1);
assert.equal(Number(saleCommand.pagamentos[0].valor), 12.5);
const soldOptionalSnapshot = await prisma.itemComandaOpcional.findFirstOrThrow({ where: { itemComanda: { comandaId: saleCommand.id } } });
assert.equal(soldOptionalSnapshot.opcionalCatalogoId, migratedGenericOptional.id);
assert.equal(soldOptionalSnapshot.nome, migratedGenericOptional.nome);
assert.equal(Number(soldOptionalSnapshot.precoAdicional), 1.25);
assert.equal(soldOptionalSnapshot.quantidade, 2);
const savedOptionalBeforeCatalogEdit = { ...soldOptionalSnapshot };
const editSoldOptional = await app.inject({ method: 'PUT', url: `/api/produtos/opcionais/${migratedGenericOptional.id}`, headers: authHeaders(ownerCookie), payload: { nome: `Edited after sale ${suffix}`, preco: 3.5 } });
assert.equal(editSoldOptional.statusCode, 200, editSoldOptional.body);
assert.deepEqual(await prisma.itemComandaOpcional.findUniqueOrThrow({ where: { id: soldOptionalSnapshot.id } }), savedOptionalBeforeCatalogEdit, 'catalog optional edit does not rewrite sold snapshot');
assert.equal(Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } })).quantidade), 9);
assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: staff.id }, select: { permissoesOperacao: true } })).permissoesOperacao.includes('inventory.adjust'), false, 'authorized sale does not need manual inventory authority');
const turnoPrecoBefore = await prisma.sessaoCaixaProdutoOperacao.findFirstOrThrow({ where: { sessaoCaixaId: cashSession.id, produtoId: stockProduct.id, volumeMl: 0 } });
const globalPriceBeforeTurnoEdit = await prisma.preco.findMany({ where: { produtoId: stockProduct.id }, orderBy: { volumeMl: 'asc' } });
const delegatedTurnoPrice = await app.inject({ method: 'PATCH', url: `/api/operacao/caixa/cardapio/preco?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie), payload: { produtoId: stockProduct.id, volumeMl: 0, precoUnit: 13, escopo: 'TURNO' } });
assert.equal(delegatedTurnoPrice.statusCode, 200, delegatedTurnoPrice.body);
assert.equal(Number((await prisma.sessaoCaixaProdutoOperacao.findUniqueOrThrow({ where: { id: turnoPrecoBefore.id } })).precoUnit), 13, 'catalog.shift.manage updates the operational turn price');
assert.deepEqual(await prisma.preco.findMany({ where: { produtoId: stockProduct.id }, orderBy: { volumeMl: 'asc' } }), globalPriceBeforeTurnoEdit, 'turn price edit leaves the global template untouched');
const deniedGlobalTemplatePrice = await app.inject({ method: 'PATCH', url: `/api/operacao/caixa/cardapio/preco?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie), payload: { produtoId: stockProduct.id, volumeMl: 0, precoUnit: 14, escopo: 'TEMPLATE' } });
assert.equal(deniedGlobalTemplatePrice.statusCode, 403, deniedGlobalTemplatePrice.body);
const soldItem = await prisma.itemComanda.findFirstOrThrow({ where: { comandaId: saleCommand.id } });
const pricesBeforeEditDenial = await prisma.preco.findMany({ where: { produtoId: stockProduct.id }, orderBy: { volumeMl: 'asc' } });
const priceEditDenied = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${stockProduct.id}`, headers: authHeaders(staffCookie), payload: { precos: [{ volumeMl: 1, preco: 12 }] } });
assert.equal(priceEditDenied.statusCode, 403, priceEditDenied.body);
assert.deepEqual(await prisma.preco.findMany({ where: { produtoId: stockProduct.id }, orderBy: { volumeMl: 'asc' } }), pricesBeforeEditDenial);
const grantCatalogManage = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['catalog.manage'] } });
assert.equal(grantCatalogManage.statusCode, 200, grantCatalogManage.body);
const templatePricePanel = await app.inject({ method: 'GET', url: `/api/operacao/caixa/cardapio?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(templatePricePanel.statusCode, 200, templatePricePanel.body);
assert.deepEqual(templatePricePanel.json().permissoesEdicao, { cardapioTurno: false, precoTurno: false, precoTemplate: true }, 'catalog.manage alone projects only template price editing to the operational UI');
const templateItemBeforeCatalogEdit = await prisma.cardapioProduto.findFirstOrThrow({ where: { cardapioId: cardapio.id, produtoId: stockProduct.id, volumeMl: 0 } });
const templatePriceUpdate = await app.inject({ method: 'PATCH', url: `/api/operacao/caixa/cardapio/preco?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie), payload: { produtoId: stockProduct.id, volumeMl: 0, precoUnit: 14, escopo: 'TEMPLATE' } });
assert.equal(templatePriceUpdate.statusCode, 200, templatePriceUpdate.body);
assert.deepEqual(templatePriceUpdate.json().permissoesEdicao, { cardapioTurno: false, precoTurno: false, precoTemplate: true }, 'PATCH response projects only template price editing for catalog.manage');
assert.equal(Number((await prisma.cardapioProduto.findUniqueOrThrow({ where: { id: templateItemBeforeCatalogEdit.id } })).precoUnit), 14, 'catalog.manage updates template prices through the authenticated API');
await prisma.cardapioProduto.update({ where: { id: templateItemBeforeCatalogEdit.id }, data: { precoUnit: templateItemBeforeCatalogEdit.precoUnit } });
const foreignOptional = await prisma.opcional.create({ data: { cervejariaId: otherCompany.id, pontoVendaId: foreignPoint.id, nome: `Foreign optional ${suffix}`, preco: '7.25' } });
const foreignOptionalBefore = await prisma.opcional.findUniqueOrThrow({ where: { id: foreignOptional.id } });
const foreignLinksBefore = await prisma.produtoOpcionalVinculo.findMany({ where: { opcionalId: foreignOptional.id }, orderBy: { produtoId: 'asc' } });
const inactiveOtherPoint = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: `Other inactive point ${suffix}`, ativo: false } });
const otherPdvOptional = await prisma.opcional.create({ data: { cervejariaId: company.id, pontoVendaId: inactiveOtherPoint.id, nome: `Other PDV optional ${suffix}`, preco: '2.00' } });
for (const [actor, headers] of [['catalog manager', authHeaders(staffCookie)], ['owner', authHeaders(ownerCookie)]]) {
  for (const [method, route, payload] of [
    ['PUT', `/api/produtos/opcionais/${foreignOptional.id}`, { nome: `stolen ${suffix}` }],
    ['DELETE', `/api/produtos/opcionais/${foreignOptional.id}`, undefined],
    ['PUT', `/api/operacao/produtos/opcionais/${foreignOptional.id}`, { nome: `stolen ${suffix}` }],
    ['DELETE', `/api/operacao/produtos/opcionais/${foreignOptional.id}`, undefined],
  ]) {
    const response = await app.inject({ method, url: route, headers, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 404, `${actor} cannot ${method} another tenant's optional through ${route}: ${response.body}`);
    assert.deepEqual(await prisma.opcional.findUniqueOrThrow({ where: { id: foreignOptional.id } }), foreignOptionalBefore, `${actor} denial preserves foreign optional`);
    assert.deepEqual(await prisma.produtoOpcionalVinculo.findMany({ where: { opcionalId: foreignOptional.id }, orderBy: { produtoId: 'asc' } }), foreignLinksBefore, `${actor} denial preserves foreign links`);
  }
}
const optionalLinkPhoto = async () => prisma.produtoOpcionalVinculo.findMany({ where: { produtoId: stockProduct.id }, orderBy: [{ ordem: 'asc' }, { opcionalId: 'asc' }] });
const ownLinksBeforeForeignLinkAttempts = await optionalLinkPhoto();
for (const route of [`/api/produtos/${stockProduct.id}/opcionais`, `/api/operacao/produtos/${stockProduct.id}/opcionais`]) {
  const rejectedForeignLink = await app.inject({ method: 'PUT', url: route, headers: authHeaders(staffCookie), payload: { opcionalIds: [foreignOptional.id] } });
  assert.equal(rejectedForeignLink.statusCode, 404, `cross-tenant optional link is rejected through ${route}: ${rejectedForeignLink.body}`);
  assert.deepEqual(await optionalLinkPhoto(), ownLinksBeforeForeignLinkAttempts, `foreign optional link attempt preserves existing links through ${route}`);
  for (const invalidIds of [[migratedGenericOptional.id, foreignOptional.id], [migratedGenericOptional.id, otherPdvOptional.id]]) {
    const rejectedMixedLink = await app.inject({ method: 'PUT', url: route, headers: authHeaders(staffCookie), payload: { opcionalIds: invalidIds } });
    assert.equal(rejectedMixedLink.statusCode, 404, `mixed valid and invalid optional IDs are rejected through ${route}: ${rejectedMixedLink.body}`);
    assert.deepEqual(await optionalLinkPhoto(), ownLinksBeforeForeignLinkAttempts, `mixed invalid link preserves prior links through ${route}`);
  }
}
const ownOptional = await prisma.opcional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Owned optional ${suffix}`, preco: '1.25' } });
const ownOptionalEditedGeneric = await app.inject({ method: 'PUT', url: `/api/produtos/opcionais/${ownOptional.id}`, headers: authHeaders(staffCookie), payload: { preco: 1.75 } });
assert.equal(ownOptionalEditedGeneric.statusCode, 200, ownOptionalEditedGeneric.body);
const ownOptionalEditedOperational = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/opcionais/${ownOptional.id}`, headers: authHeaders(staffCookie), payload: { nome: `Owned optional edited ${suffix}` } });
assert.equal(ownOptionalEditedOperational.statusCode, 200, ownOptionalEditedOperational.body);
assert.equal((await prisma.opcional.findUniqueOrThrow({ where: { id: ownOptional.id } })).nome, `Owned optional edited ${suffix}`);
for (const route of [`/api/produtos/opcionais/${ownOptional.id}`, `/api/operacao/produtos/opcionais/${ownOptional.id}`]) {
  const ownOptionalForDelete = route.startsWith('/api/produtos/') ? await prisma.opcional.create({ data: { cervejariaId: company.id, nome: `Delete own ${suffix}`, preco: '0.50' } }) : ownOptional;
  const deletedOwnOptional = await app.inject({ method: 'DELETE', url: route.replace(ownOptional.id, ownOptionalForDelete.id), headers: authHeaders(staffCookie) });
  assert.equal(deletedOwnOptional.statusCode, 200, deletedOwnOptional.body);
  assert.equal(await prisma.opcional.findFirst({ where: { id: ownOptionalForDelete.id, cervejariaId: company.id } }), null);
}
const priceEditAllowed = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${stockProduct.id}`, headers: authHeaders(staffCookie), payload: { precos: [{ volumeMl: 1, preco: 12 }] } });
assert.equal(priceEditAllowed.statusCode, 200, priceEditAllowed.body);
assert.equal(Number((await prisma.preco.findFirstOrThrow({ where: { produtoId: stockProduct.id, volumeMl: 1 } })).preco), 12);
assert.equal(Number((await prisma.itemComanda.findUniqueOrThrow({ where: { id: soldItem.id } })).precoUnit), 12.5, 'catalog price change preserves the sold item price and optional snapshot');
const crossTenantCatalogEdit = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${foreignProduct.id}`, headers: authHeaders(staffCookie), payload: { precoUnit: 5 } });
assert.equal(crossTenantCatalogEdit.statusCode, 404, crossTenantCatalogEdit.body);
const checkoutCustomer = await app.inject({ method: 'POST', url: '/api/clientes/find-or-create', headers: authHeaders(staffCookie), payload: { nome: `Checkout ${suffix}`, telefone: `1199${Date.now().toString().slice(-7)}` } });
assert.equal(checkoutCustomer.statusCode, 200, checkoutCustomer.body);
const adminCustomerReadDenied = await app.inject({ method: 'GET', url: '/api/clientes', headers: authHeaders(staffCookie) });
assert.equal(adminCustomerReadDenied.statusCode, 403, adminCustomerReadDenied.body);
const grantClientsManage = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['clients.manage'] } });
assert.equal(grantClientsManage.statusCode, 200, grantClientsManage.body);
assert.equal((await app.inject({ method: 'GET', url: '/api/clientes', headers: authHeaders(staffCookie) })).statusCode, 200);
const crossTenantClientRead = await app.inject({ method: 'GET', url: `/api/clientes/${foreignClient.id}`, headers: authHeaders(staffCookie) });
assert.equal(crossTenantClientRead.statusCode, 404, crossTenantClientRead.body);
const clientMergeDenied = await app.inject({ method: 'POST', url: `/api/clientes/${debtClient.id}/unir`, headers: authHeaders(staffCookie), payload: { fonteId: JSON.parse(checkoutCustomer.body).id } });
assert.equal(clientMergeDenied.statusCode, 403, clientMergeDenied.body);
const clientDeleteDenied = await app.inject({ method: 'DELETE', url: `/api/clientes/${JSON.parse(checkoutCustomer.body).id}`, headers: authHeaders(staffCookie) });
assert.equal(clientDeleteDenied.statusCode, 403, clientDeleteDenied.body);
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
assert.equal(Number(salePaymentsAfterRefund[1].valor), -12.5);
assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: saleOrder.id, tipo: 'ESTORNO_VENDA' } }), 1);
const commandKeysOnly = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.cancel'] } });
assert.equal(commandKeysOnly.statusCode, 200, commandKeysOnly.body);
const pendingCancelPhoto = await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: saleOrder.id }, select: { status: true, updatedAt: true } });
const deniedCancelConfirmation = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${saleOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'CANCELADO' } });
assert.equal(deniedCancelConfirmation.statusCode, 403, deniedCancelConfirmation.body, 'final cancellation confirmation requires kitchen.cancel and sale.refund like the request step');
assert.deepEqual(await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: saleOrder.id }, select: { status: true, updatedAt: true } }), pendingCancelPhoto, 'denied final cancellation confirmation preserves the queue state');
const restoreCancelConfirmation = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.cancel', 'sale.refund'] } });
assert.equal(restoreCancelConfirmation.statusCode, 200, restoreCancelConfirmation.body);
const confirmedSaleCancellation = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${saleOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'CANCELADO' } });
assert.equal(confirmedSaleCancellation.statusCode, 200, confirmedSaleCancellation.body);
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: saleOrder.id } })).status, 'CANCELADO');
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
// Pending kitchen close uses authenticated operational context while admin config remains owner-only.
const administrativeConfigDenied = await app.inject({ method: 'GET', url: '/api/cervejaria/configuracao-operacional', headers: authHeaders(staffCookie) });
assert.equal(administrativeConfigDenied.statusCode, 403, administrativeConfigDenied.body);
await prisma.configuracaoOperacional.update({ where: { cervejariaId: company.id }, data: { kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true } });
const staffOperationalContext = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: authHeaders(staffCookie) });
assert.equal(staffOperationalContext.statusCode, 200, staffOperationalContext.body);
const staffSettings = JSON.parse(staffOperationalContext.body);
assert.equal(staffSettings.kitchenItemsChargeAtLaunch, true);
assert.equal(staffSettings.allowCloseComandaWithPendingKitchenOrders, true);
const foreignOperationalContext = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: authHeaders(foreignOwnerCookie) });
assert.equal(foreignOperationalContext.statusCode, 200, foreignOperationalContext.body);
assert.equal(JSON.parse(foreignOperationalContext.body).allowCloseComandaWithPendingKitchenOrders, false, 'operational settings are tenant scoped');

const pendingKitchenProduct = await prisma.produto.create({ data: { nome: `Pending kitchen QA ${suffix}`, tipo: 'COMIDA', exigePreparo: true, cervejariaId: company.id } });
let pendingOrderNumber = 910000;
const createPendingKitchenCommand = async (label) => {
  const command = await prisma.comanda.create({
    data: { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id, diaOperacional: cashSession.diaOperacional, tipo: 'MESA', identificador: `${label}-${suffix}`, status: 'ABERTA', abertaPorId: owner.id, total: '14.50' },
  });
  const order = await prisma.pedidoOperacao.create({
    data: { cervejariaId: company.id, comandaId: command.id, pontoVendaId: point.id, numero: pendingOrderNumber++, diaOperacional: cashSession.diaOperacional, criadoPorId: owner.id },
  });
  const item = await prisma.itemComanda.create({
    data: { comandaId: command.id, produtoId: pendingKitchenProduct.id, nome: pendingKitchenProduct.nome, quantidade: 1, precoUnit: '14.50', exigePreparo: true, pedidoCozinhaId: order.id },
  });
  return { command, order, item };
};
const disabledRuleCase = await createPendingKitchenCommand('RuleDisabled');
await prisma.configuracaoOperacional.update({ where: { cervejariaId: company.id }, data: { allowCloseComandaWithPendingKitchenOrders: false } });
const disabledRuleBefore = await commercePhoto();
const disabledRuleClose = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${disabledRuleCase.command.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'PIX', valor: 14.5 }], deixarPendente: false } });
assert.equal(disabledRuleClose.statusCode, 409, disabledRuleClose.body);
assert.deepEqual(await commercePhoto(), disabledRuleBefore, 'disabled pending-kitchen rule leaves financial and stock records unchanged');
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: disabledRuleCase.order.id } })).status, 'RECEBIDO');

await prisma.configuracaoOperacional.update({ where: { cervejariaId: company.id }, data: { allowCloseComandaWithPendingKitchenOrders: true } });
const missingPaymentPermission = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.close'] } });
assert.equal(missingPaymentPermission.statusCode, 200, missingPaymentPermission.body);
const permissionBefore = await commercePhoto();
const missingPermissionClose = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${disabledRuleCase.command.id}/pagamentos`, headers: authHeaders(staffCookie), payload: { pagamentos: [{ forma: 'PIX', valor: 14.5 }], deixarPendente: false } });
assert.equal(missingPermissionClose.statusCode, 403, missingPermissionClose.body);
assert.deepEqual(await commercePhoto(), permissionBefore, 'missing payment.receive leaves financial and stock records unchanged');

const grantPendingClosePermissions = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.close', 'payment.receive'] } });
assert.equal(grantPendingClosePermissions.statusCode, 200, grantPendingClosePermissions.body);
const secondStaffPermissions = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staffTwo.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.close', 'payment.receive'] } });
assert.equal(secondStaffPermissions.statusCode, 200, secondStaffPermissions.body);
const allowedPendingCases = [disabledRuleCase, await createPendingKitchenCommand('StaffTwo')];
const pendingCloseStockBefore = await prisma.inventoryMovement.count({ where: { cervejariaId: company.id } });
for (const [index, fixture] of allowedPendingCases.entries()) {
  const cookie = index === 0 ? staffCookie : staffTwoCookie;
  const employee = index === 0 ? staff : staffTwo;
  const closedResponse = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${fixture.command.id}/pagamentos`, headers: authHeaders(cookie), payload: { pagamentos: [{ forma: 'PIX', valor: 14.5 }], deixarPendente: false } });
  assert.equal(closedResponse.statusCode, 200, closedResponse.body);
  const closedBody = JSON.parse(closedResponse.body);
  assert.equal(closedBody.status, 'FECHADA');
  assert.equal(Number(closedBody.total), 14.5);
  const payment = await prisma.pagamento.findFirstOrThrow({ where: { comandaId: fixture.command.id, registradoPorId: employee.id } });
  assert.equal(Number(payment.valor), 14.5);
  assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: fixture.order.id } })).status, 'RECEBIDO', 'closing does not advance kitchen status');
  assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: fixture.item.id } })).quantidade, 1);
}
assert.equal(await prisma.inventoryMovement.count({ where: { cervejariaId: company.id } }), pendingCloseStockBefore, 'closing pending kitchen commands does not repeat stock movements');
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
    && !staffServerSocket?.rooms.has(`cervejaria:${company.id}:comandas`)
    && !staffServerSocket?.rooms.has(`cervejaria:${company.id}:cozinha`)
    && !staffServerSocket?.rooms.has(`cervejaria:${company.id}:financeiro`)
    && staffServerSocket?.rooms.has(`evento:${event.id}:operacao`)
    && staffServerSocket?.data.tenantSubscriptions?.has(company.id)
    && staffServerSocket?.data.eventoSubscriptions?.has(event.id)
    && financeServerSocket?.rooms.has(`cervejaria:${company.id}:financeiro`)
    && financeServerSocket?.rooms.has(`cervejaria:${company.id}:comandas`)
    && financeServerSocket?.rooms.has(`cervejaria:${company.id}:cozinha`);
}, 'flag-on staff and owner joins');
const { emitFinancialToEvento, emitToCervejaria, emitToEvento } = await import('../src/lib/realtime.ts');

let emptyCommandPayloads = 0;
let emptyKitchenPayloads = 0;
let emptyFinancePayloads = 0;
socket.on('comanda:created', () => emptyCommandPayloads++);
socket.on('operacao:pedido-novo', () => emptyKitchenPayloads++);
socket.on('evento-caixa:financial-updated', () => emptyFinancePayloads++);
const emptyProfileInvalidation = socketEvent('ranking:updated', (payload) => payload.eventoId === event.id);
emitToCervejaria(app.io, company.id, { type: 'comanda:created', data: { id: 'empty-hidden-command', total: 99 } });
emitToCervejaria(app.io, company.id, { type: 'operacao:pedido-novo', data: { id: 'empty-hidden-kitchen', itens: [{ nome: 'hidden' }] } });
emitFinancialToEvento(app.io, event.id, { type: 'evento-caixa:financial-updated', data: { eventoId: event.id, valor: 99 } });
emitToEvento(app.io, event.id, { type: 'ranking:updated', data: { eventoId: event.id, total: 0 } });
assert.equal((await emptyProfileInvalidation).eventoId, event.id, 'empty permission profile still receives minimum non-sensitive invalidation');
await new Promise((resolve) => setTimeout(resolve, 100));
assert.deepEqual([emptyCommandPayloads, emptyKitchenPayloads, emptyFinancePayloads], [0, 0, 0], 'empty permission profile receives no command, kitchen or cash payload');

const commandReadOnlyGrant = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.read'] } });
assert.equal(commandReadOnlyGrant.statusCode, 200, commandReadOnlyGrant.body);
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:comandas`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:cozinha`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:financeiro`), 'command.read joins only the command content room');
const commandReadPayload = socketEvent('comanda:created', (payload) => payload.id === 'command-read-only');
let commandReaderKitchenPayloads = 0;
socket.on('operacao:pedido-novo', () => commandReaderKitchenPayloads++);
emitToCervejaria(app.io, company.id, { type: 'comanda:created', data: { id: 'command-read-only', total: 21 } });
emitToCervejaria(app.io, company.id, { type: 'operacao:pedido-novo', data: { id: 'command-reader-hidden-queue', itens: [{ nome: 'hidden' }] } });
assert.equal((await commandReadPayload).total, 21);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(commandReaderKitchenPayloads, 0, 'command.read does not grant kitchen queue contents');

// Launch a persisted order over the authenticated API with a linked optional.
const grantLaunchAndKitchen = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['command.read', 'command.operate', 'kitchen.read', 'kitchen.operate'] } });
assert.equal(grantLaunchAndKitchen.statusCode, 200, grantLaunchAndKitchen.body);
const foreignOrderBeforeTransition = await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: foreignOrder.id }, select: { status: true, updatedAt: true } });
const crossTenantKitchenTransition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${foreignOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'EM_PREPARO' } });
assert.equal(crossTenantKitchenTransition.statusCode, 404, crossTenantKitchenTransition.body);
assert.deepEqual(await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: foreignOrder.id }, select: { status: true, updatedAt: true } }), foreignOrderBeforeTransition, 'cross-tenant kitchen denial preserves the foreign order');
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
const ownerKitchenPayload = await newFinanceOrder;
assert.equal(ownerKitchenPayload.itensComanda[0].id, persistedSocketOrder.itensComanda[0].id);
assert.equal(JSON.stringify(ownerKitchenPayload).includes('preco'), false, 'even a cash reader receives only the kitchen projection for queue events');

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
const ownerKitchenStatus = socketEventFor(financeSocket, 'operacao:pedido-atualizado', (payload) => payload.id === persistedSocketOrder.id);
const statusChanged = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${persistedSocketOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'EM_PREPARO' } });
assert.equal(statusChanged.statusCode, 200, statusChanged.body);
const [restrictedStatus, ownerStatus] = await Promise.all([statusUpdateRestricted, ownerKitchenStatus]);
assert.equal(restrictedStatus.status, 'EM_PREPARO');
assert.equal(restrictedStatus.itensComanda[0].id, persistedSocketOrder.itensComanda[0].id);
assert.deepEqual(restrictedStatus.itensComanda[0].opcionais.map(({ nome, quantidade }) => ({ nome, quantidade })), [{ nome: socketOptional.nome, quantidade: 2 }]);
assert.equal(JSON.stringify(restrictedStatus).includes('preco'), false);
assert.equal(ownerStatus.status, 'EM_PREPARO');
assert.equal(ownerStatus.itensComanda[0].id, persistedSocketOrder.itensComanda[0].id);
assert.deepEqual(ownerStatus.itensComanda[0].opcionais.map(({ nome, quantidade }) => ({ nome, quantidade })), [{ nome: socketOptional.nome, quantidade: 2 }]);
assert.equal(JSON.stringify(ownerStatus).includes('preco'), false, 'owner gets kitchen projection without financial prices');

const socketGrant = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['cash.values.read'] } });
assert.equal(socketGrant.statusCode, 200, socketGrant.body);
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:financeiro`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:comandas`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:cozinha`), 'cash.values.read grants finance only on the established socket');
const financialEvent = socketEvent('evento-caixa:financial-updated');
emitFinancialToEvento(app.io, event.id, { type: 'evento-caixa:financial-updated', data: { eventoId: event.id, trocoInicial: 734.21, esperado: { DINHEIRO: 752.58 } } });
assert.equal((await financialEvent).trocoInicial, 734.21, 'grant reaches the financial room on the established socket');
let cashOnlyCommandPayloads = 0;
let cashOnlyKitchenPayloads = 0;
socket.on('comanda:created', () => cashOnlyCommandPayloads++);
socket.on('operacao:pedido-novo', () => cashOnlyKitchenPayloads++);
emitToCervejaria(app.io, company.id, { type: 'comanda:created', data: { id: 'cash-only-command', total: 999 } });
emitToCervejaria(app.io, company.id, { type: 'operacao:pedido-novo', data: { id: 'cash-only-kitchen', itens: [{ nome: 'restricted' }] } });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(cashOnlyCommandPayloads, 0, 'cash.values.read does not grant command payloads');
assert.equal(cashOnlyKitchenPayloads, 0, 'cash.values.read does not grant kitchen payloads');
const kitchenReadOnlyGrant = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.read'] } });
assert.equal(kitchenReadOnlyGrant.statusCode, 200, kitchenReadOnlyGrant.body);
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:cozinha`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:financeiro`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`cervejaria:${company.id}:comandas`), 'kitchen.read joins the queue room only');
const kitchenReadPayload = socketEvent('operacao:pedido-atualizado', (payload) => payload.id === 'kitchen-read-only');
emitToCervejaria(app.io, company.id, { type: 'operacao:pedido-atualizado', data: { id: 'kitchen-read-only', itens: [{ id: 'line', nome: 'queue item' }] } });
assert.equal((await kitchenReadPayload).itensComanda[0].nome, 'queue item', 'kitchen.read receives the queue projection');
const socketRevoke = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.read', 'kitchen.operate'] } });
assert.equal(socketRevoke.statusCode, 200, socketRevoke.body);
assert.equal(socket.connected, true);
assert.equal(socket.id, socketIdBeforeRevoke, 'permission revocation does not replace the authenticated session');
await waitFor(() => app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:cozinha`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:financeiro`)
  && !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:comandas`), 'revoking cash and granting kitchen moves the same socket into kitchen only');
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
const revokeKitchenRead = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['kitchen.operate'] } });
assert.equal(revokeKitchenRead.statusCode, 200, revokeKitchenRead.body);
await waitFor(() => !app.io.sockets.sockets.get(socket.id)?.rooms.has(`evento:${event.id}:cozinha`), 'revoking kitchen.read removes queue room from the connected socket');
let queuePayloadsAfterReadRevoke = 0;
socket.on('operacao:pedido-atualizado', () => queuePayloadsAfterReadRevoke++);
emitToEvento(app.io, event.id, { type: 'operacao:pedido-atualizado', data: { id: persistedSocketOrder.id, itens: [{ nome: 'revoked content' }] } });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(queuePayloadsAfterReadRevoke, 0, 'revoking kitchen.read stops queue contents on the same socket');
const revokeKitchen = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: [] } });
assert.equal(revokeKitchen.statusCode, 200, revokeKitchen.body);
const kitchenPhotoBeforeRevokedTransition = await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: persistedSocketOrder.id }, select: { status: true, updatedAt: true } });
const revokedKitchenTransition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${persistedSocketOrder.id}/status`, headers: authHeaders(staffCookie), payload: { status: 'ENTREGUE' } });
assert.equal(revokedKitchenTransition.statusCode, 403, revokedKitchenTransition.body);
assert.deepEqual(await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: persistedSocketOrder.id }, select: { status: true, updatedAt: true } }), kitchenPhotoBeforeRevokedTransition, 'revoking kitchen.operate blocks the next transition without a write');
const foreignSocket = connectSocket(localAddress, { extraHeaders: { cookie: foreignOwnerCookie }, transports: ['websocket'], reconnection: false });
await connect(foreignSocket);
foreignSocket.emit('join:cervejaria', company.id);
await waitFor(() => !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:financeiro`)
  && !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:operacao`)
  && !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:comandas`)
  && !app.io.sockets.sockets.get(foreignSocket.id)?.rooms.has(`cervejaria:${company.id}:cozinha`), 'foreign tenant denial');
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

// Run a real browser against this exact Fastify instance, which serves the exact
// frontend build from this Git snapshot. No API interception or proxy is enabled.
const repoRoot = path.resolve(backendRoot, '..');
const apiPort = app.server.address().port;
await access(path.join(repoRoot, 'frontend/dist/index.html'));
// Earlier API isolation cases used an inactive second PDV to test scope. Those
// assertions are complete; remove only their disposable rows so the canonical
// browser fixture satisfies the exactly-one-PDV product contract.
await prisma.opcional.delete({ where: { id: otherPdvOptional.id } });
await prisma.pontoVenda.delete({ where: { id: inactiveOtherPoint.id } });
await prisma.evento.update({ where: { id: event.id }, data: { status: 'FECHADO', data: new Date(), encerradoEm: new Date() } });
const apiProbe = await fetch(`http://127.0.0.1:${apiPort}/api/auth/me`);
console.log(`RBAC_LIVE_API_PROBE status=${apiProbe.status}; target=127.0.0.1:${apiPort}`);
assert.equal(apiProbe.status, 401, 'The live app must answer unauthenticated auth/me before browser startup.');
// The API tenant-isolation checks have finished using this fixture. Remove its
// open command so event.cash.close can verify the no-open-command path.
await prisma.pedidoOperacao.delete({ where: { id: foreignOrder.id } });
await prisma.comanda.delete({ where: { id: foreignCommand.id } });

// Dedicated disposable fixtures for the remaining live-browser permission
// keys. Each destructive operation has its own command/order so denial and
// same-session revocation can be checked without reusing mutated state.
const createLiveCommandFixture = async ({ label, itemCount = 1, itemStatus = 'RECEBIDO', itemName = `RBAC item ${suffix}`, requiresKitchen = false, type = 'MESA', customerId = null } = {}) => {
  const command = await prisma.comanda.create({ data: {
    origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: cashSession.id,
    ocorrenciaId: cashSession.ocorrenciaId,
    diaOperacional: cashSession.diaOperacional, tipo: type, identificador: `${label}-${suffix}`,
    status: 'ABERTA', abertaPorId: owner.id, clienteId: customerId, total: (itemCount * 10).toFixed(2),
  } });
  if (!itemCount) return { command };
  const order = await prisma.pedidoOperacao.create({ data: {
    cervejariaId: company.id, comandaId: command.id, pontoVendaId: point.id,
    numero: 930000 + Math.floor(Math.random() * 60000), diaOperacional: cashSession.diaOperacional,
    criadoPorId: owner.id, status: itemStatus,
  } });
  const item = await prisma.itemComanda.create({ data: {
    comandaId: command.id, produtoId: stockProduct.id, pedidoCozinhaId: order.id,
    nome: itemName, quantidade: itemCount, precoUnit: '10.00', exigePreparo: requiresKitchen,
  } });
  return { command, order, item };
};
const livePaymentFixture = await createLiveCommandFixture({ label: 'Pay permission' });
const livePaymentRevokeFixture = await createLiveCommandFixture({ label: 'Pay revoke permission' });
const liveCloseFixture = await createLiveCommandFixture({ label: 'Close permission' });
const liveCloseRevokeFixture = await createLiveCommandFixture({ label: 'Close revoke permission' });
const liveDiscountFixture = await createLiveCommandFixture({ label: 'Discount permission' });
const liveDiscountRevokeFixture = await createLiveCommandFixture({ label: 'Discount revoke permission' });
const liveItemCancelFixture = await createLiveCommandFixture({ label: 'Item cancel permission', itemCount: 2 });
const liveItemCancelRevokeFixture = await createLiveCommandFixture({ label: 'Item cancel revoke permission', itemCount: 2 });
const liveCommandCancelFixture = await createLiveCommandFixture({ label: 'Command cancel permission', itemCount: 0 });
const liveCommandCancelRevokeFixture = await createLiveCommandFixture({ label: 'Command cancel revoke permission', itemCount: 0 });
const liveDeliveredCancelFixture = await createDeliveredFixture({ quantity: 2 });
const liveDeliveredCancelRevokeFixture = await createDeliveredFixture({ quantity: 2 });
const liveKitchenCancelFixture = await createLiveCommandFixture({ label: 'Kitchen cancel permission', itemName: `RBAC kitchen cancel ${suffix}`, requiresKitchen: true });
const liveKitchenCancelRevokeFixture = await createLiveCommandFixture({ label: 'Kitchen cancel revoke permission', itemName: `RBAC kitchen revoke ${suffix}`, requiresKitchen: true });
const liveRefundFixture = await createLiveCommandFixture({ label: 'Sale refund permission', itemName: `RBAC sale refund ${suffix}`, requiresKitchen: true, type: 'AVULSA' });
await prisma.comanda.update({ where: { id: liveRefundFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
await prisma.pagamento.create({ data: { comandaId: liveRefundFixture.command.id, forma: 'PIX', valor: '10.00', registradoPorId: owner.id } });
const liveRefundRevokeFixture = await createLiveCommandFixture({ label: 'Sale refund revoke permission', itemName: `RBAC sale refund revoke ${suffix}`, requiresKitchen: true, type: 'AVULSA' });
await prisma.comanda.update({ where: { id: liveRefundRevokeFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
await prisma.pagamento.create({ data: { comandaId: liveRefundRevokeFixture.command.id, forma: 'PIX', valor: '10.00', registradoPorId: owner.id } });
const seedRefundRequest = async (fixture) => {
  const response = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${fixture.order.id}/status`, headers: authHeaders(ownerCookie), payload: { status: 'CANCELAMENTO_PENDENTE' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: fixture.order.id } })).status, 'CANCELAMENTO_PENDENTE');
  const refunds = await prisma.pagamento.findMany({ where: { comandaId: fixture.command.id, valor: { lt: 0 } } });
  assert.equal(refunds.length, 1, 'owner API request seeds the real closed-sale refund before attendant confirmation');
};
await seedRefundRequest(liveRefundFixture);
await seedRefundRequest(liveRefundRevokeFixture);
const liveDebtCustomer = await prisma.cliente.create({ data: { nome: `RBAC debt ${suffix}`, telefone: `119876${Date.now().toString().slice(-5)}`, cervejariaId: company.id } });
const liveDebtFixture = await createLiveCommandFixture({ label: 'Debt permission', itemName: `RBAC debt item ${suffix}`, type: 'MESA', customerId: liveDebtCustomer.id });
await prisma.comanda.update({ where: { id: liveDebtFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
const liveDebt = await prisma.contaReceber.create({ data: { comandaId: liveDebtFixture.command.id, clienteId: liveDebtCustomer.id, valorOriginal: '10.00', criadoPorId: owner.id } });

// Matched duplicate fixture set for the Legacy contract run. It is isolated
// from the CANONICAL_PDV cases because successful actions consume their rows.
const legacyPaymentFixture = await createLiveCommandFixture({ label: 'Legacy pay permission' });
const legacyPaymentRevokeFixture = await createLiveCommandFixture({ label: 'Legacy pay revoke permission' });
const legacyCloseFixture = await createLiveCommandFixture({ label: 'Legacy close permission' });
const legacyCloseRevokeFixture = await createLiveCommandFixture({ label: 'Legacy close revoke permission' });
const legacyDiscountFixture = await createLiveCommandFixture({ label: 'Legacy discount permission' });
const legacyDiscountRevokeFixture = await createLiveCommandFixture({ label: 'Legacy discount revoke permission' });
const legacyItemCancelFixture = await createLiveCommandFixture({ label: 'Legacy item cancel permission', itemCount: 2 });
const legacyItemCancelRevokeFixture = await createLiveCommandFixture({ label: 'Legacy item cancel revoke permission', itemCount: 2 });
const legacyCommandCancelFixture = await createLiveCommandFixture({ label: 'Legacy command cancel permission', itemCount: 0 });
const legacyCommandCancelRevokeFixture = await createLiveCommandFixture({ label: 'Legacy command cancel revoke permission', itemCount: 0 });
const legacyDeliveredCancelFixture = await createDeliveredFixture({ quantity: 2 });
const legacyDeliveredCancelRevokeFixture = await createDeliveredFixture({ quantity: 2 });
const legacyKitchenCancelFixture = await createLiveCommandFixture({ label: 'Legacy kitchen cancel permission', itemName: `RBAC legacy kitchen ${suffix}`, requiresKitchen: true });
const legacyKitchenCancelRevokeFixture = await createLiveCommandFixture({ label: 'Legacy kitchen revoke permission', itemName: `RBAC legacy kitchen revoke ${suffix}`, requiresKitchen: true });
const legacyRefundFixture = await createLiveCommandFixture({ label: 'Legacy sale refund permission', itemName: `RBAC legacy sale refund ${suffix}`, requiresKitchen: true, type: 'AVULSA' });
await prisma.comanda.update({ where: { id: legacyRefundFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
await prisma.pagamento.create({ data: { comandaId: legacyRefundFixture.command.id, forma: 'PIX', valor: '10.00', registradoPorId: owner.id } });
const legacyRefundRevokeFixture = await createLiveCommandFixture({ label: 'Legacy sale refund revoke permission', itemName: `RBAC legacy refund revoke ${suffix}`, requiresKitchen: true, type: 'AVULSA' });
await prisma.comanda.update({ where: { id: legacyRefundRevokeFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
await prisma.pagamento.create({ data: { comandaId: legacyRefundRevokeFixture.command.id, forma: 'PIX', valor: '10.00', registradoPorId: owner.id } });
await seedRefundRequest(legacyRefundFixture);
await seedRefundRequest(legacyRefundRevokeFixture);
const legacyDebtCustomer = await prisma.cliente.create({ data: { nome: `RBAC legacy debt ${suffix}`, telefone: `118765${Date.now().toString().slice(-5)}`, cervejariaId: company.id } });
const legacyDebtFixture = await createLiveCommandFixture({ label: 'Legacy debt permission', itemName: `RBAC legacy debt item ${suffix}`, type: 'MESA', customerId: legacyDebtCustomer.id });
await prisma.comanda.update({ where: { id: legacyDebtFixture.command.id }, data: { status: 'FECHADA', fechadaEm: new Date() } });
const legacyDebt = await prisma.contaReceber.create({ data: { comandaId: legacyDebtFixture.command.id, clienteId: legacyDebtCustomer.id, valorOriginal: '10.00', criadoPorId: owner.id } });

// The live browser additionally exercises agenda.manage, whose route is
// available only when this disposable tenant has canonical PDV settings.
process.env.PDV_CANONICAL_CONFIG_QA = '1';
const browserEnv = {
  ...process.env,
  // The browser suite includes the canonical agenda.manage flow. Keep the
  // activation limited by the disposable QA DATABASE_URL guard in the API.
  PDV_CANONICAL_CONFIG_QA: '1',
  RBAC_QA_BASE_URL: `http://127.0.0.1:${apiPort}`,
  RBAC_QA_OUTPUT_DIR: path.join(process.env.PDV_QA_TEMP_PARENT, 'live-results'),
  RBAC_QA_OWNER_EMAIL: owner.email,
  RBAC_QA_OWNER_PASSWORD: ownerPassword,
    RBAC_QA_OWNER_COOKIE: ownerCookie,
  RBAC_QA_STAFF_EMAIL: staff.email,
  RBAC_QA_STAFF_PASSWORD: attendantPassword,
    RBAC_QA_STAFF_COOKIE: staffCookie,
  RBAC_QA_ADMIN_COOKIE: adminCookie,
  RBAC_QA_ADMIN_EMAIL: admin.email,
  RBAC_QA_FOREIGN_OWNER_EMAIL: otherOwner.email,
  RBAC_QA_FOREIGN_OWNER_PASSWORD: otherOwnerPassword,
  RBAC_QA_STAFF_ID: staff.id,
  RBAC_QA_REPORT_EVENT_ID: event.id,
  RBAC_QA_EVENT_MENU_OWNER_COOKIE: foreignOwnerCookie,
  RBAC_QA_EVENT_MENU_STAFF_COOKIE: eventMenuStaffCookie,
  RBAC_QA_EVENT_MENU_STAFF_ID: eventMenuStaff.id,
  RBAC_QA_EVENT_MENU_EVENT_ID: foreignEvent.id,
    RBAC_QA_EVENT_TAP_ID: eventPermissionTap.id,
    RBAC_QA_EVENT_TAP_CHOPE_ID: foreignTapChope.id,
  RBAC_QA_EVENT_MENU_EVENT_NAME: foreignEvent.nome,
  RBAC_QA_EVENT_MENU_PRODUCT_FOREIGN_ID: foreignProduct.id,
  RBAC_QA_EVENT_MENU_PRODUCT_FOREIGN_NAME: foreignProduct.nome,
  RBAC_QA_INVENTORY_PRODUCT_ID: stockProduct.id,
  RBAC_QA_INVENTORY_PRODUCT_NAME: stockProduct.nome,
  RBAC_QA_KITCHEN_ORDER_ID: disabledRuleCase.order.id,
  RBAC_QA_KITCHEN_COMMAND_IDENTIFIER: disabledRuleCase.command.identificador,
  // Keep per-permission progress outside the immutable source snapshot so it
  // survives cleanup or interruption of this disposable database run.
  RBAC_QA_CHECKPOINT_DIR: path.join(process.env.PDV_QA_TEMP_PARENT, 'checkpoints'),
  RBAC_QA_PAYMENT_COMMAND_ID: livePaymentFixture.command.id,
  RBAC_QA_PAYMENT_REVOKE_COMMAND_ID: livePaymentRevokeFixture.command.id,
  RBAC_QA_CLOSE_COMMAND_ID: liveCloseFixture.command.id,
  RBAC_QA_CLOSE_REVOKE_COMMAND_ID: liveCloseRevokeFixture.command.id,
  RBAC_QA_DISCOUNT_COMMAND_ID: liveDiscountFixture.command.id,
  RBAC_QA_DISCOUNT_REVOKE_COMMAND_ID: liveDiscountRevokeFixture.command.id,
  RBAC_QA_ITEM_CANCEL_COMMAND_ID: liveItemCancelFixture.command.id,
  RBAC_QA_ITEM_CANCEL_ITEM_ID: liveItemCancelFixture.item.id,
  RBAC_QA_ITEM_CANCEL_REVOKE_COMMAND_ID: liveItemCancelRevokeFixture.command.id,
  RBAC_QA_COMMAND_CANCEL_COMMAND_ID: liveCommandCancelFixture.command.id,
  RBAC_QA_COMMAND_CANCEL_REVOKE_COMMAND_ID: liveCommandCancelRevokeFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_COMMAND_ID: liveDeliveredCancelFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_ITEM_ID: liveDeliveredCancelFixture.item.id,
  RBAC_QA_DELIVERED_CANCEL_REVOKE_COMMAND_ID: liveDeliveredCancelRevokeFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_REVOKE_ITEM_ID: liveDeliveredCancelRevokeFixture.item.id,
  RBAC_QA_KITCHEN_CANCEL_COMMAND_ID: liveKitchenCancelFixture.command.id,
  RBAC_QA_KITCHEN_CANCEL_ORDER_ID: liveKitchenCancelFixture.order.id,
  RBAC_QA_KITCHEN_CANCEL_COMMAND_LABEL: liveKitchenCancelFixture.command.identificador,
  RBAC_QA_KITCHEN_CANCEL_ITEM_NAME: liveKitchenCancelFixture.item.nome,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_COMMAND_ID: liveKitchenCancelRevokeFixture.command.id,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_ORDER_ID: liveKitchenCancelRevokeFixture.order.id,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_COMMAND_LABEL: liveKitchenCancelRevokeFixture.command.identificador,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_ITEM_NAME: liveKitchenCancelRevokeFixture.item.nome,
  RBAC_QA_REFUND_COMMAND_ID: liveRefundFixture.command.id,
  RBAC_QA_REFUND_ORDER_ID: liveRefundFixture.order.id,
  RBAC_QA_REFUND_ITEM_ID: liveRefundFixture.item.id,
  RBAC_QA_REFUND_COMMAND_LABEL: liveRefundFixture.command.identificador,
  RBAC_QA_REFUND_ITEM_NAME: liveRefundFixture.item.nome,
  RBAC_QA_REFUND_REVOKE_COMMAND_ID: liveRefundRevokeFixture.command.id,
  RBAC_QA_REFUND_REVOKE_ORDER_ID: liveRefundRevokeFixture.order.id,
  RBAC_QA_REFUND_REVOKE_COMMAND_LABEL: liveRefundRevokeFixture.command.identificador,
  RBAC_QA_REFUND_REVOKE_ITEM_NAME: liveRefundRevokeFixture.item.nome,
  RBAC_QA_DEBT_ID: liveDebt.id,
  RBAC_QA_DEBT_COMMAND_ID: liveDebtFixture.command.id,
  RBAC_QA_DEBT_CUSTOMER_NAME: liveDebtCustomer.nome,
};
const legacyBrowserEnv = {
  ...browserEnv,
  PDV_CANONICAL_CONFIG_QA: '0',
  RBAC_QA_PAYMENT_COMMAND_ID: legacyPaymentFixture.command.id,
  RBAC_QA_PAYMENT_REVOKE_COMMAND_ID: legacyPaymentRevokeFixture.command.id,
  RBAC_QA_CLOSE_COMMAND_ID: legacyCloseFixture.command.id,
  RBAC_QA_CLOSE_REVOKE_COMMAND_ID: legacyCloseRevokeFixture.command.id,
  RBAC_QA_DISCOUNT_COMMAND_ID: legacyDiscountFixture.command.id,
  RBAC_QA_DISCOUNT_REVOKE_COMMAND_ID: legacyDiscountRevokeFixture.command.id,
  RBAC_QA_ITEM_CANCEL_COMMAND_ID: legacyItemCancelFixture.command.id,
  RBAC_QA_ITEM_CANCEL_ITEM_ID: legacyItemCancelFixture.item.id,
  RBAC_QA_ITEM_CANCEL_REVOKE_COMMAND_ID: legacyItemCancelRevokeFixture.command.id,
  RBAC_QA_COMMAND_CANCEL_COMMAND_ID: legacyCommandCancelFixture.command.id,
  RBAC_QA_COMMAND_CANCEL_REVOKE_COMMAND_ID: legacyCommandCancelRevokeFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_COMMAND_ID: legacyDeliveredCancelFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_ITEM_ID: legacyDeliveredCancelFixture.item.id,
  RBAC_QA_DELIVERED_CANCEL_REVOKE_COMMAND_ID: legacyDeliveredCancelRevokeFixture.command.id,
  RBAC_QA_DELIVERED_CANCEL_REVOKE_ITEM_ID: legacyDeliveredCancelRevokeFixture.item.id,
  RBAC_QA_KITCHEN_CANCEL_COMMAND_ID: legacyKitchenCancelFixture.command.id,
  RBAC_QA_KITCHEN_CANCEL_ORDER_ID: legacyKitchenCancelFixture.order.id,
  RBAC_QA_KITCHEN_CANCEL_COMMAND_LABEL: legacyKitchenCancelFixture.command.identificador,
  RBAC_QA_KITCHEN_CANCEL_ITEM_NAME: legacyKitchenCancelFixture.item.nome,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_ORDER_ID: legacyKitchenCancelRevokeFixture.order.id,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_COMMAND_LABEL: legacyKitchenCancelRevokeFixture.command.identificador,
  RBAC_QA_KITCHEN_CANCEL_REVOKE_ITEM_NAME: legacyKitchenCancelRevokeFixture.item.nome,
  RBAC_QA_REFUND_COMMAND_ID: legacyRefundFixture.command.id,
  RBAC_QA_REFUND_ORDER_ID: legacyRefundFixture.order.id,
  RBAC_QA_REFUND_ITEM_ID: legacyRefundFixture.item.id,
  RBAC_QA_REFUND_COMMAND_LABEL: legacyRefundFixture.command.identificador,
  RBAC_QA_REFUND_ITEM_NAME: legacyRefundFixture.item.nome,
  RBAC_QA_REFUND_REVOKE_COMMAND_ID: legacyRefundRevokeFixture.command.id,
  RBAC_QA_REFUND_REVOKE_ORDER_ID: legacyRefundRevokeFixture.order.id,
  RBAC_QA_REFUND_REVOKE_COMMAND_LABEL: legacyRefundRevokeFixture.command.identificador,
  RBAC_QA_REFUND_REVOKE_ITEM_NAME: legacyRefundRevokeFixture.item.nome,
  RBAC_QA_DEBT_ID: legacyDebt.id,
  RBAC_QA_DEBT_COMMAND_ID: legacyDebtFixture.command.id,
  RBAC_QA_DEBT_CUSTOMER_NAME: legacyDebtCustomer.nome,
};
const browserLogs = [];
const runBrowser = async (args, env) => {
  const browserRun = spawn(process.execPath, [path.join(repoRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.rbac-live.config.ts', ...args], {
    cwd: repoRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  browserRun.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  browserRun.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    browserRun.once('error', reject);
    browserRun.once('exit', resolve);
  });
  browserLogs.push(`${stdout}\n${stderr}`);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return exitCode;
};
const remainingPermissionGrep = 'payment\\.receive|debt\\.receive|command\\.close|discount\\.apply|command\\.item\\.cancel|command\\.cancel|kitchen\\.cancel|sale\\.refund';
// Previously approved operational and taps cases are intentionally not replayed.
const browserGrep = process.env.PDV_RBAC_TEST_GREP ?? remainingPermissionGrep;
const canonicalBrowserExitCode = await runBrowser(['--grep', browserGrep], browserEnv);
process.env.PDV_CANONICAL_CONFIG_QA = '0';
const remainingLegacyBrowserExitCode = await runBrowser(['--grep', browserGrep], legacyBrowserEnv);
process.env.PDV_CANONICAL_CONFIG_QA = '1';
await writeFile(path.join(process.env.PDV_QA_TEMP_PARENT, 'live-results', 'browser-run.log'), browserLogs.join('\n'));
assert.equal(canonicalBrowserExitCode, 0, 'Live CANONICAL_PDV operational RBAC browser tests failed.');
assert.equal(remainingLegacyBrowserExitCode, 0, 'Live LEGACY remaining-permission browser tests failed.');
if (!process.env.PDV_RBAC_TEST_GREP) {
const canonicalPaidCommand = await prisma.comanda.findUniqueOrThrow({ where: { id: livePaymentFixture.command.id }, include: { pagamentos: true } });
assert.equal(canonicalPaidCommand.status, 'FECHADA');
assert.equal(canonicalPaidCommand.pagamentos.length, 1);
assert.equal(canonicalPaidCommand.pagamentos[0].registradoPorId, staff.id);
const canonicalPaymentRevoked = await prisma.comanda.findUniqueOrThrow({ where: { id: livePaymentRevokeFixture.command.id }, include: { pagamentos: true } });
assert.equal(canonicalPaymentRevoked.status, 'ABERTA');
assert.equal(canonicalPaymentRevoked.pagamentos.length, 0);
const canonicalDebt = await prisma.contaReceber.findUniqueOrThrow({ where: { id: liveDebt.id }, include: { pagamentos: true } });
assert.equal(canonicalDebt.pagamentos.length, 1);
assert.equal(canonicalDebt.pagamentos[0].registradoPorId, staff.id);
assert.equal(Number(canonicalDebt.pagamentos[0].valor), 5);
const canonicalClosed = await prisma.comanda.findUniqueOrThrow({ where: { id: liveCloseFixture.command.id }, include: { pagamentos: true } });
assert.equal(canonicalClosed.status, 'FECHADA');
assert.equal(canonicalClosed.fechadoPorId, staff.id);
assert.equal(canonicalClosed.pagamentos.length, 1);
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: liveDiscountFixture.command.id } })).desconto.toString(), '2.5');
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: liveDiscountFixture.command.id } })).status, 'FECHADA');
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: liveItemCancelFixture.item.id } })).quantidade, 1);
const deliveredCancellation = await prisma.itemComandaCancelamentoEntregue.findMany({ where: { itemComandaId: liveDeliveredCancelFixture.item.id } });
assert.equal(deliveredCancellation.length, 1);
assert.equal(deliveredCancellation[0].quantidade, 1);
assert.equal(deliveredCancellation[0].usuarioId, staff.id);
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: liveCommandCancelFixture.command.id } })).status, 'CANCELADA');
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: liveCommandCancelRevokeFixture.command.id } })).status, 'ABERTA');
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveKitchenCancelFixture.order.id } })).status, 'CANCELAMENTO_PENDENTE');
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveKitchenCancelRevokeFixture.order.id } })).status, 'RECEBIDO');
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveRefundFixture.order.id } })).status, 'CANCELADO');
assert.ok((await prisma.pagamento.findMany({ where: { comandaId: liveRefundFixture.command.id } })).some((payment) => Number(payment.valor) < 0));
assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveRefundRevokeFixture.order.id } })).status, 'CANCELAMENTO_PENDENTE');
assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: liveDiscountRevokeFixture.command.id } })).status, 'ABERTA');
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: liveItemCancelRevokeFixture.item.id } })).quantidade, 2);
assert.equal((await prisma.itemComanda.findUniqueOrThrow({ where: { id: liveDeliveredCancelRevokeFixture.item.id } })).quantidade, 2);
} else {
  const focusedBrowserGrep = process.env.PDV_RBAC_TEST_GREP ?? '';
  if (focusedBrowserGrep.includes('kitchen.cancel')) {
    assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveKitchenCancelFixture.order.id } })).status, 'CANCELAMENTO_PENDENTE');
    assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveKitchenCancelRevokeFixture.order.id } })).status, 'RECEBIDO');
  }
  if (focusedBrowserGrep.includes('sale.refund')) {
    assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveRefundFixture.order.id } })).status, 'CANCELADO');
    assert.ok((await prisma.pagamento.findMany({ where: { comandaId: liveRefundFixture.command.id } })).some((payment) => Number(payment.valor) < 0));
    assert.equal((await prisma.pedidoOperacao.findUniqueOrThrow({ where: { id: liveRefundRevokeFixture.order.id } })).status, 'CANCELAMENTO_PENDENTE');
    assert.equal((await prisma.pagamento.count({ where: { comandaId: liveRefundRevokeFixture.command.id, valor: { lt: 0 } } })), 1);
  }
}
await app.close();
await prisma.$disconnect();

// Rehearse data preservation by removing only this candidate from the disposable
// schema history, inserting pre-migration employees, then deploying it again.
const { prisma: sharedPrisma } = await import('../src/lib/prisma.ts');
await sharedPrisma.$disconnect();
const dbBeforeMigration = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
await dbBeforeMigration.$executeRawUnsafe('ALTER TABLE public."Usuario" DROP COLUMN IF EXISTS "permissoesOperacao"');
await dbBeforeMigration.$executeRawUnsafe('DELETE FROM public."_prisma_migrations" WHERE migration_name IN ($1, $2, $3)', '20261007220000_individual_operational_permissions', '20261007230000_individual_module_permissions', '20261008090000_shift_catalog_permission');
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
for (const permission of ['command.read', 'command.operate', 'kitchen.read', 'kitchen.operate', 'inventory.read', 'inventory.adjust', 'clients.manage', 'taps.operate', 'event.menu.manage', 'catalog.shift.manage']) {
  assert.equal(legacyGrantedPermissions.includes(permission), true, `migration preserves prior attendant access to ${permission}`);
  assert.equal(legacyDeniedPermissions.includes(permission), true, `migration preserves prior attendant access to ${permission} without depending on discount`);
}
for (const permission of ['catalog.manage', 'agenda.manage']) {
  assert.equal(legacyGrantedPermissions.includes(permission), false, `migration does not grant prior owner-only action ${permission}`);
}
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
