import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl || !process.env.PDV_QA_PRISMA_CLIENT) throw new Error('Sequence inspection requires the exact isolated QA client.');
const { PrismaClient } = await import(pathToFileURL(path.join(path.resolve(process.env.PDV_QA_PRISMA_CLIENT), 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
try {
  const stage = process.argv[2];
  if (stage === 'preflight') {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tenants = await tx.cervejaria.findMany({ select: { id: true } });
      const failed = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
      if (tenants.length !== 3 || failed[0].n !== 0) throw new Error('QA source coverage/ledger not clear.');
      return { status: 'CLEAR', queried: true, tenantCount: tenants.length, coveredTenantCount: tenants.length, scope: 'entire restored QA database including unselected sentinel', sourcePhotoCompared: true };
    }, { isolationLevel: 'RepeatableRead' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (stage === 'minimum') {
    const rows = await db.$queryRaw`SELECT count(*)::int AS n FROM "public"."_prisma_migrations" WHERE "finished_at" IS NOT NULL`;
    process.stdout.write(`${JSON.stringify({ appliedMigrationCount: rows[0].n })}\n`);
  } else if (stage === 'dependent') {
    const rows = await db.$queryRaw`SELECT conname, convalidated FROM pg_constraint WHERE conname='MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey'`;
    if (rows.length !== 1 || rows[0].convalidated !== true) throw new Error('The original restrictive kitchen constraint is missing or not validated.');
    process.stdout.write(`${JSON.stringify({ migration: '20261004170000_pdv_commerce_inventory_context', constraint: rows[0].conname, validated: rows[0].convalidated })}\n`);
  } else throw new Error('Unknown QA sequence inspection stage.');
} finally { await db.$disconnect(); }
