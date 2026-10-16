import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { validateDevCutoverEnvironment, DEV_PDV_TENANT_ALLOWLIST } from './pdv-unico-dev-cutover-core.mjs';
import { validateProductionCutoverContext, PRODUCTION_PDV_TENANT_ALLOWLIST } from './pdv-unico-production-cutover.mjs';

export async function runPdvPrecommercePreparation({ env = process.env, args = process.argv.slice(2), dependencies = {} } = {}) {
  const profile = env.PDV_CUTOVER_PROFILE ?? 'qa';
  let databaseUrl;
  if (profile === 'qa') databaseUrl = validateIsolatedQaEnvironment(env).toString();
  else if (profile === 'dev') {
    validateDevCutoverEnvironment(env);
    if (env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('DEV preparation may run only through its guarded adapter.');
    databaseUrl = env.DATABASE_URL;
  } else if (profile === 'production') {
    await (dependencies.validateProductionContext ?? validateProductionCutoverContext)({ env });
    databaseUrl = env.DATABASE_URL;
  } else throw new Error('Pre-commerce preparation accepts only QA, DEV, or the validated production profile.');
  if (env.DATABASE_URL !== databaseUrl) throw new Error('Pre-commerce preparation requires an exact validated target.');
  const clientPath = profile === 'qa' ? env.PDV_QA_PRISMA_CLIENT : env.PDV_CUTOVER_PRISMA_CLIENT;
  if (!clientPath) throw new Error('A generated target Prisma client is required.');
  const tempRoot = path.resolve(env.TEMP ?? env.TMP ?? '');
  const clientDir = path.resolve(clientPath);
  if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Generated Prisma client must live inside this run temporary directory.');
  const tenantIds = (env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
  const allowlist = profile === 'production' ? PRODUCTION_PDV_TENANT_ALLOWLIST : DEV_PDV_TENANT_ALLOWLIST;
  assert.deepEqual([...tenantIds].sort(), allowlist.map(({ id }) => id).sort(), 'pre-commerce preparation requires the exact two-tenant allowlist');

  const { PrismaClient } = dependencies.PrismaClient
    ? { PrismaClient: dependencies.PrismaClient }
    : await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
  const db = dependencies.db ?? new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
  const { runPdvBusinessMigration } = dependencies.businessMigrator ?? await import('./pdv-unico-business-migrator.ts');
  const catalog = dependencies.catalogMigrator ?? await import('./pdv-unico-catalog-migrator.ts');
  const runPdvCatalogMigration = catalog.runPdvCatalogMigration;
  const runPdvKitchenOrderContextPreparation = catalog.runPdvKitchenOrderContextPreparation;
  const targets = allowlist;
  const report = [];
  const runId = env.PDV_CUTOVER_RUN_ID ?? `tap76-precommerce-${randomBytes(8).toString('hex')}`;
  async function stage(target, phase, action) {
    const start = performance.now();
    process.stdout.write(`PDV_PRECOMMERCE_START tenant=${target.name} phase=${phase}\n`);
    const result = await action();
    const durationMs = Math.round(performance.now() - start);
    process.stdout.write(`PDV_PRECOMMERCE_END tenant=${target.name} phase=${phase} status=${result.status} durationMs=${durationMs}\n`);
    if (result.status !== 'COMPLETED') throw Object.assign(new Error(`${target.name} ${phase} blocked: ${JSON.stringify(result)}`), { result, target: target.name, phase });
    report.push({ tenantId: target.id, tenant: target.name, phase, status: result.status, runId: result.runId ?? null, durationMs, counts: result.counts ?? result.scopeCounts ?? result.checkpoint?.scopeCounts ?? null });
    return result;
  }
  try {
    for (const target of targets) {
      const points = await db.pontoVenda.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
      const trailers = await db.trailer.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
      if (points.length > 1 || (points.length === 0 && trailers.length !== 1) || trailers.length > 1) throw new Error(`${target.name}: canonical PDV decision required; refusing to merge or choose automatically.`);
      if (!args.includes('--kitchen')) await stage(target, 'business', () => runPdvBusinessMigration({ db, companyId: target.id, runId: `${runId}-${target.id}-business` }));
      const pointRows = await db.pontoVenda.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
      const pointId = pointRows[0]?.id ?? trailers[0].id;
      if (!args.includes('--kitchen')) await stage(target, 'catalog', () => runPdvCatalogMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-catalog` }));
      if (!args.includes('--business-catalog')) await stage(target, 'kitchen-preparation', () => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-preparation` }));
    }
    return { status: 'COMPLETED', profile, order: ['business', 'catalog', 'kitchen-preparation'], report };
  } finally { if (!dependencies.db) await db.$disconnect(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runPdvPrecommercePreparation();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
