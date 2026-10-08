import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDevCutoverPlan, DEV_PDV_CUTOVER_SEQUENCE, DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';
import { executePdvCutoverAdapter } from './pdv-unico-cutover-adapter.mjs';
import { readCutoverReceipts } from './pdv-unico-cutover-receipts.mjs';
import { validateDevMigrationLedger } from './pdv-unico-dev-cutover-ledger.mjs';
import { applyPersistentTenantActivation, assertPersistentTenantActivation, rollbackPersistentTenantActivation } from './pdv-unico-dev-activation-config.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const tenantIds = args.filter((arg) => arg.startsWith('--tenant=')).map((arg) => arg.slice('--tenant='.length));
const apply = args.includes('--apply');
const valueFlags = new Set(['profile', 'tenant', 'run-id', 'confirm-target', 'confirm-revision', 'confirm-migrations-sha256', 'confirm-photo-sha256', 'backup-file', 'restore-drill']);
for (const arg of args) {
  if (['--apply', '--dry-run', '--plan'].includes(arg)) continue;
  const match = /^--([a-z-]+)=/.exec(arg);
  if (!match || !valueFlags.has(match[1])) throw new Error(`Unknown argument: ${arg}`);
}
if ((value('profile') ?? 'dev') !== 'dev') throw new Error('This entrypoint accepts only --profile=dev.');
if (apply && tenantIds.length !== DEV_PDV_TENANT_ALLOWLIST.length) throw new Error('DEV apply requires explicit --tenant entries for both approved tenants.');
const selectedTenants = tenantIds.length ? [...new Set(tenantIds)] : DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id);
selectedTenants.forEach((tenantId) => {
  if (!DEV_PDV_TENANT_ALLOWLIST.some(({ id }) => id === tenantId)) throw new Error(`Tenant is outside the explicit DEV allowlist: ${tenantId}`);
});
if (JSON.stringify([...selectedTenants].sort()) !== JSON.stringify(DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort())) throw new Error('DEV apply requires explicit --tenant entries for CIA Marítima and Churrasquinho do Thiago.');

