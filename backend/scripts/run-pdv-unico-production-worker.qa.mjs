import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolRoot = path.resolve(backend, '..');
const repoRoot = path.resolve(toolRoot, '..', '..', '..', '..');
const candidateRoot = path.join(repoRoot, 'deploy/release-candidates/a415a08a4c410c5c0db1ce57be9b19ce763706ad');
const container = process.env.PDV_QA_CONTAINER;
const targetUrl = process.env.DATABASE_URL;
if (!container || !targetUrl || process.env.PDV_ALLOW_PRODUCTION_WORKER_QA !== '1') throw new Error('Set explicit QA container, disposable DATABASE_URL, and PDV_ALLOW_PRODUCTION_WORKER_QA=1.');
const parsedTarget = new URL(targetUrl);
assert.ok(['localhost', '127.0.0.1'].includes(parsedTarget.hostname));
assert.match(parsedTarget.port, /^554(?:3[9]|4[0-9]|50)$/);
assert.equal(parsedTarget.pathname, '/cervejaria_qa_pdv_unico');
const runId = `qa-prod-worker-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`;
const evidenceRoot = path.resolve(process.env.PDV_QA_WORKER_EVIDENCE_ROOT ?? path.join(repoRoot, 'artifacts/qc-20261016/prod-worker-composition-qa'));
const tempRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), `${runId}-`)));
await mkdir(evidenceRoot, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: options.encoding ?? 'utf8', windowsHide: true, maxBuffer: 160 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status}): ${String(result.stderr ?? result.stdout).slice(-4000)}`);
  return result.stdout;
}
function jsonWrite(file, value) { return writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }

const info = JSON.parse(run('docker', ['inspect', container]));
assert.equal(info[0]?.State?.Status, 'running');
assert.equal(info[0]?.Config?.Labels?.['codex.purpose'], 'pdv-unico-production-orchestration-qa');
const port = run('docker', ['port', container, '5432/tcp']).trim();
assert.match(port, /^127\.0\.0\.1:554\d+$/);
assert.equal(info[0]?.Config?.Env?.some((value) => value.startsWith('POSTGRES_DB=cervejaria_qa_pdv_unico')), true);

const postgresUser = info[0]?.Config?.Env?.find((value) => value.startsWith('POSTGRES_USER='))?.slice('POSTGRES_USER='.length);
assert.ok(postgresUser, 'QA container must declare its local PostgreSQL role');
const dump = run('docker', ['exec', container, 'pg_dump', '-U', postgresUser, '--no-owner', '--no-privileges', '-d', 'cervejaria_qa_pdv_unico'], { encoding: null });
const dumpPath = path.join(evidenceRoot, `${runId}.database.dump.sql`);
await writeFile(dumpPath, dump, { flag: 'wx' });
const dumpSha256 = hash(dump);
const checkpointId = `${runId}-checkpoint`;
const checkpoint = {
  format: 'tap-quiver-cutover-checkpoint/v1', status: 'VERIFIED', environment: 'QA_REHEARSAL', checkpointId, collectedUnderFreeze: true,
  databaseTarget: { protocol: parsedTarget.protocol, host: parsedTarget.hostname, port: parsedTarget.port, database: decodeURIComponent(parsedTarget.pathname.slice(1)) },
  components: [
    { name: 'database', status: 'PASS', sha256: dumpSha256, sourceDump: path.basename(dumpPath) },
    { name: 'uploads', status: 'PASS', sha256: hash(Buffer.alloc(0)), fixture: 'empty uploads directory for disposable QA' },
    { name: 'configuration', status: 'PASS', sha256: hash(await readFile(path.join(candidateRoot, 'candidate-manifest.json'))), fixture: 'retained a415 package manifest' },
    { name: 'runtime', status: 'PASS', sha256: hash(await readFile(path.join(candidateRoot, 'source-snapshot-inventory.json'))), fixture: 'retained a415 inventory' },
  ],
};
const checkpointFile = path.join(evidenceRoot, `${runId}.checkpoint.json`);
await jsonWrite(checkpointFile, checkpoint);
const checkpointSha256 = hash(await readFile(checkpointFile));
const freezeFile = path.join(evidenceRoot, `${runId}.freeze.json`);
await jsonWrite(freezeFile, { blocked: true, checkpointId, checkpointSha256, scope: 'QA fixture only', verifiedBy: 'QA worker harness' });
const ownershipFile = path.join(evidenceRoot, `${runId}.ownership.json`);
await jsonWrite(ownershipFile, { verified: true, runId, containerName: container, purpose: 'pdv-unico-production-orchestration-qa' });

const validationRoot = path.join(repoRoot, 'artifacts/qc-20261016/prod-window-49f8972/class-c-validator-rehearsal');
const approval = JSON.parse(await readFile(path.join(validationRoot, 'synthetic-production-approval.qa-only.json'), 'utf8'));
const sourceFacts = JSON.parse(await readFile(path.join(validationRoot, 'source-facts.json'), 'utf8'));
assert.equal(approval.entries.length, 579);
assert.equal(hash(Buffer.from(JSON.stringify(approval.entries))), '6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9');
assert.equal(hash(Buffer.from(JSON.stringify(approval.entries.map(({ id }) => id).sort()))), '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128');
approval.scope = 'TAP-76 production checkpoint';
approval.sourceCheckpointId = checkpointId;
approval.sourceCheckpointSha256 = checkpointSha256;
const approvalFile = path.join(evidenceRoot, `${runId}.approval.json`);
await jsonWrite(approvalFile, approval);
const sourceEntriesFile = path.join(evidenceRoot, `${runId}.source-facts.json`);
await jsonWrite(sourceEntriesFile, sourceFacts);
const productionAuthorizationFile = path.join(evidenceRoot, `${runId}.production-authorization.json`);
await jsonWrite(productionAuthorizationFile, {
  scope: 'PRODUCTION', decision: 'APPROVED', approvedBy: 'SYNTHETIC QA FIXTURE ONLY', approvedAt: new Date().toISOString(),
  sourceCheckpointId: checkpointId, sourceCheckpointSha256: checkpointSha256,
  payloadSha256: approval.approvedSnapshotSha256, idsSha256: '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128',
});

const activationDirectory = path.join(tempRoot, 'qa-activation');
await mkdir(activationDirectory, { recursive: true });
const activationFile = path.join(activationDirectory, '.env.production');
const activationEvidenceFile = path.join(evidenceRoot, `${runId}.env.production`);
await writeFile(activationFile, 'NODE_ENV=production\nPDV_CANONICAL_TENANTS=\n', { flag: 'wx' });
const receiptsDir = path.join(evidenceRoot, `${runId}.receipts`);
await mkdir(receiptsDir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: container,
  QA_DATABASE_URL: targetUrl, DATABASE_URL: targetUrl,
  PDV_CUTOVER_PROFILE: 'production', PDV_CUTOVER_PRODUCTION_REHEARSAL: '1',
  PDV_QA_OWNERSHIP_FILE: ownershipFile,
  PDV_CUTOVER_CHECKPOINT_FILE: checkpointFile, PDV_CUTOVER_CHECKPOINT_SHA256: checkpointSha256,
  PDV_CUTOVER_WRITE_FREEZE_FILE: freezeFile, PDV_CUTOVER_CLASS_C_APPROVAL_FILE: approvalFile,
  PDV_CUTOVER_PRODUCTION_AUTHORIZATION_FILE: productionAuthorizationFile, PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE: sourceEntriesFile,
  PDV_CUTOVER_TENANTS: 'cmsry9xrn0000hvlgopjxy0oo,cmr9yis3c0000hvu00q9fe7y1',
  PDV_CUTOVER_RUN_ID: runId, PDV_CUTOVER_APPLICATION_SHA: 'a415a08a4c410c5c0db1ce57be9b19ce763706ad',
  PDV_CUTOVER_MANIFEST_SHA256: '8e6cfdb410e430ae85e3efdc3857b6df7375f28154d8d500b0545d35a6c73238',
  PDV_CUTOVER_PACKAGE_MANIFEST_FILE: path.join(candidateRoot, 'candidate-manifest.json'), PDV_CUTOVER_APP_ROOT: candidateRoot,
  PDV_CUTOVER_SCHEMA_FILE: path.join(candidateRoot, 'backend/prisma/schema.prisma'),
  PDV_CUTOVER_MIGRATIONS_ROOT: path.join(candidateRoot, 'backend/prisma/migrations'),
  PDV_CUTOVER_PRISMA_CLIENT: path.join(tempRoot, 'target-client'),
  PDV_CUTOVER_PRECOMMERCE_PRISMA_CLIENT: path.join(tempRoot, 'precommerce-client'),
  PDV_CUTOVER_PRECOMMERCE_SCHEMA_FILE: path.join(backend, 'prisma/pdv-precommerce-schema-worker-v2.prisma'),
  PDV_CUTOVER_ACTIVATION_CONFIG: activationFile, PDV_CUTOVER_RECEIPTS_DIR: receiptsDir,
  PDV_CUTOVER_PHASE_RECEIPTS: path.join(receiptsDir, `${runId}.phases.jsonl`),
  PDV_CUTOVER_ADMIN_REASON: 'Encerramento administrativo de sessão histórica QA; contagens preservadas como desconhecidas.',
  TEMP: tempRoot, TMP: tempRoot,
};
const command = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pdv-unico-production-cutover-worker.mjs'], { cwd: backend, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const redacted = `${command.stdout ?? ''}\n${command.stderr ?? ''}`.replaceAll(targetUrl, '[QA DATABASE URL REDACTED]');
let worker;
try { worker = JSON.parse((command.stdout ?? '').trim().split(/\r?\n/).at(-1)); } catch { worker = null; }
const receiptFile = env.PDV_CUTOVER_PHASE_RECEIPTS;
const phaseReceipts = await import('node:fs/promises').then(({ readFile }) => readFile(receiptFile, 'utf8').catch(() => ''));
const phaseCount = phaseReceipts.split(/\r?\n/).filter(Boolean).length;
await import('node:fs/promises').then(({ copyFile }) => copyFile(activationFile, activationEvidenceFile).catch(() => {}));
const status = command.status === 0 && worker?.status === 'COMPLETED' && worker.phases?.length === 9 && phaseCount === 9 ? 'PASS' : 'BLOCKED';
const report = { status, runId, container, port, checkpoint: { id: checkpointId, sha256: checkpointSha256, dumpSha256 }, application: { sha: env.PDV_CUTOVER_APPLICATION_SHA, manifestSha256: env.PDV_CUTOVER_MANIFEST_SHA256 }, workerExitCode: command.status, workerStatus: worker?.status ?? null, completedPhases: worker?.phases?.length ?? 0, persistedPhaseReceipts: phaseCount, output: redacted.slice(-20000) };
const reportFile = path.join(evidenceRoot, `${runId}.worker-report.json`);
await jsonWrite(reportFile, report);
process.stdout.write(`${JSON.stringify({ ...report, reportFile, activationEvidenceFile, dump: { path: dumpPath, bytes: dump.length } }, null, 2)}\n`);
if (status !== 'PASS') process.exitCode = command.status ?? 1;
