import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLiveTransformations } from './pdv-unico-live-transformations.mjs';

const repoRoot = path.resolve(process.env.PDV_CUTOVER_TEST_FIXTURE_ROOT ?? process.cwd());
const protectedRoot = path.join(repoRoot, 'artifacts/rbac-permissions-ui-2026-10-10/run-admin-freeze-20261015');
const qaApproval = JSON.parse(await readFile(path.join(protectedRoot, 'class-c-qa-approval.protected.json'), 'utf8'));
const sourceEntries = JSON.parse(await readFile(path.join(protectedRoot, 'class-c-origin-source-entries.protected.json'), 'utf8'));
const photoBytes = await readFile(path.resolve(repoRoot, 'artifacts/qc-20261015/approved-representative-photo.json'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixture(overrides = {}) {
  const directory = path.join(os.tmpdir(), 'pdv-prod-cutover-entrypoint-fixture');
  const files = new Map();
  const checkpoint = {
    format: 'tap-quiver-cutover-checkpoint/v1',
    status: 'VERIFIED',
    environment: 'QA_REHEARSAL',
    checkpointId: 'qa-prod-path-rehearsal-20261016',
    collectedUnderFreeze: true,
    databaseTarget: { protocol: 'postgres:', host: '127.0.0.1', port: '55439', database: 'cervejaria_qa_pdv_unico' },
    components: ['database', 'uploads', 'configuration', 'runtime'].map((name) => ({ name, status: 'PASS', sha256: 'a'.repeat(64) })),
  };
  const checkpointBytes = Buffer.from(JSON.stringify(checkpoint));
  const checkpointSha256 = sha256(checkpointBytes);
  const approval = structuredClone(qaApproval);
  approval.scope = 'TAP-76 production checkpoint';
  approval.sourceCheckpointId = checkpoint.checkpointId;
  approval.sourceCheckpointSha256 = checkpointSha256;
  const productionAuthorization = {
    scope: 'PRODUCTION', decision: 'APPROVED', approvedBy: 'SYNTHETIC QA FIXTURE ONLY', approvedAt: '2026-10-16T10:00:00.000Z',
    sourceCheckpointId: checkpoint.checkpointId, sourceCheckpointSha256: checkpointSha256,
    payloadSha256: approval.approvedSnapshotSha256, idsSha256: '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128',
  };
  const checkpointFile = path.join(directory, 'checkpoint.json');
  const freezeFile = path.join(directory, 'freeze.json');
  const approvalFile = path.join(directory, 'approval.json');
  const authorizationFile = path.join(directory, 'authorization.json');
  const sourceFile = path.join(directory, 'source.json');
  const ownershipFile = path.join(directory, 'ownership.json');
  const photoFile = path.join(directory, 'photo.json');
  const putJson = (file, value) => files.set(file, Buffer.from(JSON.stringify(value)));
  files.set(checkpointFile, checkpointBytes);
  putJson(freezeFile, { blocked: true, checkpointId: checkpoint.checkpointId, checkpointSha256 });
  putJson(approvalFile, overrides.approval ?? approval);
  putJson(authorizationFile, overrides.productionAuthorization ?? productionAuthorization);
  putJson(sourceFile, overrides.sourceEntries ?? sourceEntries);
  putJson(ownershipFile, { verified: true, runId: 'qa-run-20261016', containerName: 'pdv-qa-synthetic' });
  files.set(photoFile, photoBytes);
  const env = {
    NODE_ENV: 'test', PDV_CUTOVER_PROFILE: 'production', PDV_CUTOVER_PRODUCTION_REHEARSAL: '1',
    PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgres://qa:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico',
    DATABASE_URL: 'postgres://qa:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico',
    PDV_QA_RUN_ID: 'qa-run-20261016', PDV_QA_CONTAINER: 'pdv-qa-synthetic', PDV_QA_OWNERSHIP_FILE: ownershipFile,
    PDV_CUTOVER_CHECKPOINT_FILE: checkpointFile, PDV_CUTOVER_CHECKPOINT_SHA256: overrides.checkpointSha256 ?? checkpointSha256,
    PDV_CUTOVER_WRITE_FREEZE_FILE: freezeFile, PDV_CUTOVER_CLASS_C_APPROVAL_FILE: approvalFile,
    PDV_CUTOVER_PRODUCTION_AUTHORIZATION_FILE: authorizationFile, PDV_CUTOVER_CLASS_C_SOURCE_ENTRIES_FILE: sourceFile,
    PDV_CUTOVER_TENANTS: 'cmsry9xrn0000hvlgopjxy0oo,cmr9yis3c0000hvu00q9fe7y1',
    PDV_CUTOVER_RUN_ID: 'run-prod-profile-qa-20261016',
    PDV_CUTOVER_PRISMA_CLIENT: path.join(directory, 'prisma/index.js'), TEMP: directory,
    PDV_REPRESENTATIVE_PHOTO_FILE: photoFile,
  };
  if (overrides.env) Object.assign(env, overrides.env);
  let dbCreations = 0;
  const financeCalls = [];
  const classCDispositionCalls = [];
  const db = { pontoVenda: { findMany: async ({ where }) => [{ id: `point-${where.cervejariaId}` }] }, $disconnect: async () => {} };
  const completed = async () => ({ status: 'COMPLETED', runId: 'mock-run', counts: {} });
  const migrations = {
    runPdvTapOwnershipMigration: completed,
    runPdvSessionMigration: completed,
    runPdvFinanceMigration: async (options) => { financeCalls.push(options); return completed(); },
    runPdvCommerceMigration: completed,
    runPdvKitchenOrderContextPreparation: completed,
  };
  const dependencies = {
    readFile: async (file) => {
      const key = path.resolve(file);
      if (!files.has(key)) throw new Error(`Unexpected fixture read: ${key}`);
      return files.get(key);
    },
    access: async () => {},
    createDb: async () => { dbCreations++; return db; },
    migrations,
    applyApprovedClassCOutOfScopeDisposition: async (input) => {
      classCDispositionCalls.push(input);
      return { status: 'COMPLETED', runId: `${input.baseRunId}-classc-fixture`, count: 2, reusedCompletedRun: false };
    },
  };
  return { env, files, checkpoint, checkpointSha256, approval, productionAuthorization, sourceEntries, dependencies, financeCalls, classCDispositionCalls, get dbCreations() { return dbCreations; } };
}

test('production entrypoint accepts the exact checkpoint-bound production authorization and forwards it to finance', async () => {
  const f = fixture();
  const result = await runLiveTransformations({ env: f.env, dependencies: f.dependencies, write: () => {} });
  assert.equal(result.status, 'PASS');
  assert.equal(result.tenants.length, 2);
  assert.equal(f.financeCalls.length, 8);
  assert.equal(f.classCDispositionCalls.length, 1);
  assert.deepEqual(f.classCDispositionCalls[0].approval, f.approval);
  assert.equal(f.classCDispositionCalls[0].productionContext.checkpointSha256, f.checkpointSha256);
  assert.deepEqual(f.classCDispositionCalls[0].productionContext.productionAuthorization, f.productionAuthorization);
  assert.equal(f.classCDispositionCalls[0].baseRunId, f.env.PDV_CUTOVER_RUN_ID);
  for (const call of f.financeCalls) {
    assert.equal(call.executionProfile, 'production');
    assert.equal(call.sourceCheckpointId, f.checkpoint.checkpointId);
    assert.equal(call.sourceCheckpointSha256, f.checkpointSha256);
    assert.deepEqual(call.historicalNoSessionProductionAuthorization, f.productionAuthorization);
    assert.deepEqual(call.historicalNoSessionApproval, f.approval);
  }
});

test('QA approval alone is rejected in production before database construction', async () => {
  const f = fixture({ approval: qaApproval });
  await assert.rejects(runLiveTransformations({ env: f.env, dependencies: f.dependencies, write: () => {} }), /CLASS_C_EXPLICIT_PRODUCTION_AUTHORIZATION_REQUIRED|CLASS_C_PRODUCTION_SOURCE_MISMATCH/);
  assert.equal(f.dbCreations, 0);
});

test('checkpoint digest mismatch and destination mismatch are rejected before effects', async () => {
  const wrongDigest = fixture({ checkpointSha256: 'b'.repeat(64) });
  await assert.rejects(runLiveTransformations({ env: wrongDigest.env, dependencies: wrongDigest.dependencies, write: () => {} }), /external SHA-256/);
  assert.equal(wrongDigest.dbCreations, 0);

  const wrongDestination = fixture();
  wrongDestination.checkpoint.databaseTarget.port = '55440';
  wrongDestination.files.set(wrongDestination.env.PDV_CUTOVER_CHECKPOINT_FILE, Buffer.from(JSON.stringify(wrongDestination.checkpoint)));
  wrongDestination.env.PDV_CUTOVER_CHECKPOINT_SHA256 = sha256(wrongDestination.files.get(wrongDestination.env.PDV_CUTOVER_CHECKPOINT_FILE));
  await assert.rejects(runLiveTransformations({ env: wrongDestination.env, dependencies: wrongDestination.dependencies, write: () => {} }), /destination differs/);
  assert.equal(wrongDestination.dbCreations, 0);
});

test('altered values, added or removed IDs in the frozen source are rejected before effects', async (t) => {
  for (const [name, mutate] of [
    ['value', (rows) => { rows[0].cents = '999999'; }],
    ['added ID', (rows) => { rows.push({ ...rows[0], id: 'new-unapproved-id' }); }],
    ['removed ID', (rows) => { rows.pop(); }],
  ]) {
    await t.test(name, async () => {
      const changed = structuredClone(sourceEntries);
      mutate(changed);
      const f = fixture({ sourceEntries: changed });
      await assert.rejects(runLiveTransformations({ env: f.env, dependencies: f.dependencies, write: () => {} }), /CLASS_C_SOURCE_(CONTENT|ID)(?:_SET)?_MISMATCH/);
      assert.equal(f.dbCreations, 0);
    });
  }
});

test('tenant outside production allowlist is rejected before effects', async () => {
  const f = fixture({ env: { PDV_CUTOVER_TENANTS: 'cmsry9xrn0000hvlgopjxy0oo,unauthorized-tenant' } });
  await assert.rejects(runLiveTransformations({ env: f.env, dependencies: f.dependencies, write: () => {} }), /approved Thiago\/CIA Marítima allowlist/);
  assert.equal(f.dbCreations, 0);
});
