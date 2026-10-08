import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { executeCutoverCore, validateQaCutoverEnvironment, scopeCategorySql, DEV_PDV_TENANT_ALLOWLIST } from './pdv-unico-dev-cutover-core.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const photoPath = process.env.PDV_REPRESENTATIVE_PHOTO_FILE;
const tenantIds = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...tenantIds].sort(), DEV_PDV_TENANT_ALLOWLIST.map(t => t.id).sort(), 'representative certification requires the explicit two-tenant allowlist');
if (!photoPath) throw new Error('PDV_REPRESENTATIVE_PHOTO_FILE is required.');
const photoBytes = await readFile(photoPath);
const photoHash = createHash('sha256').update(photoBytes).digest('hex');
assert.equal(photoHash, '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b', 'only the explicitly approved historical photo is accepted');
const photo = JSON.parse(photoBytes.toString('utf8'));
const approval = JSON.parse(await readFile(path.join(backendRoot, 'scripts/pdv-unico-historical-no-session-approval.json'), 'utf8'));
assert.equal(approval.sourcePhotoSha256, photoHash);
assert.equal(approval.entries.length, 577, 'historical C authorization remains pinned to its existing 577 IDs');

const runId = randomBytes(8).toString('hex');
const runnerStartedAt = new Date().toISOString();
const runnerStarted = performance.now();
const containerName = `codex-pdv-sequenced-qa-${runId}`;
const password = randomBytes(32).toString('base64url');
const port = await selectPort();
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
url.username = 'postgres'; url.password = password;
url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `tap76-sequenced-${runId}-`));
if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary QA root escaped OS temp.');
const sourceClientDir = path.join(tempRoot, 'source-client');
const precommerceClientDir = path.join(tempRoot, 'precommerce-client');
const targetClientDir = path.join(tempRoot, 'target-client');
const migrationsDir = path.join(tempRoot, 'migrations');
const targetSchemaPath = path.join(tempRoot, 'schema.prisma');
const prismaCli = path.join(backendRoot, 'node_modules/prisma/build/index.js');
const sourceSchemaCommit = '66ec00886b65eaea8e437fae4e9a36f7be971b09';
const precommerceSchemaCommit = '128f69fb2fd6904aa823ff17448a6ff13e9d9595';
const sourceSchema = spawnSync('git', ['show', `${sourceSchemaCommit}:backend/prisma/schema.prisma`], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
if (sourceSchema.status !== 0) throw new Error('Could not read the pinned source schema from Git.');
const sourceSchemaHash = createHash('sha256').update(sourceSchema.stdout).digest('hex');
assert.equal(sourceSchemaHash, '19ff5e65829bc6356fa8d06edbff9fd1527b1d1dd0bd5e35c58cda880479ae59', 'pinned source schema hash');
const precommerceSchema = spawnSync('git', ['show', `${precommerceSchemaCommit}:backend/prisma/schema.prisma`], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
if (precommerceSchema.status !== 0) throw new Error('Could not read the pinned pre-commerce Prisma schema from Git.');
const currentSchemaText = await readFile(path.join(backendRoot, 'prisma/schema.prisma'), 'utf8');
const sourceSchemaPath = path.join(tempRoot, 'source-schema.prisma');
const precommerceSchemaPath = path.join(tempRoot, 'precommerce-schema.prisma');
const withClientOutput = (text, output) => {
  const result = text.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${output.replaceAll('\\', '/')}"`);
  if (result === text) throw new Error('Prisma generator output could not be isolated.');
  return result;
};
await writeFile(sourceSchemaPath, withClientOutput(sourceSchema.stdout, sourceClientDir));
await writeFile(precommerceSchemaPath, withClientOutput(precommerceSchema.stdout, precommerceClientDir));
await writeFile(targetSchemaPath, withClientOutput(currentSchemaText, targetClientDir));

let containerId;
let created = false;
let completed = false;
const phaseRows = [];
const generatedClientRoots = [];
const childEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DIRECT_URL' || key === 'PDV_CANONICAL_CONFIG_QA' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: containerName, QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  env.PDV_SENTINEL_BASELINE = path.join(tempRoot, 'unselected-baseline.json');
  const inheritedRoots = JSON.parse(env.PDV_GIT_QA_ALLOWED_ROOTS ?? '[]');
  env.PDV_GIT_QA_ALLOWED_ROOTS = JSON.stringify([...new Set([...inheritedRoots, ...generatedClientRoots])]);
  return env;
};
function run(args, extraEnv = {}, cwd = backendRoot) {
  const env = { ...childEnv(), ...extraEnv };
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 24 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`QA child exited ${result.status}: ${`${result.stderr ?? ''}\n${result.stdout ?? ''}`.replaceAll(databaseUrl, '[QA URL REDACTED]').slice(-5000)}`);
  return result.stdout ?? '';
}
async function phase(name, operation) {
  const started = performance.now();
  process.stdout.write(`PDV_SEQUENCE_START phase=${name}\n`);
  const detail = await operation();
  const durationMs = Math.round(performance.now() - started);
  phaseRows.push({ phase: name, status: 'PASS', durationMs, ...(detail ?? {}) });
  process.stdout.write(`PDV_SEQUENCE_END phase=${name} status=PASS durationMs=${durationMs}\n`);
  return detail;
}
try {
  const docker = spawnSync('docker', ['run', '-d', '--rm', '--name', containerName, '--label', 'codex.purpose=pdv-unico-sequenced-disposable-qa', '--label', `codex.run=${runId}`, '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g', '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine'], { encoding: 'utf8', windowsHide: true });
  if (docker.status !== 0) throw new Error(`Could not start QA PostgreSQL: ${(docker.stderr || docker.stdout).slice(0, 1000)}`);
  containerId = docker.stdout.trim();
  if (!/^[a-f0-9]{64}$/i.test(containerId)) throw new Error('Docker did not return a container ID.');
  created = true;
  const labels = spawnSync('docker', ['inspect', '-f', '{{.Id}}|{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerId], { encoding: 'utf8', windowsHide: true });
  assert.equal(labels.stdout.trim(), `${containerId}|pdv-unico-sequenced-disposable-qa|${runId}`);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Disposable QA database did not become ready.');
  const cli = fileURLToPath(pathToFileURL(prismaCli));
  run([cli, 'generate', '--schema', sourceSchemaPath]);
  run([cli, 'generate', '--schema', precommerceSchemaPath]);
  run([cli, 'generate', '--schema', targetSchemaPath]);
  generatedClientRoots.push(sourceClientDir, precommerceClientDir, targetClientDir);
  await mkdir(migrationsDir, { recursive: true });
  const migrationRoot = path.join(backendRoot, 'prisma/migrations');
  const migrationEntries = (await readdir(migrationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
  for (const entry of migrationEntries) if (!existsSync(path.join(migrationRoot, entry.name, 'migration.sql'))) throw new Error(`Incomplete migration directory: ${entry.name}`);
  const migrationNames = migrationEntries.map(entry => entry.name).sort();
  const tracked = spawnSync('git', ['ls-tree', '-r', '--name-only', process.env.PDV_GIT_QA_COMMIT ?? 'HEAD', '--', 'backend/prisma/migrations'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (tracked.status !== 0) throw new Error('Cannot verify tracked migrations.');
  for (const name of migrationNames) if (!tracked.stdout.split(/\r?\n/).includes(`backend/prisma/migrations/${name}/migration.sql`)) throw new Error(`Untracked migration rejected: ${name}`);
  const sourceBaselineName = '20260930150000_company_pix_key';
  const selectedNames = migrationNames.filter((name) => name <= '20261004150000_pdv_finance_session_link');
  for (const name of migrationNames.filter((item) => item <= sourceBaselineName)) await cp(path.join(migrationRoot, name), path.join(migrationsDir, name), { recursive: true });
  await cp(path.join(migrationRoot, 'migration_lock.toml'), path.join(migrationsDir, 'migration_lock.toml'));
  await phase('source-schema-migrations-to-captured-baseline', async () => {
    run([cli, 'migrate', 'deploy', '--schema', sourceSchemaPath], { DATABASE_URL: databaseUrl });
    return { sourceBaseline: sourceBaselineName, sourceSchemaCommit, migrationFolders: migrationNames.filter((item) => item <= sourceBaselineName).length };
  });
  await phase('restore-and-compare-source-photo-before-migrations', async () => {
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-restore-source-photo.qa.mjs'], { PDV_SOURCE_PRISMA_CLIENT: sourceClientDir, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath });
    const restored = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(restored.status, 'PASS');
    return { ...restored, sourceSchemaCommit, sourceSchemaSha256: sourceSchemaHash, photoSha256: photoHash };
  });
  await phase('backup-restore-and-recovery-proof-in-disposable-qa', async () => {
    const backup = spawnSync('docker', ['exec', containerId, 'pg_dump', '-U', 'postgres', '--no-owner', '--no-privileges', '-d', 'cervejaria_qa_pdv_unico'], { encoding: null, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
    if (backup.status !== 0) throw new Error(`QA pg_dump failed: ${String(backup.stderr).slice(-1600)}`);
    const backupBytes = Buffer.from(backup.stdout);
    const backupPath = path.join(tempRoot, 'source-photo-recovery.sql');
    await writeFile(backupPath, backupBytes);
    const backupSha256 = createHash('sha256').update(backupBytes).digest('hex');
    const createdb = spawnSync('docker', ['exec', containerId, 'createdb', '-U', 'postgres', 'cervejaria_qa_recovery'], { encoding: 'utf8', windowsHide: true });
    if (createdb.status !== 0) throw new Error(`Could not create executor-owned QA recovery database: ${(createdb.stderr || createdb.stdout).slice(-1200)}`);
    const restored = spawnSync('docker', ['exec', '-i', containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'cervejaria_qa_recovery'], { input: backupBytes, encoding: 'utf8', windowsHide: true, maxBuffer: 24 * 1024 * 1024 });
    if (restored.status !== 0) throw new Error(`QA pg_restore through psql failed: ${(restored.stderr || restored.stdout).slice(-1800)}`);
    const recoveryUrl = new URL(databaseUrl); recoveryUrl.pathname = '/cervejaria_qa_recovery';
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-recovery-verify.qa.mjs'], { PDV_SOURCE_PRISMA_CLIENT: sourceClientDir, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, PDV_RECOVERY_DATABASE_URL: recoveryUrl.toString() });
    const proof = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(proof.status, 'PASS');
    assert.equal(proof.rows, 10738);
    return { format: 'plain SQL', bytes: backupBytes.length, sha256: backupSha256, restoreStatus: 'PASS', ...proof };
  });
  let rankingBefore;
  await phase('historical-chope-ranking-before-transformations', async () => {
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-ranking-snapshot.qa.mjs'], { PDV_QA_PRISMA_CLIENT: sourceClientDir });
    rankingBefore = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    return { tenants: rankingBefore.snapshots.map(({ tenant, eventCount }) => ({ tenant, eventCount })) };
  });

  // Add an outside-allowlist tenant only after recovery comparison of the original photo.
  run(['--import', 'tsx', 'scripts/pdv-unico-unselected-sentinel.qa.mjs', 'seed'], { PDV_QA_PRISMA_CLIENT: sourceClientDir });
  const qaPreflight = JSON.parse(run(['--import', 'tsx', 'scripts/pdv-unico-sequence-inspect.qa.mjs', 'preflight'], { PDV_QA_PRISMA_CLIENT: sourceClientDir }).trim().split(/\r?\n/).at(-1));
  const target = validateQaCutoverEnvironment(childEnv(), { verified: true, runId, containerName });
  let representative;
  const apiClientEnv = { PDV_QA_PRISMA_CLIENT: precommerceClientDir, TEMP: os.tmpdir(), TMP: os.tmpdir() };
  const kernel = await executeCutoverCore({ target, tenantIds, runId, preflight: qaPreflight,
    receipt: row => appendFile(path.join(tempRoot, 'cutover-receipts.jsonl'), JSON.stringify(row) + '\n'),
    operations: {
    'minimal-prerequisite-migrations': async () => {
  for (const name of selectedNames.filter((item) => item > sourceBaselineName)) await cp(path.join(migrationRoot, name), path.join(migrationsDir, name), { recursive: true });
  const deploymentSchema = currentSchemaText.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"');
  await writeFile(targetSchemaPath, deploymentSchema);
  await phase('minimum-migrations-through-20261004150000', async () => {
    run([cli, 'migrate', 'deploy', '--schema', targetSchemaPath], { DATABASE_URL: databaseUrl });
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-sequence-inspect.qa.mjs', 'minimum'], { PDV_QA_PRISMA_CLIENT: targetClientDir });
    return { ...JSON.parse(output.trim().split(/\r?\n/).at(-1)), includedMigrationFolders: selectedNames.length };
  });
  return { status: 'PASS' };
    },
    'business-catalog-transformations': async () => {
  await phase('business-catalog-and-kitchen-preparation-on-precommerce-client', async () => {
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-precommerce-preparation.mjs', '--business-catalog'], apiClientEnv);
    const record = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(record.status, 'COMPLETED');
    return { tenantPhases: record.report };
  });
  return { status: 'PASS' };
    },
    'kitchen-context-preparation': async () => {
      await phase('kitchen-context-preparation', async () => {
        const output = run(['--import', 'tsx', 'scripts/pdv-unico-precommerce-preparation.mjs', '--kitchen'], apiClientEnv);
        const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
        assert.equal(result.status, 'COMPLETED');
        return { tenantPhases: result.report };
      });
      return { status: 'PASS' };
    },
    'dependent-migrations-with-original-preflight': async () => {
  for (const name of migrationNames.filter((item) => item > '20261004150000_pdv_finance_session_link')) await cp(path.join(migrationRoot, name), path.join(migrationsDir, name), { recursive: true });
  await phase('dependent-and-remaining-migrations-with-original-preflight', async () => {
    run([cli, 'migrate', 'deploy', '--schema', targetSchemaPath], { DATABASE_URL: databaseUrl });
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-sequence-inspect.qa.mjs', 'dependent'], { PDV_QA_PRISMA_CLIENT: targetClientDir });
    return JSON.parse(output.trim().split(/\r?\n/).at(-1));
  });
  return { status: 'PASS' };
    },
    'remaining-tenant-transformations-and-replays': async () => {
  await phase('canonical-category-transformation', async () => {
    const sql = scopeCategorySql(await readFile(path.join(backendRoot, 'prisma/transformations/pdv-gamified-categories-v1.sql'), 'utf8'), tenantIds);
    const result = spawnSync('docker', ['exec', '-i', containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Canonical category transformation failed in isolated QA: ${(result.stderr || result.stdout).slice(-3000)}`);
    return { transform: 'categoria-historica-v2', stdout: result.stdout.trim().split(/\r?\n/).slice(-6) };
  });
  let rankingAfter;
  await phase('historical-chope-ranking-after-transformations', async () => {
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-ranking-snapshot.qa.mjs'], { PDV_QA_PRISMA_CLIENT: targetClientDir });
    rankingAfter = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(rankingAfter.snapshots, rankingBefore.snapshots, 'historical Chope rankings by event and trailer-period remain identical through migration and category transformation');
    return { tenants: rankingAfter.snapshots.map(({ tenant, eventCount }) => ({ tenant, eventCount })), identicalToSource: true };
  });
  const representativeEnv = { ...apiClientEnv, PDV_QA_PRISMA_CLIENT: targetClientDir, PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, PDV_REPRESENTATIVE_SKIP_RESTORE: '1' };
  const tenantTransformationsStarted = performance.now();
  const representativeOutput = run(['--import', 'tsx', 'scripts/pdv-unico-representative-qa.isolated.test.mjs'], representativeEnv);
  const representativeJson = representativeOutput.slice(representativeOutput.lastIndexOf('{\n  "aggregateStatus"'));
  representative = JSON.parse(representativeJson);
  assert.equal(representative.aggregateStatus, 'COMPLETED');
  const tenantTransformationsDurationMs = Math.round(performance.now() - tenantTransformationsStarted);
  phaseRows.push({
    phase: 'tenant-transformations-replays-and-integrated-reconciliation', status: 'PASS',
    durationMs: tenantTransformationsDurationMs,
    tenants: representative.tenantResults,
    permissionComparisons: representative.permissionComparisons,
    immutableComparisons: representative.immutableComparisons,
    activationReadiness: representative.activationReadiness,
  });
  return { status: 'PASS' };
    },
    'diagnostics-and-integrated-reconciliation': async () => {
  await phase('post-replay-historical-ranking-verification', async () => {
    const output = run(['--import', 'tsx', 'scripts/pdv-unico-ranking-snapshot.qa.mjs'], { PDV_QA_PRISMA_CLIENT: targetClientDir });
    const postCommerceRanking = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(postCommerceRanking.snapshots, rankingBefore.snapshots, 'historical Chope rankings remain identical after all transformations and replays');
    return { identicalToSource: true, tenants: postCommerceRanking.snapshots.map(({ tenant, eventCount }) => ({ tenant, eventCount })) };
  });
  return { status: 'PASS', tenantResults: representative.tenantResults };
    },
    'per-tenant-activation': async () => {
      const result = await phase('tenant-activation-and-authenticated-operation', async () => {
        const output = run(['--import', 'tsx', 'scripts/pdv-unico-migrated-operation.qa.mjs'], { PDV_QA_PRISMA_CLIENT: targetClientDir, PDV_CANONICAL_TENANTS: tenantIds.join(','), PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, NODE_ENV: 'development', PDV_UNLISTED_QA_TENANT: `qa-unselected-${runId}`, PDV_SENTINEL_BASELINE: path.join(tempRoot, 'unselected-baseline.json') });
        return JSON.parse(output.trim().split(/\r?\n/).at(-1));
      });
      return { status: 'PASS', ...result };
    },
  }});
  const report = { status: 'COMPLETED', startedAt: runnerStartedAt, elapsedMs: Math.round(performance.now() - runnerStarted), photoSha256: photoHash, sourceSchemaCommit, kernel, phases: phaseRows };
  const reportPath = process.env.PDV_SEQUENCE_REPORT_FILE;
  if (reportPath) {
    const resolvedReport = path.resolve(reportPath);
    if (!resolvedReport.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Sequence reports may only be written under the OS temporary directory.');
    await writeFile(resolvedReport, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  completed = true;
} finally {
  const retain = !completed && process.env.PDV_QA_KEEP_BLOCKED === '1';
  if (retain && created) {
    const resumePath = path.join(tempRoot, 'qa-operation-resume.json');
    await writeFile(resumePath, JSON.stringify({ containerId, containerName, runId, tempRoot, environment: { ...childEnv(), PDV_QA_PRISMA_CLIENT: targetClientDir, PDV_CANONICAL_TENANTS: tenantIds.join(','), PDV_REPRESENTATIVE_PHOTO_FILE: photoPath, PDV_UNLISTED_QA_TENANT: `qa-unselected-${runId}`, NODE_ENV: 'development' } }), { flag: 'wx' });
    process.stdout.write(`PDV_QA_BLOCKED_RESUME_FILE=${resumePath}\n`);
  }
  if (!retain && created && containerId) {
    const ownership = spawnSync('docker', ['inspect', '-f', '{{.Id}}|{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerId], { encoding: 'utf8', windowsHide: true });
    if (ownership.status !== 0 || ownership.stdout.trim() !== `${containerId}|pdv-unico-sequenced-disposable-qa|${runId}`) throw new Error('Refusing to stop a QA container with mismatched ownership.');
    const stopped = spawnSync('docker', ['stop', containerId], { encoding: 'utf8', windowsHide: true });
    if (stopped.status !== 0) throw new Error('Could not remove the disposable QA container.');
  }
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith(`tap76-sequenced-${runId}-`)) throw new Error('Unsafe QA temp cleanup path.');
  if (!retain) await rm(resolved, { recursive: true, force: true });
}

async function selectPort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve(true)));
    });
    if (available) return candidate;
  }
  throw new Error('No free port in disposable QA range 55439-55449.');
}
