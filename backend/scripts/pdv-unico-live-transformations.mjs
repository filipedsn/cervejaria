import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.env.PDV_CUTOVER_PROFILE;
const databaseUrl = profile === 'qa'
  ? validateIsolatedQaEnvironment(process.env).toString()
  : (profile === 'dev' ? (validateDevCutoverEnvironment(process.env), process.env.DATABASE_URL) : null);
if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error('Transformations require an exact QA or validated DEV target.');
if (profile === 'dev' && process.env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('DEV transformations may only run through the guarded cutover adapter.');
const clientDir = path.resolve(profile === 'qa' ? process.env.PDV_QA_PRISMA_CLIENT ?? '' : process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Generated Prisma client must be inside this run temporary directory.');
const tenantIds = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...tenantIds].sort(), DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort(), 'transformation adapter requires the reviewed complete tenant allowlist');
const runId = process.env.PDV_CUTOVER_RUN_ID;
if (!runId || !/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error('A stable run ID is required for resumable migrator runs.');
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE ?? '');
const photoBytes = await readFile(photoPath);
const photoSha256 = createHash('sha256').update(photoBytes).digest('hex');
assert.equal(photoSha256, '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b', 'approved source photo must remain byte-identical');
const approval = JSON.parse(await readFile(path.join(backendRoot, 'scripts/pdv-unico-historical-no-session-approval.json'), 'utf8'));
assert.equal(approval.sourcePhotoSha256, photoSha256);
assert.equal(createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex'), approval.approvedSnapshotSha256);
assert.equal(approval.entries.length, 577, 'the approved class-C payment set is immutable');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
const { runPdvTapOwnershipMigration } = await import('./pdv-unico-tap-migrator.ts');
const { runPdvSessionMigration, runPdvFinanceMigration, runPdvCommerceMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');

async function execute(name, phase, action) {
  const started = performance.now();
  process.stdout.write(`PDV_LIVE_TRANSFORM_START tenant=${name} phase=${phase}\n`);
  const result = await action();
  if (result?.status !== 'COMPLETED') throw new Error(`${name} ${action.name} was ${result?.status ?? 'missing'}: ${JSON.stringify(result).slice(0, 1600)}`);
  return { phase, status: result.status, durationMs: Math.round(performance.now() - started), runId: result.runId ?? null, counts: result.counts ?? result.scopeCounts ?? null, reusedCompletedRun: result.reusedCompletedRun === true };
}

try {
  const tenants = [];
  for (const tenantId of tenantIds) {
    const approvedTenant = DEV_PDV_TENANT_ALLOWLIST.find(({ id }) => id === tenantId);
    const points = await db.pontoVenda.findMany({ where: { cervejariaId: tenantId }, select: { id: true } });
    if (points.length !== 1) throw new Error(`${approvedTenant.name}: exactly one canonical PDV is required before TAP/session/finance/commerce migrations.`);
    const pointId = points[0].id;
    const tenantRun = `${runId}-${tenantId}`;
    const phases = [];
    phases.push(await execute(approvedTenant.name, 'taps', () => runPdvTapOwnershipMigration({ db, companyId: tenantId, pointId, runId: `${tenantRun}-taps` })));
    const runBatched = async (name, migrate, extra = {}) => {
      const migrationRunId = `${tenantRun}-${name}`;
      const first = await migrate({ db, companyId: tenantId, pointId, runId: migrationRunId, maxBatches: 1, ...extra });
      let result = first;
      if (result.status === 'RUNNING') result = await migrate({ db, companyId: tenantId, pointId, runId: migrationRunId, ...extra });
      if (result.status !== 'COMPLETED') throw new Error(`${approvedTenant.name} ${name} migration blocked: ${JSON.stringify(result).slice(0, 1600)}`);
      const replay = await migrate({ db, companyId: tenantId, pointId, runId: migrationRunId, ...extra });
      if (replay.status !== 'COMPLETED') throw new Error(`${approvedTenant.name} ${name} replay blocked: ${JSON.stringify(replay).slice(0, 1600)}`);
      return { phase: name, status: 'COMPLETED', runId: migrationRunId, firstStatus: first.status, resumed: first.status === 'RUNNING', replayStatus: replay.status, counts: result.counts ?? result.scopeCounts ?? null };
    };
    phases.push(await runBatched('sessions', runPdvSessionMigration));
    phases.push(await runBatched('finance', runPdvFinanceMigration, {
      historicalNoSessionApproval: approval,
    }));
    phases.push(await runBatched('kitchen-before-commerce', runPdvKitchenOrderContextPreparation));
    phases.push(await runBatched('commerce', runPdvCommerceMigration));
    phases.push(await runBatched('finance-revalidation-after-commerce', runPdvFinanceMigration, {
      historicalNoSessionApproval: approval,
    }));
    phases.push(await runBatched('kitchen-revalidation', runPdvKitchenOrderContextPreparation));
    tenants.push({ tenantId, tenant: approvedTenant.name, pointId, status: 'PASS', phases });
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', profile, photoSha256, approvedClassCPayments: approval.entries.length, tenants })}\n`);
} finally {
  await db.$disconnect();
}