function runGit(args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git read failed for ${args.join(' ')}.`);
  return result.stdout;
}
const revision = runGit(['rev-parse', 'HEAD']).trim();
const snapshotSchema = runGit(['show', `${revision}:backend/prisma/schema.prisma`]);
const migrationFiles = runGit(['ls-tree', '-r', '--name-only', revision, '--', 'backend/prisma/migrations']).split(/\r?\n/).filter((name) => name.endsWith('/migration.sql'));
const migrationNames = [...new Set(migrationFiles.map((name) => name.split('/').at(-2)))].sort();
const reviewedMigrations = migrationNames.map((name) => {
  const file = `backend/prisma/migrations/${name}/migration.sql`;
  return { name, checksum: createHash('sha256').update(runGit(['show', `${revision}:${file}`], null)).digest('hex') };
});
const migrationBlobHashes = migrationFiles.map((name) => `${name}\0${runGit(['rev-parse', `${revision}:${name}`]).trim()}`);
const migrationsSha256 = createHash('sha256').update(migrationBlobHashes.join('\n')).digest('hex');
const plan = buildDevCutoverPlan({ tenantIds: selectedTenants, mode: apply ? 'apply' : 'dry-run' });

if (!apply) {
  process.stdout.write(`${JSON.stringify({ ...plan, revision, migrationsSha256, migrationFolders: migrationNames.length, requiredApplyConfirmations: ['--confirm-target=cervejaria_dev', `--confirm-revision=${revision}`, `--confirm-migrations-sha256=${migrationsSha256}`, '--backup-file=<recoverable DEV backup>', '--restore-drill=<PASS proof JSON>', `--confirm-photo-sha256=2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`, '--run-id=<stable id>'], connectsToDatabase: false, appliesMigrations: false }, null, 2)}\n`);
  process.exit(0);
}

const confirmedRunId = value('run-id');
if (!confirmedRunId || !/^[a-zA-Z0-9_-]{8,80}$/.test(confirmedRunId)) throw new Error('Apply requires a stable --run-id for durable receipts and resume.');
if (value('confirm-target') !== 'cervejaria_dev') throw new Error('Apply requires --confirm-target=cervejaria_dev.');
if (value('confirm-revision') !== revision) throw new Error(`Apply revision confirmation must match exact HEAD ${revision}.`);
if (value('confirm-migrations-sha256') !== migrationsSha256) throw new Error(`Apply migration review mismatch; expected sha256 ${migrationsSha256}.`);
if (value('confirm-photo-sha256') !== '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b') throw new Error('Apply requires explicit confirmation of the approved source photo SHA-256.');
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE ?? '');
if (!photoPath || !existsSync(photoPath)) throw new Error('Set PDV_REPRESENTATIVE_PHOTO_FILE to the approved photo before apply.');
const photoBytes = await readFile(photoPath);
const photoSha256 = createHash('sha256').update(photoBytes).digest('hex');
if (photoSha256 !== '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b') throw new Error('Approved representative photo hash mismatch.');

const backupPath = path.resolve(value('backup-file') ?? '');
const restoreProofPath = path.resolve(value('restore-drill') ?? '');
if (!backupPath || !existsSync(backupPath) || !restoreProofPath || !existsSync(restoreProofPath)) throw new Error('Apply requires an existing DEV backup and its successful isolated restore-drill proof.');
const backupBytes = await readFile(backupPath);
if (backupBytes.length < 1024) throw new Error('The selected DEV backup is empty or implausibly small.');
const backupSha256 = createHash('sha256').update(backupBytes).digest('hex');
const restoreProof = JSON.parse(await readFile(restoreProofPath, 'utf8'));
if (restoreProof.status !== 'PASS' || restoreProof.sourceEnvironment !== 'development' || restoreProof.sourceDatabase !== 'cervejaria_dev'
  || restoreProof.backupSha256 !== backupSha256 || !/^cervejaria_restore_drill_[a-z0-9_]+$/i.test(restoreProof.recoveryDatabase ?? '')
  || restoreProof.schemaValidation !== 'PASS' || restoreProof.migrationLedgerValidation !== 'PASS') {
  throw new Error('Restore-drill proof must be PASS for this exact DEV backup and a disposable recovery database.');
}

const devConfigPath = path.resolve(process.env.PDV_CUTOVER_DEV_CONFIG_FILE ?? path.join(backendRoot, '.env.development'));
const configText = await readFile(devConfigPath, 'utf8');
const databaseLine = configText.split(/\r?\n/).find((line) => line.trim().startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DEV DATABASE_URL is missing.');
let databaseUrl = databaseLine.slice(databaseLine.indexOf('=') + 1).trim();
if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) databaseUrl = databaseUrl.slice(1, -1);
const devEnv = { ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl };
const target = validateDevCutoverEnvironment(devEnv); // exact DEV host/port/database before generation or connection
if (Object.keys(devEnv).some((key) => /^PROD(?:_|$)/i.test(key))) throw new Error('PROD-related environment variables are forbidden for DEV cutover.');

const tempRoot = await mkdtemp(path.join(process.env.PDV_CUTOVER_TEMP_ROOT ?? os.tmpdir(), `tap76-dev-cutover-${confirmedRunId}-`));
if (!path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('Cutover reports and clients must live under the OS temporary directory.');
const reportPath = path.join(tempRoot, 'cutover-report.json');
const startedAt = new Date().toISOString();
const clockStart = performance.now();
const receiptsRoot = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'TAP Quiver', 'pdv-cutover-receipts');
await mkdir(receiptsRoot, { recursive: true });
const receiptPath = path.join(receiptsRoot, `${confirmedRunId}.jsonl`);
let lockFd;
try { lockFd = openSync(path.join(receiptsRoot, `${confirmedRunId}.lock`), 'wx'); }
catch { throw new Error('A cutover with this run ID is already active or has a stale lock; inspect it before continuing.'); }

function childEnv(extra = {}) {
  const env = { ...devEnv };
  for (const name of Object.keys(env)) if (name === 'DIRECT_URL' || /^PROD(?:_|$)/i.test(name) || /_DATABASE_URL$/.test(name) || name === 'PDV_ISOLATED_QA' || name === 'QA_DATABASE_URL') delete env[name];
  Object.assign(env, { PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CUTOVER_RUN_ID: confirmedRunId, PDV_CUTOVER_FINANCE_APPROVAL_SHA256: '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a', PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, TEMP: tempRoot, TMP: tempRoot }, extra);
  return env;
}
function runNode(args, label, extra = {}, cwd = backendRoot) {
  const result = spawnSync(process.execPath, args, { cwd, env: childEnv(extra), encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const safe = (text) => text.replaceAll(databaseUrl, '[DEV DATABASE URL REDACTED]');
  writeFileSyncSafe(path.join(tempRoot, `${label}.stdout.txt`), safe(stdout));
  writeFileSyncSafe(path.join(tempRoot, `${label}.stderr.txt`), safe(stderr));
  if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.error?.code}): ${safe(`${stderr}\n${stdout}`).slice(-2400)}`);
  return stdout;
}
function writeFileSyncSafe(file, contents) {
  // Synchronous child reports are flushed before a phase receipt can be recorded.
  writeFileSync(file, contents, { encoding: 'utf8', flag: 'w' });
}

