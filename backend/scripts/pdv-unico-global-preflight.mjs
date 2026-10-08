import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDevCutoverEnvironment, DEV_PDV_TENANT_ALLOWLIST } from './pdv-unico-dev-cutover-core.mjs';

// This helper is launched only after URL validation and compatible client generation.
validateDevCutoverEnvironment(process.env);
const { PrismaClient } = await import(pathToFileURL(path.join(process.env.PDV_INVENTORY_PRISMA_CLIENT, 'index.js')).href);
const { captureRepresentativeTenantPhoto } = await import('./pdv-unico-representative-photo.ts');
const bytes = await readFile(process.env.PDV_REPRESENTATIVE_PHOTO_FILE);
if (createHash('sha256').update(bytes).digest('hex') !== '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b') throw new Error('Unapproved source photo.');
const approved = JSON.parse(bytes);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
const stable = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
try {
  const report = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const tenants = await tx.cervejaria.findMany({ select: { id: true } });
    if (!tenants.length) throw new Error('No tenant coverage.');
    const ledger = await tx.$queryRawUnsafe('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name');
    const constraints = await tx.$queryRawUnsafe("SELECT conname, conrelid::regclass::text AS relation FROM pg_constraint WHERE NOT convalidated AND connamespace IN ('public'::regnamespace,'quiosque'::regnamespace) ORDER BY conname");
    const disagreement = await tx.$queryRawUnsafe('SELECT m."cervejariaId" AS "tenantId", count(*)::int AS count FROM quiosque."MovimentoEstoqueQuiosque" m JOIN quiosque."PedidoQuiosque" p ON p.id=m."pedidoId" WHERE p."cervejariaId" IS DISTINCT FROM m."cervejariaId" OR p."pontoVendaId" IS DISTINCT FROM m."pontoVendaId" GROUP BY m."cervejariaId"');
    const coverage = [];
    for (const tenant of tenants) {
      const points = await tx.pontoVenda.findMany({ where: { cervejariaId: tenant.id }, select: { id: true } });
      const trailers = await tx.trailer.findMany({ where: { cervejariaId: tenant.id }, select: { id: true } });
      coverage.push({ tenantId: tenant.id, points: points.map(p => p.id), trailers: trailers.map(p => p.id), status: points.length > 1 || trailers.length > 1 ? 'BLOCKED' : 'CLEAR', code: points.length > 1 || trailers.length > 1 ? 'UNIT_DECISION_REQUIRED' : 'UNIT_SCOPE_CHECKED' });
    }
    const runId = path.basename(process.env.PDV_REPRESENTATIVE_PHOTO_FILE).replace(/^tap76-pdv-photo-/, '').replace(/\.json$/, '');
    const current = await captureRepresentativeTenantPhoto(tx, DEV_PDV_TENANT_ALLOWLIST.map(t => ({ id: t.id, label: t.name })), runId);
    const comparisons = [];
    const key = (table, row) => stable(table.primaryKey.map(field => row[field]));
    for (const table of approved.tableRows) {
      const actual = current.tableRows.find(t => t.model === table.model);
      const prior = new Map(table.rows.map(row => [key(table, row), stable(row)]));
      const next = new Map((actual?.rows ?? []).map(row => [key(table, row), stable(row)]));
      const changed = [...prior].filter(([id, row]) => next.get(id) !== row).length;
      const added = [...next.keys()].filter(id => !prior.has(id)).length;
      comparisons.push({ model: table.model, original: prior.size, current: next.size, changedOrMissing: changed, added, status: changed || added ? 'BLOCKED' : 'CLEAR' });
    }
    for (const table of current.tableRows.filter(t => !approved.tableRows.some(p => p.model === t.model))) comparisons.push({ model: table.model, added: table.rows.length, status: 'BLOCKED' });
    const blocked = coverage.some(t => t.status !== 'CLEAR') || disagreement.length || constraints.length || ledger.some(m => !m.finished && !m.rolled_back) || comparisons.some(t => t.status !== 'CLEAR') || current.crossTenantEdges.length;
    return { status: blocked ? 'BLOCKED' : 'CLEAR', transaction: 'RepeatableRead READ ONLY', queried: true, tenantCount: tenants.length, coveredTenantCount: coverage.length, ledger, constraints, disagreement, coverage, sourceComparisons: comparisons, crossTenantEdges: current.crossTenantEdges.length, globalDdlImpact: 'Additive tables/columns/indexes and restrictive inventory tenant/PDV FKs affect every tenant; no unit choice is authorized.' };
  }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
