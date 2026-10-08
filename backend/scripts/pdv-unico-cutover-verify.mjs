import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

if (process.env.PDV_CUTOVER_PROFILE !== 'dev' || process.env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('Receipt verification is restricted to the guarded DEV adapter.');
validateDevCutoverEnvironment(process.env);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const tenantIds = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...tenantIds].sort(), DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort());
const clientDir = path.resolve(process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Receipt verification Prisma client escaped this run temp directory.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Could not read reviewed Git migration blobs for receipt verification.');
  return result.stdout;
}
const revision = git(['rev-parse', 'HEAD']).trim();
const migrationFiles = git(['ls-tree', '-r', '--name-only', revision, '--', 'backend/prisma/migrations']).split(/\r?\n/).filter((name) => name.endsWith('/migration.sql'));
const migrationNames = [...new Set(migrationFiles.map((name) => name.split('/').at(-2)))].sort();
const migrationsSha256 = createHash('sha256').update(migrationFiles.map((name) => `${name}\0${git(['rev-parse', `${revision}:${name}`]).trim()}`).join('\n')).digest('hex');
const command = process.argv[2];
try {
  const output = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    if (command === 'minimal-prerequisite-migrations' || command === 'dependent-migrations-with-original-preflight') {
      const rows = await tx.$queryRawUnsafe('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name');
      const successful = new Map(rows.filter((row) => row.finished && !row.rolled_back).map((row) => [row.migration_name, row.checksum]));
      const through = command === 'minimal-prerequisite-migrations' ? '20261004150000_pdv_finance_session_link' : migrationNames.at(-1);
      const expectedNames = migrationNames.filter((name) => name <= through);
      const missing = expectedNames.filter((name) => !successful.has(name));
      const unknown = rows.filter((row) => row.finished && !row.rolled_back && !migrationNames.includes(row.migration_name)).map((row) => row.migration_name);
      const pending = rows.filter((row) => !row.finished && !row.rolled_back).map((row) => row.migration_name);
      if (missing.length || unknown.length || pending.length) return { status: 'BLOCKED', missing, unknown, pending, revision, migrationsSha256 };
      return { status: 'PASS', migrationCount: expectedNames.length, expectedThrough: through, revision, migrationsSha256 };
    }
    if (command === 'migrator-runs') {
      const request = JSON.parse(process.argv[3] ?? '{}');
      if (!Array.isArray(request.runs) || !request.runs.length) return { status: 'BLOCKED', code: 'RECEIPT_HAS_NO_MIGRATOR_RUN_IDS' };
      const runs = await tx.pdvMigrationRun.findMany({ where: { id: { in: request.runs } }, select: { id: true, scope: true, cervejariaId: true, pontoVendaId: true, status: true, checkpoint: true } });
      if (runs.length !== request.runs.length || runs.some((row) => row.status !== 'COMPLETED' || !tenantIds.includes(row.cervejariaId))) return { status: 'BLOCKED', code: 'MIGRATOR_RUN_OR_TENANT_DIVERGENCE' };
      for (const expected of request.expectedRuns ?? []) {
        const actual = runs.find((row) => row.id === expected.runId);
        if (!actual || actual.scope !== expected.scope || actual.cervejariaId !== expected.tenantId) return { status: 'BLOCKED', code: 'MIGRATOR_SCOPE_DIVERGENCE', runId: expected.runId };
      }
      const batches = await tx.pdvMigrationBatch.findMany({ where: { runId: { in: request.runs } }, select: { runId: true, status: true, checkpoint: true }, orderBy: [{ runId: 'asc' }, { sequence: 'asc' }] });
      if (batches.some((row) => row.status !== 'CONFIRMED' || !Array.isArray(row.checkpoint?.receipts) || row.checkpoint.receipts.length === 0)) return { status: 'BLOCKED', code: 'MIGRATOR_BATCH_RECEIPT_DIVERGENCE' };
      let unlinkedCategories = 0;
      if (request.categories) unlinkedCategories = await tx.produto.count({ where: { cervejariaId: { in: tenantIds }, categoria: { not: null }, categoriaPdvId: null } });
      if (unlinkedCategories) return { status: 'BLOCKED', code: 'CATEGORY_LINK_DIVERGENCE', unlinkedCategories };
      return { status: 'PASS', runs: runs.map(({ id, scope, cervejariaId, pontoVendaId, checkpoint }) => ({ id, scope, tenantId: cervejariaId, pointId: pontoVendaId, cursor: checkpoint?.cursor ?? null })), batches: batches.length, categories: request.categories ? 'RECONCILED' : undefined };
    }
    return { status: 'BLOCKED', code: 'UNKNOWN_PHASE' };
  }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (output.status !== 'PASS') process.exitCode = 2;
} finally { await db.$disconnect(); }