function parseJsonLine(output, label) {
  const line = output.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line); } catch { throw new Error(`${label} did not return its final JSON evidence record.`); }
}
async function copyMigrationSlice(schemaRoot, throughName) {
  const migrationsDir = path.join(schemaRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  for (const name of migrationNames.filter((candidate) => candidate <= throughName)) {
    const folder = path.join(migrationsDir, name);
    await mkdir(folder, { recursive: true });
    const sql = runGit(['show', `${revision}:backend/prisma/migrations/${name}/migration.sql`]);
    await writeFile(path.join(folder, 'migration.sql'), sql);
  }
  await writeFile(path.join(migrationsDir, 'migration_lock.toml'), runGit(['show', `${revision}:backend/prisma/migrations/migration_lock.toml`]));
}
async function deployThrough(schemaRoot, throughName, label) {
  await copyMigrationSlice(schemaRoot, throughName);
  const cli = path.join(backendRoot, 'node_modules/prisma/build/index.js');
  const output = runNode([cli, 'migrate', 'deploy', '--schema', path.join(schemaRoot, 'schema.prisma')], label);
  return { status: 'PASS', through: throughName, output: output.trim().split(/\r?\n/).slice(-12) };
}
async function createGeneratedSchema({ root, source, clientDir, label }) {
  await mkdir(root, { recursive: true });
  const generator = 'provider = "prisma-client-js"';
  if (!source.includes(generator)) throw new Error(`${label} Prisma schema has no standard client generator.`);
  const schemaPath = path.join(root, 'schema.prisma');
  await writeFile(schemaPath, source.replace(generator, `${generator}\n  output = "${clientDir.replaceAll('\\', '/')}"`));
  const cli = path.join(backendRoot, 'node_modules/prisma/build/index.js');
  runNode([cli, 'generate', '--schema', schemaPath], `${label}-client-generate`);
  return schemaPath;
}
async function verifyBackupProof() {
  const file = path.resolve(value('backup-file') ?? '');
  const proofFile = path.resolve(value('restore-drill') ?? '');
  const bytes = await readFile(file);
  const proof = JSON.parse(await readFile(proofFile, 'utf8'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== backupSha256 || proof.status !== 'PASS' || proof.sourceEnvironment !== 'development'
    || proof.sourceDatabase !== 'cervejaria_dev' || proof.backupSha256 !== sha256
    || !/^cervejaria_restore_drill_[a-z0-9_]+$/i.test(proof.recoveryDatabase ?? '')
    || proof.schemaValidation !== 'PASS' || proof.migrationLedgerValidation !== 'PASS') throw new Error('DEV backup/restore proof changed between preflight and apply.');
  return { backupSha256: sha256, backupBytes: bytes.length, recoveryDatabase: proof.recoveryDatabase, restoreStatus: proof.status };
}

try {
  await mkdir(tempRoot, { recursive: true });
  const backupEvidence = await verifyBackupProof();
  const preflightEvidencePath = path.join(receiptsRoot, `${confirmedRunId}.preflight.json`);
  const priorReceipts = readCutoverReceipts(receiptPath, { runId: confirmedRunId, tenantIds: selectedTenants });
  let priorPreflight = null;
  if (priorReceipts.length > 0) {
    if (!existsSync(preflightEvidencePath)) throw new Error('Cutover receipts exist without their durable initial all-tenant preflight evidence.');
    const saved = JSON.parse(await readFile(preflightEvidencePath, 'utf8'));
    const { sha256, ...body } = saved;
    if (sha256 !== createHash('sha256').update(JSON.stringify(body)).digest('hex') || body.runId !== confirmedRunId
      || body.revision !== revision || body.migrationsSha256 !== migrationsSha256 || body.photoSha256 !== photoSha256
      || body.backupSha256 !== backupEvidence.backupSha256 || body.preflight?.status !== 'CLEAR') throw new Error('Durable preflight evidence is invalid or belongs to a different run, revision, backup, or photo.');
    priorPreflight = body.preflight;
  }
  const preflightText = runNode(['scripts/run-pdv-unico-global-preflight.mjs'], 'global-preflight-current', { PDV_REPRESENTATIVE_PHOTO_FILE: photoPath });
  const currentPreflight = parseJsonLine(preflightText, 'current DEV global preflight');
  if (currentPreflight.status !== 'CLEAR' || currentPreflight.queried !== true || !currentPreflight.tenantCount || currentPreflight.coveredTenantCount !== currentPreflight.tenantCount) throw new Error('Current all-tenant DEV preflight is not CLEAR with complete coverage.');
  if (!currentPreflight.sourceComparisons?.length || currentPreflight.sourceComparisons.some((row) => row.status !== 'CLEAR')) throw new Error('The approved representative source photo no longer matches the current DEV tenants.');
  const preflight = currentPreflight;
  if (!priorPreflight) {
    const metadata = { runId: confirmedRunId, revision, migrationsSha256, photoSha256, backupSha256: backupEvidence.backupSha256, preflight: { status: preflight.status, queried: preflight.queried, transaction: preflight.transaction, tenantCount: preflight.tenantCount, coveredTenantCount: preflight.coveredTenantCount, crossTenantEdges: preflight.crossTenantEdges, ledger: preflight.ledger, ledgerDivergence: preflight.ledgerDivergence, sourceComparisonCount: preflight.sourceComparisons.length, sourceComparisonsClear: true } };
    metadata.sha256 = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
    await writeFile(preflightEvidencePath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  }
  if (preflight.status !== 'CLEAR' || preflight.queried !== true || preflight.coveredTenantCount !== preflight.tenantCount) throw new Error('All-tenant DEV preflight evidence is incomplete.');
  const ledgerValidation = validateDevMigrationLedger({ migrations: reviewedMigrations, ledgerRows: preflight.ledger, boundary: '20261004150000_pdv_finance_session_link' });
  const pendingMigrations = ledgerValidation.pendingNames;

  const sourceSchemaCommit = '128f69fb2fd6904aa823ff17448a6ff13e9d9595';
  const precommerceSchema = runGit(['show', `${sourceSchemaCommit}:backend/prisma/schema.prisma`]);
  const precommerceClientDir = path.join(tempRoot, 'precommerce-client');
  const targetClientDir = path.join(tempRoot, 'target-client');
  const precommerceRoot = path.join(tempRoot, 'precommerce-schema');
  const targetSchemaRoot = path.join(tempRoot, 'target-schema');
  const precommerceSchemaPath = await createGeneratedSchema({ root: precommerceRoot, source: precommerceSchema, clientDir: precommerceClientDir, label: 'precommerce' });
  const targetSchemaPath = await createGeneratedSchema({ root: targetSchemaRoot, source: snapshotSchema, clientDir: targetClientDir, label: 'target' });

  let commercialPreflight = null;
  let activationAppliedHere = false;
  let activationBackupForRollback;
  const operations = {
    'minimal-prerequisite-migrations': async () => {
      const names = pendingMigrations.filter((name) => name <= '20261004150000_pdv_finance_session_link');
      const result = await deployThrough(targetSchemaRoot, '20261004150000_pdv_finance_session_link', 'minimum-migrations');
      return { status: 'PASS', migrationNames: names, migrationsSha256: migrationsSha256, deploy: result };
    },
    'business-catalog-transformations': async () => {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-precommerce-preparation.mjs', '--business-catalog'], 'business-catalog', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: precommerceClientDir,
        PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CUTOVER_RUN_ID: confirmedRunId, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath,
      });
      const result = parseJsonLine(output, 'business/catalog migrators');
      if (result.status !== 'COMPLETED' || !result.report?.every((row) => row.status === 'COMPLETED')) throw new Error('Business/catalog migrators did not complete for every selected tenant.');
      return { status: 'PASS', ...result };
    },
    'kitchen-context-preparation': async () => {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-precommerce-preparation.mjs', '--kitchen'], 'kitchen-preparation', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: precommerceClientDir,
        PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CUTOVER_RUN_ID: confirmedRunId, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath,
      });
      const result = parseJsonLine(output, 'kitchen preparation migrator');
      if (result.status !== 'COMPLETED' || !result.report?.every((row) => row.status === 'COMPLETED')) throw new Error('Kitchen preparation did not complete before the restrictive commercial preflight.');
      return { status: 'PASS', ...result };
    },
    'dependent-migrations-with-original-preflight': async () => {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-cutover-commercial-preflight.mjs'], 'commercial-preflight', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: precommerceClientDir,
      });
      commercialPreflight = parseJsonLine(output, 'commercial preflight');
      if (commercialPreflight.status !== 'CLEAR' || commercialPreflight.tenantCount !== preflight.tenantCount || commercialPreflight.coveredTenantCount !== preflight.coveredTenantCount) throw new Error('Commercial preflight is not CLEAR for every tenant after kitchen preparation.');
      const result = await deployThrough(targetSchemaRoot, migrationNames.at(-1), 'dependent-migrations');
      return { status: 'PASS', commercialPreflight, migrationNames: pendingMigrations.filter((name) => name > '20261004150000_pdv_finance_session_link'), migrationsSha256, deploy: result };
    },
    'remaining-tenant-transformations-and-replays': async () => {
      const transformOutput = runNode(['--import', 'tsx', 'scripts/pdv-unico-live-transformations.mjs'], 'tenant-transformations-replays', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: targetClientDir,
        PDV_CUTOVER_FINANCE_APPROVAL_SHA256: '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a',
        PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CUTOVER_RUN_ID: confirmedRunId, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath,
      });
      const transformed = parseJsonLine(transformOutput, 'tenant transform/replay executor');
      if (transformed.status !== 'PASS' || transformed.approvedClassCPayments !== 577) throw new Error('Tenant transforms/replays failed or class-C authorization set changed.');
      const sql = (await readFile(path.join(backendRoot, 'prisma/transformations/pdv-gamified-categories-v1.sql'), 'utf8'));
      const { scopeCategorySql } = await import('./pdv-unico-dev-cutover-core.mjs');
      const scopedSql = scopeCategorySql(sql, selectedTenants);
      const sqlPath = path.join(tempRoot, 'canonical-categories.sql');
      await writeFile(sqlPath, scopedSql);
      const result = runNode([path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'db', 'execute', '--schema', targetSchemaPath, '--file', sqlPath], 'canonical-category-transform');
      return { status: 'PASS', transformations: transformed, categoryTransform: result.trim().split(/\r?\n/).slice(-8) };
    },
    'diagnostics-and-integrated-reconciliation': async () => {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-live-reconciliation.mjs'], 'integrated-reconciliation', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: targetClientDir,
        PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_REPRESENTATIVE_PHOTO_FILE: photoPath,
      });
      const result = parseJsonLine(output, 'integrated reconciliation');
      if (result.status !== 'PASS' || result.payments?.rows !== 605 || result.payments?.approvedClassCPayments !== 577) throw new Error('Integrated reconciliation detected a financial or source drift.');
      return { status: 'PASS', ...result };
    },
    'per-tenant-activation': async () => {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-live-readiness.mjs'], 'selected-tenant-activation-readiness', {
        PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: targetClientDir,
        PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CANONICAL_TENANTS: selectedTenants.join(','),
      });
      const readiness = parseJsonLine(output, 'selected-tenant activation gate');
      if (readiness.status !== 'READY' || readiness.tenants.length !== selectedTenants.length) throw new Error('Tenant activation readiness failed.');
      activationBackupForRollback = path.join(receiptsRoot, `${confirmedRunId}.activation-rollback-${randomBytes(6).toString('hex')}.json`);
      const activation = await applyPersistentTenantActivation({ configPath: devConfigPath, tenants: selectedTenants, backupPath: activationBackupForRollback });
      activationAppliedHere = activation.changed;
      return { status: 'PASS', readiness, activation, activationScope: selectedTenants };
    },
  };

  const verifyCompletedPhase = async (phaseName, receipt) => {
    const verificationEnv = {
      PDV_CUTOVER_PROFILE: 'dev', PDV_CUTOVER_DEV_ADAPTER: '1', PDV_CUTOVER_PRISMA_CLIENT: targetClientDir,
      PDV_CUTOVER_TENANTS: selectedTenants.join(','), PDV_CANONICAL_TENANTS: selectedTenants.join(','),
      PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, PDV_CUTOVER_RUN_ID: confirmedRunId,
    };
    if (phaseName === 'minimal-prerequisite-migrations' || phaseName === 'dependent-migrations-with-original-preflight') {
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-cutover-verify.mjs', phaseName], `resume-verify-${phaseName}`, verificationEnv);
      const check = parseJsonLine(output, `resume verification ${phaseName}`);
      if (check.status !== 'PASS' || check.migrationsSha256 !== migrationsSha256) return { status: 'BLOCKED', code: 'MIGRATION_LEDGER_DIVERGENCE' };
      return check;
    }
    if (phaseName === 'business-catalog-transformations' || phaseName === 'kitchen-context-preparation') {
      const expectedScope = { business: 'PDV_AGENDA_OCORRENCIA_V1', catalog: 'PDV_CONFIGURACAO_CATALOGO_V1', 'kitchen-preparation': 'PDV_PEDIDOS_COZINHA_CONTEXT_PREPARATION_V4' };
      const expectedRuns = receipt.result?.report?.map((row) => ({ runId: row.runId, phase: row.phase, tenantId: selectedTenants.find((id) => row.tenant === DEV_PDV_TENANT_ALLOWLIST.find((tenant) => tenant.id === id)?.name), scope: expectedScope[row.phase] })).filter((row) => row.runId) ?? [];
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-cutover-verify.mjs', 'migrator-runs', JSON.stringify({ runs: expectedRuns.map((row) => row.runId), expectedRuns, tenants: selectedTenants })], `resume-verify-${phaseName}`, verificationEnv);
      return parseJsonLine(output, `resume verification ${phaseName}`);
    }
    if (phaseName === 'remaining-tenant-transformations-and-replays') {
      const scopes = { taps: 'PDV_TAP_OWNERSHIP_V2', sessions: 'PDV_SESSOES_CAIXA_V1', finance: 'PDV_FINANCEIRO_V1', 'kitchen-before-commerce': 'PDV_PEDIDOS_COZINHA_CONTEXT_PREPARATION_V4', commerce: 'PDV_COMANDAS_PEDIDOS_ESTOQUE_V1', 'finance-revalidation-after-commerce': 'PDV_FINANCEIRO_V1', 'kitchen-revalidation': 'PDV_PEDIDOS_COZINHA_CONTEXT_PREPARATION_V4' };
      const expectedRuns = receipt.result?.transformations?.tenants?.flatMap((tenant) => tenant.phases.map((row) => ({ runId: row.runId, phase: row.phase, tenantId: tenant.tenantId, scope: scopes[row.phase] })).filter((row) => row.runId)) ?? [];
      const output = runNode(['--import', 'tsx', 'scripts/pdv-unico-cutover-verify.mjs', 'migrator-runs', JSON.stringify({ runs: expectedRuns.map((row) => row.runId), expectedRuns, tenants: selectedTenants, categories: true })], 'resume-verify-remaining-transformations', verificationEnv);
      return parseJsonLine(output, 'resume verification remaining transformations');
    }
    if (phaseName === 'diagnostics-and-integrated-reconciliation') return parseJsonLine(runNode(['--import', 'tsx', 'scripts/pdv-unico-live-reconciliation.mjs'], 'resume-verify-reconciliation', verificationEnv), 'resume reconciliation');
    if (phaseName === 'per-tenant-activation') {
      const readiness = parseJsonLine(runNode(['--import', 'tsx', 'scripts/pdv-unico-live-readiness.mjs'], 'resume-verify-activation', verificationEnv), 'resume activation');
      if (readiness.status !== 'READY' || readiness.tenants.length !== selectedTenants.length) return { status: 'BLOCKED', code: 'TENANT_READINESS_DIVERGENCE' };
      const activation = await assertPersistentTenantActivation({ configPath: devConfigPath, tenants: selectedTenants });
      return { status: 'PASS', readiness, activation, activationScope: selectedTenants };
    }
    return { status: 'BLOCKED', code: 'UNKNOWN_RECEIPT_PHASE' };
  };
  let adapter;
  try {
    adapter = await executePdvCutoverAdapter({ target, tenantIds: selectedTenants, runId: confirmedRunId, preflight, operations, receiptFile: receiptPath, verifyCompletedPhase });
  } catch (error) {
    if (activationAppliedHere && activationBackupForRollback && existsSync(activationBackupForRollback)) {
      try { await rollbackPersistentTenantActivation({ configPath: devConfigPath, backupPath: activationBackupForRollback }); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Cutover failed and persistent backend activation rollback was blocked; preserve both errors and inspect the recorded activation diff.'); }
    }
    throw error;
  }
  const report = { status: adapter.status, startedAt, elapsedMs: Math.round(performance.now() - clockStart), revision, target, tenants: selectedTenants, photoSha256, migrationsSha256, ledgerValidation, pendingMigrations, backupEvidence, preflight: { status: preflight.status, tenantCount: preflight.tenantCount, coveredTenantCount: preflight.coveredTenantCount, crossTenantEdges: preflight.crossTenantEdges }, commercialPreflight, adapter, receiptsFile: receiptPath, evidenceDirectory: tempRoot };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  closeSync(lockFd);
  try { unlinkSync(path.join(receiptsRoot, `${confirmedRunId}.lock`)); } catch {}
  // Reports and generated receipt logs are durable; retain this run's temp evidence for review.
}
