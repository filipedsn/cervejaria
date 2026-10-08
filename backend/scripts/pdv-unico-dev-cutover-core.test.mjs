import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGlobalPreflightClear, assertUnlistedTenantUnchanged, buildDevCutoverPlan,
  assertTenantActivationReady, resolveAllowedTenant, validateDevCutoverEnvironment,
  executeCutoverCore, validateQaCutoverEnvironment, scopeCategorySql, DEV_PDV_CUTOVER_SEQUENCE,
} from './pdv-unico-dev-cutover-core.mjs';
import { appendCutoverReceipt, readCutoverReceipts } from './pdv-unico-cutover-receipts.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://qa:secret@127.0.0.1:5434/cervejaria_dev?connection_limit=5' };

test('accepts only the exact local DEV endpoint and never uses the QA marker', () => {
  assert.deepEqual(validateDevCutoverEnvironment(env), { environment: 'DEV', database: 'cervejaria_dev', host: '127.0.0.1', port: '5434' });
  for (const changed of [
    { ...env, NODE_ENV: 'test', PDV_ISOLATED_QA: '1' },
    { ...env, NODE_ENV: 'production' },
    { ...env, DATABASE_URL: 'postgresql://user:pw@127.0.0.1:5434/cervejaria_prod' },
    { ...env, DATABASE_URL: 'postgresql://user:pw@db.example:5434/cervejaria_dev' },
    { ...env, PROD_DATABASE_URL: 'postgresql://user:pw@127.0.0.1:5434/prod' },
    { ...env, PDV_CANONICAL_CONFIG_QA: '1' },
  ]) assert.throws(() => validateDevCutoverEnvironment(changed));
});

test('plan defaults to both allowlisted tenants and keeps activation tenant scoped', () => {
  const plan = buildDevCutoverPlan();
  assert.equal(plan.mode, 'dry-run');
  assert.deepEqual(plan.tenants.map((row) => row.name), ['CIA Marítima', 'Churrasquinho do Thiago']);
  assert.equal(plan.activationScope, 'selected-tenant-only');
  assert.equal(plan.globalDdl, true);
  assert.match(plan.requiredGlobalPreflight, /all tenants/i);
  assert.throws(() => resolveAllowedTenant('tenant-outside-allowlist'));
  assert.throws(() => buildDevCutoverPlan({ tenantIds: ['tenant-outside-allowlist'] }));
});

test('blocks global migration before any DDL if any tenant has a finding', () => {
  assert.throws(() => assertGlobalPreflightClear([]), /coverage/);
  assert.equal(assertGlobalPreflightClear([{ tenantId: 'other', status: 'CLEAR' }]), true);
  assert.throws(() => assertGlobalPreflightClear([{ tenantId: 'other', status: 'BLOCKED', code: 'KITCHEN_ORDER_CONTEXT_REQUIRED' }]), /other:KITCHEN_ORDER_CONTEXT_REQUIRED/);
});

test('QA validates its own destination and verified executor ownership without DEV impersonation', () => {
  const qa = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://qa:secret@127.0.0.1:55439/cervejaria_qa_pdv_unico', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: 'run', PDV_QA_CONTAINER: 'owned' };
  qa.QA_DATABASE_URL = qa.DATABASE_URL;
  const ownership = { verified: true, runId: 'run', containerName: 'owned' };
  assert.equal(validateQaCutoverEnvironment(qa, ownership).environment, 'QA');
  assert.throws(() => validateQaCutoverEnvironment(qa, { ...ownership, runId: 'different' }));
  assert.throws(() => validateDevCutoverEnvironment(qa));
});

test('shared core executes in order and prevents activation after a failed phase or incomplete preflight', async () => {
  const calls = [];
  const phases = DEV_PDV_CUTOVER_SEQUENCE.slice(1);
  const args = { target: { environment: 'QA' }, tenantIds: ['cmr9yis3c0000hvu00q9fe7y1'], runId: 'run', preflight: { queried: true, status: 'CLEAR', tenantCount: 3, coveredTenantCount: 3 }, operations: Object.fromEntries(phases.map(phase => [phase, async () => { calls.push(phase); return { status: 'PASS' }; }])), receipt: async row => { assert.equal(row.runId, 'run'); } };
  assert.equal((await executeCutoverCore(args)).status, 'COMPLETED');
  assert.deepEqual(calls, phases);
  calls.length = 0;
  await assert.rejects(executeCutoverCore({ ...args, preflight: { ...args.preflight, coveredTenantCount: 2 } }), /preflight/);
  assert.deepEqual(calls, []);
  await assert.rejects(executeCutoverCore({ ...args, operations: { ...args.operations, [phases[2]]: async () => ({ status: 'BLOCKED' }) } }), /blocked/);
  assert.ok(!calls.includes('per-tenant-activation'));
});

