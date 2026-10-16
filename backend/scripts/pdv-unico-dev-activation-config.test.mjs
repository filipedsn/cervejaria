import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { applyPersistentTenantActivation, assertPersistentTenantActivation, PRODUCTION_CANONICAL_TENANTS, rollbackPersistentTenantActivation } from './pdv-unico-dev-activation-config.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'pdv-activation-config-test-'));
after(() => rm(root, { recursive: true, force: true }));

test('persistent activation writes the startup config and rollback restores exact original bytes', async () => {
  const configPath = path.join(root, '.env.development');
  const backupPath = path.join(root, 'activation-rollback.json');
  const original = 'NODE_ENV=development\r\nDATABASE_URL=postgresql://localhost:5434/cervejaria_dev\r\n';
  await writeFile(configPath, original);
  const applied = await applyPersistentTenantActivation({ configPath, backupPath });
  assert.equal(applied.status, 'PASS');
  assert.equal(applied.changed, true);
  assert.match(await readFile(configPath, 'utf8'), /PDV_CANONICAL_TENANTS=cmr9yis3c0000hvu00q9fe7y1,cmsry9xrn0000hvlgopjxy0oo/);
  assert.equal((await assertPersistentTenantActivation({ configPath })).status, 'PASS');
  const rolledBack = await rollbackPersistentTenantActivation({ configPath, backupPath });
  assert.equal(rolledBack.status, 'PASS');
  assert.equal(await readFile(configPath, 'utf8'), original);
  assert.equal((await rollbackPersistentTenantActivation({ configPath, backupPath })).alreadyRestored, true);
});

test('activation refuses foreign tenant selectors and rollback refuses concurrent config changes', async () => {
  const configPath = path.join(root, 'foreign', '.env.development');
  const backupPath = path.join(root, 'foreign-activation-rollback.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, 'PDV_CANONICAL_TENANTS=unapproved\n');
  await assert.rejects(applyPersistentTenantActivation({ configPath, backupPath }), /outside the reviewed/);

  const mutableConfig = path.join(root, 'mutable', '.env.development');
  const mutableBackup = path.join(root, 'mutable-activation-rollback.json');
  await mkdir(path.dirname(mutableConfig), { recursive: true });
  await writeFile(mutableConfig, 'NODE_ENV=development\n');
  await applyPersistentTenantActivation({ configPath: mutableConfig, backupPath: mutableBackup });
  await writeFile(mutableConfig, `${await readFile(mutableConfig, 'utf8')}PORT=3333\n`);
  await assert.rejects(rollbackPersistentTenantActivation({ configPath: mutableConfig, backupPath: mutableBackup }), /changed after activation/);
});

test('activation allowlist and config path are explicit', async () => {
  const configPath = path.join(root, 'partial', '.env.development');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, 'NODE_ENV=development\n');
  await assert.rejects(applyPersistentTenantActivation({ configPath, tenants: ['cmr9yis3c0000hvu00q9fe7y1'], backupPath: path.join(root, 'partial.json') }), /exactly the reviewed/);
  await assert.rejects(applyPersistentTenantActivation({ configPath: path.join(root, 'production', '.env.production'), backupPath: path.join(root, 'prod.json') }), /\.env\.development/);
});

test('production activation requires the production config path and restores the exact bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdv-production-activation-'));
  try {
    const configPath = path.join(root, '.env.production');
    const backupPath = path.join(root, 'activation.json');
    const original = 'DATABASE_URL=fixture\nPDV_CANONICAL_TENANTS=\n';
    await writeFile(configPath, original, 'utf8');
    const applied = await applyPersistentTenantActivation({ configPath, backupPath, profile: 'production', tenants: PRODUCTION_CANONICAL_TENANTS });
    assert.equal(applied.status, 'PASS');
    assert.match(await readFile(configPath, 'utf8'), /PDV_CANONICAL_TENANTS=cmr9yis3c0000hvu00q9fe7y1,cmsry9xrn0000hvlgopjxy0oo/);
    await assert.rejects(applyPersistentTenantActivation({ configPath, backupPath: path.join(root, 'bad.json'), profile: 'production', tenants: [PRODUCTION_CANONICAL_TENANTS[0]] }), /exactly the reviewed two-tenant/);
    const restored = await rollbackPersistentTenantActivation({ configPath, backupPath, profile: 'production' });
    assert.equal(restored.status, 'PASS');
    assert.equal(await readFile(configPath, 'utf8'), original);
    await assert.rejects(applyPersistentTenantActivation({ configPath: path.join(root, '.env.development'), backupPath: path.join(root, 'wrong.json'), profile: 'production' }), /\.env\.production/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
