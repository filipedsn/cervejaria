import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

const profile = process.env.PDV_CUTOVER_PROFILE;
const databaseUrl = profile === 'qa'
  ? validateIsolatedQaEnvironment(process.env).toString()
  : profile === 'dev' && process.env.PDV_CUTOVER_DEV_ADAPTER === '1'
    ? (validateDevCutoverEnvironment(process.env), process.env.DATABASE_URL)
    : null;
if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error('Commercial preflight requires its profile-specific validated database target.');
const clientDir = path.resolve(profile === 'qa' ? process.env.PDV_QA_PRISMA_CLIENT ?? '' : process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Commercial preflight Prisma client must live in the run temp directory.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
try {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const tenants = await tx.cervejaria.findMany({ select: { id: true } });
    if (!tenants.length) throw new Error('All-tenant commercial preflight found no tenant coverage.');
    const ledger = await tx.$queryRawUnsafe('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
    const incompleteConstraints = await tx.$queryRawUnsafe("SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace IN ('public'::regnamespace,'quiosque'::regnamespace) ORDER BY conname");
    const kitchenContextDivergence = await tx.$queryRawUnsafe('SELECT movement."pedidoId", movement."cervejariaId" AS "movementTenant", movement."pontoVendaId" AS "movementPdv", order_row."cervejariaId" AS "orderTenant", order_row."pontoVendaId" AS "orderPdv" FROM "quiosque"."MovimentoEstoqueQuiosque" movement JOIN "quiosque"."PedidoQuiosque" order_row ON order_row."id" = movement."pedidoId" WHERE movement."pedidoId" IS NOT NULL AND (order_row."cervejariaId" IS DISTINCT FROM movement."cervejariaId" OR order_row."pontoVendaId" IS DISTINCT FROM movement."pontoVendaId") ORDER BY movement."pedidoId" LIMIT 50');
    const status = ledger.length || incompleteConstraints.length || kitchenContextDivergence.length ? 'BLOCKED' : 'CLEAR';
    return { status, queried: true, transaction: 'RepeatableRead READ ONLY', tenantCount: tenants.length, coveredTenantCount: tenants.length, incompleteMigrations: ledger, incompleteConstraints, kitchenContextDivergence };
  }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'CLEAR') process.exitCode = 2;
} finally {
  await db.$disconnect();
}