test('shared core resumes only from contiguous confirmed receipts for the same run and allowlist', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pdv-cutover-receipts-test-'));
  try {
    const file = path.join(directory, 'receipts.jsonl');
    const phases = DEV_PDV_CUTOVER_SEQUENCE.slice(1);
    const tenantIds = ['cmr9yis3c0000hvu00q9fe7y1'];
    const completedPhases = phases.slice(0, 2).map((phase) => ({ runId: 'run', tenantIds, phase, status: 'PASS', durationMs: 5, result: { status: 'PASS' } }));
    for (const row of completedPhases) appendCutoverReceipt(file, row);
    const verified = readCutoverReceipts(file, { runId: 'run', tenantIds });
    const calls = [];
    const operations = Object.fromEntries(phases.map((phase) => [phase, async () => { calls.push(phase); return { status: 'PASS' }; }]));
    const result = await executeCutoverCore({
      target: { environment: 'QA' }, tenantIds, runId: 'run',
      preflight: { queried: true, status: 'CLEAR', tenantCount: 3, coveredTenantCount: 3 },
      operations, completedPhases: verified, receipt: (row) => appendCutoverReceipt(file, row),
      verifyCompletedPhase: async (phase) => ({ status: 'PASS', databaseState: 'RECONCILED', ledger: 'MATCHED', migratorEvidence: phase }),
    });
    assert.equal(result.resumedPhases, 2);
    assert.equal(result.resumeVerification.length, 2);
    assert.deepEqual(calls, phases.slice(2));
    assert.equal(readCutoverReceipts(file, { runId: 'run', tenantIds }).length, phases.length);
    assert.throws(() => readCutoverReceipts(file, { runId: 'different', tenantIds }), /chain is invalid/);
    await assert.rejects(executeCutoverCore({
      target: { environment: 'QA' }, tenantIds, runId: 'run',
      preflight: { queried: true, status: 'CLEAR', tenantCount: 3, coveredTenantCount: 3 },
      operations, completedPhases: verified, receipt: async () => {},
    }), /live database/);
    await assert.rejects(executeCutoverCore({
      target: { environment: 'QA' }, tenantIds, runId: 'run',
      preflight: { queried: true, status: 'CLEAR', tenantCount: 3, coveredTenantCount: 3 },
      operations, completedPhases: verified, receipt: async () => {},
      verifyCompletedPhase: async () => ({ status: 'BLOCKED', code: 'DATABASE_DIVERGENCE' }),
    }), /state diverged/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('category transformation scopes every source and proof read to explicit tenants', () => {
  const sql = 'INSERT INTO "CategoriaProdutoPdv" SELECT * FROM "Produto" p JOIN "PdvCategoriaTransformacaoProduto" e ON true; UPDATE "Produto" p SET "categoriaPdvId" = e.id FROM "PdvCategoriaTransformacaoProduto" e;';
  const scoped = scopeCategorySql(sql, ['cmr9yis3c0000hvu00q9fe7y1']);
  assert.equal((scoped.match(/WHERE "cervejariaId" IN/g) ?? []).length, 3);
  assert.match(scoped, /INSERT INTO "CategoriaProdutoPdv"/);
  assert.match(scoped, /UPDATE "Produto" p/);
  assert.throws(() => scopeCategorySql(sql, []));
  assert.throws(() => scopeCategorySql(sql, ["arbitrary'"]));
});

test('keeps tenants outside the allowlist byte for byte on their previous contract', () => {
  const previous = [{ tenantId: 'other', mode: 'EVENTO', flags: { inventory: false, kitchen: true } }, { tenantId: 'cia', mode: 'EVENTO' }];
  const same = structuredClone(previous);
  assert.equal(assertUnlistedTenantUnchanged(previous, same, ['cia']), true);
  same[0].flags.kitchen = false;
  assert.throws(() => assertUnlistedTenantUnchanged(previous, same, ['cia']), /other/);
});

test('requires per-tenant PDV flags, permissions, and categories before activation', () => {
  const ready = {
    tenantId: 'cmr9yis3c0000hvu00q9fe7y1', pointIds: ['pdv-cia'],
    configuration: { tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false },
    permissionReadiness: { status: 'PASS', ownerExclusiveGrantCount: 0 },
    categoryReadiness: { status: 'PASS', unlinkedProducts: 0 },
  };
  assert.equal(assertTenantActivationReady(ready).status, 'READY');
  assert.throws(() => assertTenantActivationReady({ ...ready, pointIds: ['one', 'two'] }), /exactly one/);
  assert.throws(() => assertTenantActivationReady({ ...ready, categoryReadiness: { status: 'PASS', unlinkedProducts: 1 } }), /unresolved categories/);
  assert.throws(() => assertTenantActivationReady({ ...ready, permissionReadiness: { status: 'PASS', ownerExclusiveGrantCount: 1 } }), /unresolved categories/);
});
