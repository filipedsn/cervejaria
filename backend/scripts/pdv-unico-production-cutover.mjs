import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertClassCSourceMatchesApproval, validateClassCAuthorization } from '../../scripts/prod/pdv-class-c-authorization.mjs';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

export const PRODUCTION_PDV_TENANT_ALLOWLIST = Object.freeze([
  Object.freeze({ id: 'cmsry9xrn0000hvlgopjxy0oo', name: 'Churrasquinho do Thiago' }),
  Object.freeze({ id: 'cmr9yis3c0000hvu00q9fe7y1', name: 'CIA Marítima' }),
]);

export const PRODUCTION_CUTOVER_SEQUENCE = Object.freeze([
  'global-preflight',
  'minimal-prerequisite-migrations',
  'business-catalog-transformations',
  'kitchen-context-preparation',
  'dependent-migrations-with-original-preflight',
  'remaining-tenant-transformations-and-replays',
  'approved-administrative-session-closure',
  'diagnostics-and-integrated-reconciliation',
  'per-tenant-activation',
]);

const receiptDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function readProductionCutoverReceipts(filePath, { runId, tenantIds, checkpointSha256 }) {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error('Production cutover receipt log ends with an incomplete record.');
  const records = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  let previousSha256 = 'GENESIS';
  for (const [index, entry] of records.entries()) {
    const { sha256, ...body } = entry;
    if (body.previousSha256 !== previousSha256 || sha256 !== receiptDigest(body)
      || body.runId !== runId || body.checkpointSha256 !== checkpointSha256
      || JSON.stringify(body.tenantIds) !== JSON.stringify(tenantIds)
      || body.status !== 'PASS' || body.phase !== PRODUCTION_CUTOVER_SEQUENCE[index]) {
      throw new Error(`Production cutover receipt chain is invalid at record ${index + 1}.`);
    }
    previousSha256 = sha256;
  }
  return records.map(({ sha256: _sha256, previousSha256: _previous, ...row }) => row);
}

