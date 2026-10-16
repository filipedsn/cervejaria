import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';
import { assertClassCSourceMatchesApproval, validateClassCAuthorization } from '../../scripts/prod/pdv-class-c-authorization.mjs';
import { PRODUCTION_PDV_TENANT_ALLOWLIST, validateProductionCutoverContext } from './pdv-unico-production-cutover.mjs';
import { applyApprovedClassCOutOfScopeDisposition } from './pdv-unico-class-c-out-of-scope-disposition.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_PHOTO_SHA256 = '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b';

function parseJson(bytes) {
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

async function readApprovalAndPhoto({ env, profile, productionContext, readFileImpl }) {
  if (profile === 'production') {
    // Production is bound to the synchronized checkpoint and exact source facts;
    // the historic representative photo is not an input to this approval.
    return { approval: productionContext.approval, photoSha256: null, productionAuthorization: productionContext.productionAuthorization };
  }
  const photoPath = path.resolve(env.PDV_REPRESENTATIVE_PHOTO_FILE ?? '');
  const photoBytes = await readFileImpl(photoPath);
  const photoSha256 = createHash('sha256').update(photoBytes).digest('hex');
  assert.equal(photoSha256, APPROVED_PHOTO_SHA256, 'approved source photo must remain byte-identical');

  const approvalPath = env.PDV_CUTOVER_CLASS_C_APPROVAL_FILE
    ? path.resolve(env.PDV_CUTOVER_CLASS_C_APPROVAL_FILE)
    : path.join(backendRoot, 'scripts/pdv-unico-historical-no-session-approval.json');
  const approval = parseJson(await readFileImpl(approvalPath));
  if (profile === 'qa') {
    const sourceBackupSha256 = env.PDV_CUTOVER_ORIGIN_BACKUP_SHA256;
    if (!env.PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE) throw new Error('PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE is required for QA.');
    const sourceEntries = parseJson(await readFileImpl(path.resolve(env.PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE)));
    validateClassCAuthorization({ mode: 'qa', approval, originBackupSha256: sourceBackupSha256 });
    assertClassCSourceMatchesApproval({ approval, sourceEntries });
    approval.sourceBackupSha256 = sourceBackupSha256;
    return { approval, photoSha256, qaSourceBackupSha256: sourceBackupSha256 };
  }

  assert.equal(approval.sourcePhotoSha256, photoSha256);
  assert.equal(createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex'), approval.approvedSnapshotSha256);
  assert.equal(approval.entries.length, 577, 'the historical DEV class-C policy remains pinned to its original set');
  return { approval, photoSha256 };
}

async function loadDefaultMigrations() {
  const tap = await import('./pdv-unico-tap-migrator.ts');
  const catalog = await import('./pdv-unico-catalog-migrator.ts');
  return {
    runPdvTapOwnershipMigration: tap.runPdvTapOwnershipMigration,
    runPdvSessionMigration: catalog.runPdvSessionMigration,
    runPdvFinanceMigration: catalog.runPdvFinanceMigration,
    runPdvCommerceMigration: catalog.runPdvCommerceMigration,
    runPdvKitchenOrderContextPreparation: catalog.runPdvKitchenOrderContextPreparation,
  };
}

/** The real entrypoint. Dependencies are injectable only for isolated guard/forwarding tests. */
export async function runLiveTransformations({ env = process.env, dependencies = {}, write = (text) => process.stdout.write(text) } = {}) {
  const profile = env.PDV_CUTOVER_PROFILE;
  let databaseUrl;
  let productionContext;
  if (profile === 'qa') databaseUrl = validateIsolatedQaEnvironment(env).toString();
  else if (profile === 'dev') {
    validateDevCutoverEnvironment(env);
    databaseUrl = env.DATABASE_URL;
  } else if (profile === 'production') {
    productionContext = await validateProductionCutoverContext({ env, readFileImpl: dependencies.readFile ?? readFile });
    databaseUrl = env.DATABASE_URL;
  }
  if (!databaseUrl || env.DATABASE_URL !== databaseUrl) throw new Error('Transformations require an exact QA, validated DEV, or guarded production target.');
  if (profile === 'dev' && env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('DEV transformations may only run through the guarded cutover adapter.');

  const clientDir = path.resolve(profile === 'qa' ? env.PDV_QA_PRISMA_CLIENT ?? '' : env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
  const tempRoot = path.resolve(env.TEMP ?? env.TMP ?? '');
  if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Generated Prisma client must be inside this run temporary directory.');
  const prismaEntry = path.join(clientDir, 'index.js');
  await (dependencies.access ?? access)(prismaEntry);

  const tenantIds = (env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
  const tenantAllowlist = profile === 'production' ? PRODUCTION_PDV_TENANT_ALLOWLIST : DEV_PDV_TENANT_ALLOWLIST;
  assert.deepEqual([...tenantIds].sort(), tenantAllowlist.map(({ id }) => id).sort(), 'transformation adapter requires the reviewed complete tenant allowlist');
  const runId = env.PDV_CUTOVER_RUN_ID;
  if (!runId || !/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error('A stable run ID is required for resumable migrator runs.');

  const readFileImpl = dependencies.readFile ?? readFile;
  const { approval, photoSha256, qaSourceBackupSha256, productionAuthorization } = await readApprovalAndPhoto({ env, profile, productionContext, readFileImpl });
  const db = dependencies.createDb
    ? await dependencies.createDb({ databaseUrl, prismaEntry, profile })
    : await (async () => {
      const { PrismaClient } = await import(pathToFileURL(prismaEntry).href);
      return new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
    })();
  const migrations = dependencies.migrations ?? await loadDefaultMigrations();

  async function execute(name, phase, action) {
    const started = performance.now();
    write(`PDV_LIVE_TRANSFORM_START tenant=${name} phase=${phase}\n`);
    const result = await action();
    if (result?.status !== 'COMPLETED') throw new Error(`${name} ${action.name} was ${result?.status ?? 'missing'}: ${JSON.stringify(result).slice(0, 1600)}`);
    return { phase, status: result.status, durationMs: Math.round(performance.now() - started), runId: result.runId ?? null, counts: result.counts ?? result.scopeCounts ?? null, reusedCompletedRun: result.reusedCompletedRun === true };
  }

  try {
    const tenants = [];
    for (const tenantId of tenantIds) {
      const approvedTenant = tenantAllowlist.find(({ id }) => id === tenantId);
      const points = await db.pontoVenda.findMany({ where: { cervejariaId: tenantId }, select: { id: true } });
      if (points.length !== 1) throw new Error(`${approvedTenant.name}: exactly one canonical PDV is required before TAP/session/finance/commerce migrations.`);
      const pointId = points[0].id;
      const tenantRun = `${runId}-${tenantId}`;
      const phases = [];
      phases.push(await execute(approvedTenant.name, 'taps', () => migrations.runPdvTapOwnershipMigration({ db, companyId: tenantId, pointId, runId: `${tenantRun}-taps` })));
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
      const financeAuthorization = profile === 'production' ? {
        historicalNoSessionApproval: approval,
        historicalNoSessionProductionAuthorization: productionAuthorization,
        historicalNoSessionBackupSha256: productionContext.checkpointSha256,
        executionProfile: 'production',
        sourceCheckpointId: productionContext.checkpoint.checkpointId,
        sourceCheckpointSha256: productionContext.checkpointSha256,
      } : {
        historicalNoSessionApproval: approval,
        ...(profile === 'qa' ? { historicalNoSessionBackupSha256: qaSourceBackupSha256, executionProfile: 'qa' } : { executionProfile: 'dev' }),
      };
      phases.push(await runBatched('sessions', migrations.runPdvSessionMigration));
      phases.push(await runBatched('finance', migrations.runPdvFinanceMigration, financeAuthorization));
      phases.push(await runBatched('kitchen-before-commerce', migrations.runPdvKitchenOrderContextPreparation));
      phases.push(await runBatched('commerce', migrations.runPdvCommerceMigration));
      phases.push(await runBatched('finance-revalidation-after-commerce', migrations.runPdvFinanceMigration, financeAuthorization));
      phases.push(await runBatched('kitchen-revalidation', migrations.runPdvKitchenOrderContextPreparation));
      tenants.push({ tenantId, tenant: approvedTenant.name, pointId, status: 'PASS', phases });
    }
    const classCOutOfScopeDisposition = profile === 'production'
      ? await (dependencies.applyApprovedClassCOutOfScopeDisposition ?? applyApprovedClassCOutOfScopeDisposition)({ db, approval, productionContext, baseRunId: runId })
      : null;
    write(`${JSON.stringify({ status: 'PASS', profile, photoSha256, approvedClassCPayments: approval.entries.length, checkpointId: productionContext?.checkpoint.checkpointId ?? null, checkpointSha256: productionContext?.checkpointSha256 ?? null, tenants, classCOutOfScopeDisposition })}\n`);
    return { status: 'PASS', profile, approval, productionContext, tenants, classCOutOfScopeDisposition };
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runLiveTransformations();
