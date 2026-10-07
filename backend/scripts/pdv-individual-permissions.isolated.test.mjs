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
const [{ PrismaClient }, { buildApp }, { hashPassword }] = await Promise.all([
  import('@prisma/client'), import('../src/app.ts'), import('../src/lib/utils.ts'),
]);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const suffix = randomBytes(6).toString('hex');
const app = await buildApp();
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

// The owner has integral authority; the attendant has no powers by default.
const ownerReport = await app.inject({ method: 'GET', url: '/api/relatorios/evento/not-found', headers: authHeaders(ownerCookie) });
assert.equal(ownerReport.statusCode, 404, ownerReport.body);
const deniedReport = await app.inject({ method: 'GET', url: '/api/relatorios/evento/not-found', headers: authHeaders(staffCookie) });
assert.equal(deniedReport.statusCode, 403, deniedReport.body);

// Grant one permission, use the same already-authenticated cookie, then revoke it.
const grantDashboard = await app.inject({ method: 'PATCH', url: `/api/usuarios/${staff.id}/permissoes-operacao`, headers: authHeaders(ownerCookie), payload: { permissoesOperacao: ['dashboard.read'] } });
assert.equal(grantDashboard.statusCode, 200, grantDashboard.body);
const grantedDashboard = await app.inject({ method: 'GET', url: '/api/cervejaria/dashboard', headers: authHeaders(staffCookie) });
assert.notEqual(grantedDashboard.statusCode, 403, grantedDashboard.body);
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
const cashSession = await prisma.sessaoCaixaOperacao.create({
  data: {
    cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: new Date('2026-10-07T00:00:00.000Z'),
    status: 'ABERTO', trocoInicial: '123.45', abertoPorId: staff.id,
  },
  select: { id: true },
});
const restrictedCash = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${point.id}`, headers: authHeaders(staffCookie) });
assert.equal(restrictedCash.statusCode, 200, restrictedCash.body);
const restrictedCashBody = JSON.parse(restrictedCash.body);
assert.equal(restrictedCashBody.sessao.id, cashSession.id);
assert.equal(restrictedCashBody.valoresRestritos, true);
for (const restrictedField of ['trocoInicial', 'totalVendas', 'movimentos', '123.45']) {
  assert.equal(restrictedCash.body.includes(restrictedField), false, `restricted cash response leaked ${restrictedField}`);
}
const deniedClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: authHeaders(staffCookie), payload: { pontoVendaId: point.id, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
assert.equal(deniedClose.statusCode, 403, deniedClose.body);
assert.equal((await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, select: { status: true, fechadoEm: true } })).fechadoEm, null, 'denied close leaves session open');

// The API response exposes the persisted list, including an explicit empty list.
const listed = await app.inject({ method: 'GET', url: '/api/usuarios', headers: authHeaders(ownerCookie) });
assert.equal(listed.statusCode, 200, listed.body);
assert.deepEqual(JSON.parse(listed.body).find((user) => user.id === staff.id).permissoesOperacao, ['cash.open']);

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
assert.deepEqual((await dbAfterMigration.usuario.findUniqueOrThrow({ where: { id: legacyGrantedId }, select: { permissoesOperacao: true } })).permissoesOperacao.includes('discount.apply'), true);
assert.deepEqual((await dbAfterMigration.usuario.findUniqueOrThrow({ where: { id: legacyDeniedId }, select: { permissoesOperacao: true } })).permissoesOperacao.includes('discount.apply'), false);
assert.deepEqual((await dbAfterMigration.usuario.findUniqueOrThrow({ where: { id: legacyDeniedId }, select: { permissoesOperacao: true } })).permissoesOperacao.includes('cash.open'), true);
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
await legacyApp.close();
await new Client({ datasources: { db: { url: databaseUrl } } }).$disconnect();
await sharedPrisma.$disconnect();
await rm(process.env.UPLOADS_DIR, { recursive: true, force: true });
console.log('PDV_INDIVIDUAL_PERMISSIONS_QA=PASS; auth/revoke/tenant/self-edit/unknown/no-write/pre-column checks completed on disposable PostgreSQL');
process.exit(0);