export function appendProductionCutoverReceipt(filePath, row) {
  const completed = readProductionCutoverReceipts(filePath, row);
  if (row.status !== 'PASS' || row.phase !== PRODUCTION_CUTOVER_SEQUENCE[completed.length]) {
    throw new Error('Only the next confirmed production cutover phase may append a receipt.');
  }
  const prior = existsSync(filePath) ? readFileSync(filePath, 'utf8').trimEnd().split('\n').filter(Boolean).at(-1) : undefined;
  const previousSha256 = prior ? JSON.parse(prior).sha256 : 'GENESIS';
  const body = { ...row, previousSha256 };
  const entry = { ...body, sha256: receiptDigest(body) };
  const descriptor = openSync(filePath, 'a');
  try { writeSync(descriptor, `${JSON.stringify(entry)}\n`, undefined, 'utf8'); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  return entry.sha256;
}

/**
 * Single ordered production phase runner. It validates the checkpoint, freeze,
 * target, and both financial authorizations before invoking any supplied phase.
 * Replays require live verification of every durable receipt before resuming.
 */
export async function executeProductionCutover({
  env = process.env, operations, receiptFile, verifyCompletedPhase,
  validateContext = validateProductionCutoverContext,
} = {}) {
  const productionContext = await validateContext({ env });
  if (!path.isAbsolute(receiptFile ?? '')) throw new Error('Production phase receipts require an explicit absolute path.');
  for (const phase of PRODUCTION_CUTOVER_SEQUENCE) {
    if (typeof operations?.[phase] !== 'function') throw new Error(`Missing executable production phase: ${phase}`);
  }
  const tenantIds = [...productionContext.tenantIds];
  const runId = env.PDV_CUTOVER_RUN_ID;
  if (!runId || !/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error('A stable production cutover run ID is required.');
  await mkdir(path.dirname(receiptFile), { recursive: true });
  const receipts = readProductionCutoverReceipts(receiptFile, {
    runId, tenantIds, checkpointSha256: productionContext.checkpointSha256,
  });
  if (receipts.length && typeof verifyCompletedPhase !== 'function') {
    throw new Error('Production resume requires live database and migrator verification for completed phases.');
  }
  const resumeVerification = [];
  for (const row of receipts) {
    const result = await verifyCompletedPhase(row.phase, row, productionContext);
    if (result?.status !== 'PASS' && result?.status !== 'COMPLETED') throw new Error(`Production resume diverged at phase ${row.phase}.`);
    resumeVerification.push({ phase: row.phase, status: 'PASS', evidence: result });
  }
  const phases = [];
  for (const phase of PRODUCTION_CUTOVER_SEQUENCE.slice(receipts.length)) {
    const started = performance.now();
    const result = await operations[phase]({ productionContext, tenantIds, runId });
    if (result?.status !== 'PASS' && result?.status !== 'COMPLETED') throw new Error(`Production cutover phase blocked: ${phase}`);
    const row = {
      runId, tenantIds, checkpointSha256: productionContext.checkpointSha256,
      checkpointId: productionContext.checkpoint.checkpointId,
      phase, status: 'PASS', durationMs: Math.round(performance.now() - started), result,
    };
    appendProductionCutoverReceipt(receiptFile, row);
    phases.push(row);
  }
  return { status: 'COMPLETED', productionContext, runId, tenantIds, resumedPhases: receipts.length, resumeVerification, phases: [...receipts, ...phases] };
}

function absolutePath(value, name) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an explicit absolute path.`);
  return value;
}

async function readJson(file, readFileImpl) {
  const raw = await readFileImpl(file);
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  return { raw, value: JSON.parse(text) };
}

function parseDatabaseTarget(value) {
  let url;
  try { url = new URL(value ?? ''); } catch { throw new Error('Production cutover DATABASE_URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || url.pathname.length < 2) {
    throw new Error('Production cutover requires a PostgreSQL URL with an explicit database.');
  }
  if ([...url.searchParams.keys()].some((key) => !['schema', 'connection_limit', 'pool_timeout', 'sslmode'].includes(key))) {
    throw new Error('Production cutover DATABASE_URL contains an unapproved option.');
  }
  return Object.freeze({ protocol: url.protocol, host: url.hostname, port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1)) });
}

function assertSameTarget(actual, expected) {
  for (const key of ['protocol', 'host', 'port', 'database']) {
    if (String(actual[key]).toLowerCase() !== String(expected?.[key]).toLowerCase()) {
      throw new Error(`Production cutover destination differs from the verified checkpoint (${key}).`);
    }
  }
}

function tenantIdsFromEnv(env) {
  const tenantIds = (env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
  if (tenantIds.length !== 2 || new Set(tenantIds).size !== tenantIds.length) {
    throw new Error('Production cutover requires the exact two-tenant allowlist.');
  }
  const expected = PRODUCTION_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort();
  if (JSON.stringify([...tenantIds].sort()) !== JSON.stringify(expected)) {
    throw new Error('Production cutover tenant is outside the approved Thiago/CIA Marítima allowlist.');
  }
  return Object.freeze(tenantIds);
}

/**
 * Validate all production-only inputs before PrismaClient is constructed or any migrator runs.
 * The QA rehearsal branch exercises the exact production authorization path against a disposable,
 * owner-attested QA database; it cannot be enabled with NODE_ENV=production.
 */
export async function validateProductionCutoverContext({ env = process.env, readFileImpl = readFile } = {}) {
  if (env.PDV_CUTOVER_PROFILE !== 'production') throw new Error('Production cutover profile is required.');
  const rehearsal = env.PDV_CUTOVER_PRODUCTION_REHEARSAL === '1';
  const target = parseDatabaseTarget(env.DATABASE_URL);

  if (rehearsal) {
    if (env.NODE_ENV !== 'test' || env.PDV_ISOLATED_QA !== '1' || env.QA_DATABASE_URL !== env.DATABASE_URL) {
      throw new Error('Production-profile rehearsal requires the isolated QA environment.');
    }
    validateIsolatedQaEnvironment(env);
    const ownershipFile = absolutePath(env.PDV_QA_OWNERSHIP_FILE, 'PDV_QA_OWNERSHIP_FILE');
    const { value: ownership } = await readJson(ownershipFile, readFileImpl);
    if (ownership.verified !== true || ownership.runId !== env.PDV_QA_RUN_ID || ownership.containerName !== env.PDV_QA_CONTAINER) {
      throw new Error('Production-profile rehearsal target lacks its matching QA ownership receipt.');
    }
  } else {
    if (env.NODE_ENV !== 'production' || env.PDV_ISOLATED_QA || env.QA_DATABASE_URL || env.PDV_CUTOVER_DEV_ADAPTER) {
      throw new Error('Production cutover cannot use QA/DEV environment markers.');
    }
    if (!['localhost', '127.0.0.1'].includes(target.host) || target.port !== '5432' || target.database !== 'cervejaria') {
      throw new Error('Production cutover requires the verified local cervejaria PostgreSQL target.');
    }
  }

  const checkpointFile = absolutePath(env.PDV_CUTOVER_CHECKPOINT_FILE, 'PDV_CUTOVER_CHECKPOINT_FILE');
  const checkpointSha256 = env.PDV_CUTOVER_CHECKPOINT_SHA256;
  if (!/^[a-f0-9]{64}$/.test(checkpointSha256 ?? '')) throw new Error('External checkpoint SHA-256 is required.');
  const { raw: checkpointRaw, value: checkpoint } = await readJson(checkpointFile, readFileImpl);
  const actualCheckpointSha256 = createHash('sha256').update(checkpointRaw).digest('hex');
  if (actualCheckpointSha256 !== checkpointSha256) throw new Error('Checkpoint file does not match its external SHA-256.');
  if (checkpoint.format !== 'tap-quiver-cutover-checkpoint/v1' || checkpoint.status !== 'VERIFIED'
    || checkpoint.environment !== (rehearsal ? 'QA_REHEARSAL' : 'PRODUCTION')
    || typeof checkpoint.checkpointId !== 'string' || !checkpoint.checkpointId.trim()
    || checkpoint.collectedUnderFreeze !== true || !Array.isArray(checkpoint.components)) {
    throw new Error('Checkpoint is not a verified frozen cutover checkpoint.');
  }
  const requiredComponents = ['database', 'uploads', 'configuration', 'runtime'];
  for (const name of requiredComponents) {
    const component = checkpoint.components.find((entry) => entry.name === name);
    if (!component || component.status !== 'PASS' || !/^[a-f0-9]{64}$/.test(component.sha256 ?? '')) {
      throw new Error(`Checkpoint component is missing or unverified: ${name}.`);
    }
  }
  assertSameTarget(target, checkpoint.databaseTarget);

  const freezeFile = absolutePath(env.PDV_CUTOVER_WRITE_FREEZE_FILE, 'PDV_CUTOVER_WRITE_FREEZE_FILE');
  const { value: freeze } = await readJson(freezeFile, readFileImpl);
  if (freeze.blocked !== true || freeze.checkpointId !== checkpoint.checkpointId || freeze.checkpointSha256 !== checkpointSha256) {
    throw new Error('Write freeze receipt does not match the verified checkpoint.');
  }

  const approvalFile = absolutePath(env.PDV_CUTOVER_CLASS_C_APPROVAL_FILE, 'PDV_CUTOVER_CLASS_C_APPROVAL_FILE');
  const productionAuthorizationFile = absolutePath(env.PDV_CUTOVER_PRODUCTION_AUTHORIZATION_FILE, 'PDV_CUTOVER_PRODUCTION_AUTHORIZATION_FILE');
  if (path.resolve(approvalFile).toLowerCase() === path.resolve(productionAuthorizationFile).toLowerCase()) {
    throw new Error('QA/class-C approval and production authorization must be separate files.');
  }
  const sourceEntriesFile = absolutePath(env.PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE, 'PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE');
  const [{ value: approval }, { value: productionAuthorization }, { value: sourceEntries }] = await Promise.all([
    readJson(approvalFile, readFileImpl), readJson(productionAuthorizationFile, readFileImpl), readJson(sourceEntriesFile, readFileImpl),
  ]);
  validateClassCAuthorization({ mode: 'production', approval, originBackupSha256: checkpointSha256, productionAuthorization });
  assertClassCSourceMatchesApproval({ approval, sourceEntries });
  if (approval.sourceCheckpointId !== checkpoint.checkpointId || approval.sourceCheckpointSha256 !== checkpointSha256
    || productionAuthorization.sourceCheckpointId !== checkpoint.checkpointId
    || productionAuthorization.sourceCheckpointSha256 !== checkpointSha256) {
    throw new Error('Class-C approval is not bound to this exact checkpoint.');
  }
  const tenantIds = tenantIdsFromEnv(env);
  return Object.freeze({
    rehearsal, target, checkpoint, checkpointSha256, approval, productionAuthorization, tenantIds,
  });
}
