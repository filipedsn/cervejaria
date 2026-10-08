import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DEV_PDV_TENANT_ALLOWLIST, assertTenantActivationReady, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

if (process.env.PDV_CUTOVER_PROFILE !== 'dev' || process.env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('Tenant readiness is restricted to the guarded DEV adapter.');
const databaseUrl = process.env.DATABASE_URL;
validateDevCutoverEnvironment(process.env);
const selected = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...selected].sort(), DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort());
const activeSelector = (process.env.PDV_CANONICAL_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...activeSelector].sort(), [...selected].sort(), 'only the explicit selected tenants may enter the canonical runtime selector');
const clientDir = path.resolve(process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Readiness Prisma client must stay under the run temp directory.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
const ownerOnlyPermissions = ['command.cancel', 'kitchen.cancel', 'sale.refund', 'catalog.manage', 'agenda.manage'];
const readiness = [];
try {
  for (const tenantId of selected) {
    const tenant = DEV_PDV_TENANT_ALLOWLIST.find(({ id }) => id === tenantId);
    const [points, configurations, users, products] = await Promise.all([
      db.pontoVenda.findMany({ where: { cervejariaId: tenantId }, select: { id: true } }),
      db.configuracaoPontoVenda.findMany({ where: { cervejariaId: tenantId } }),
      db.usuario.findMany({ where: { cervejariaId: tenantId }, select: { papel: true, permissoesOperacao: true } }),
      db.produto.findMany({ where: { cervejariaId: tenantId }, select: { id: true, categoria: true, categoriaPdvId: true, categoriaPdv: { select: { id: true, cervejariaId: true, gamificada: true } } } }),
    ]);
    const unlinkedProducts = products.filter((row) => row.categoria?.trim() && !row.categoriaPdvId).length;
    const invalidCategoryLinks = products.filter((row) => row.categoriaPdvId && (row.categoriaPdv?.id !== row.categoriaPdvId || row.categoriaPdv.cervejariaId !== tenantId || row.categoriaPdv.gamificada !== false)).length;
    const ownerExclusiveGrantCount = users.reduce((sum, user) => sum + user.permissoesOperacao.filter((permission) => ownerOnlyPermissions.includes(permission)).length, 0);
    const config = configurations.length === 1 ? configurations[0] : null;
    const result = assertTenantActivationReady({
      tenantId, pointIds: points.map(({ id }) => id), configuration: config,
      permissionReadiness: { status: 'PASS', ownerExclusiveGrantCount },
      categoryReadiness: { status: unlinkedProducts === 0 && invalidCategoryLinks === 0 ? 'PASS' : 'BLOCKED', unlinkedProducts: unlinkedProducts + invalidCategoryLinks },
    });
    readiness.push({ tenant: tenant.name, ...result, products: products.length, status: 'PASS' });
  }
  process.stdout.write(`${JSON.stringify({ status: 'READY', activationSelector: 'PDV_CANONICAL_TENANTS', selectedTenants: selected, tenants: readiness, writes: 0 })}\n`);
} finally { await db.$disconnect(); }
