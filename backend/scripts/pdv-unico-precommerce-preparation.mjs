import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const qaUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== qaUrl || !process.env.PDV_QA_PRISMA_CLIENT) throw new Error('Pre-commerce preparation requires the exact isolated QA URL and generated QA client.');
const clientDir = path.resolve(process.env.PDV_QA_PRISMA_CLIENT);
if (!clientDir.startsWith(path.resolve(process.env.TEMP ?? process.env.TMP) + path.sep)) throw new Error('QA Prisma client must live in OS temp.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: qaUrl } }, errorFormat: 'minimal' });
const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
const { runPdvCatalogMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');
const targets = [
  { label: 'CIA Marítima', id: 'cmr9yis3c0000hvu00q9fe7y1' },
  { label: 'Churrasquinho do Thiago', id: 'cmsry9xrn0000hvlgopjxy0oo' },
];
const report = [];
const runId = `tap76-precommerce-${randomBytes(8).toString('hex')}`;
async function stage(target, phase, action) {
  const start = performance.now();
  process.stdout.write(`PDV_PRECOMMERCE_START tenant=${target.label} phase=${phase}\n`);
  const result = await action();
  const durationMs = Math.round(performance.now() - start);
  process.stdout.write(`PDV_PRECOMMERCE_END tenant=${target.label} phase=${phase} status=${result.status} durationMs=${durationMs}\n`);
  if (result.status !== 'COMPLETED') throw Object.assign(new Error(`${target.label} ${phase} blocked: ${JSON.stringify(result)}`), { result, target: target.label, phase });
  report.push({ tenant: target.label, phase, status: result.status, durationMs, counts: result.counts ?? result.scopeCounts ?? result.checkpoint?.scopeCounts ?? null });
  return result;
}
try {
  for (const target of targets) {
    const points = await db.pontoVenda.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
    const trailers = await db.trailer.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
    if (points.length > 1 || (points.length === 0 && trailers.length !== 1) || trailers.length > 1) throw new Error(`${target.label}: canonical PDV decision required; refusing to merge or choose automatically.`);
    await stage(target, 'business', () => runPdvBusinessMigration({ db, companyId: target.id, runId: `${runId}-${target.id}-business` }));
    const pointRows = await db.pontoVenda.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
    const pointId = pointRows[0]?.id ?? trailers[0].id;
    await stage(target, 'catalog', () => runPdvCatalogMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-catalog` }));
    await stage(target, 'kitchen-preparation', () => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-preparation` }));
  }
  process.stdout.write(`${JSON.stringify({ status: 'COMPLETED', qaDatabase: 'cervejaria_qa_pdv_unico', order: ['source-schema-migrations', 'restore-source-photo', 'minimum-migrations-through-20261004150000', 'business', 'catalog', 'kitchen-preparation', 'dependent-and-remaining-migrations', 'taps', 'sessions', 'finance', 'commerce', 'canonical-category-transform', 'replays-and-reconciliation'], report })}\n`);
} finally { await db.$disconnect(); }
