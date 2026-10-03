import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdvMigrationClient } from './pdv-unico-business-migrate.qa.mjs';

test('import does not instantiate Prisma or connect', async () => {
  let loaded = false;
  assert.equal(typeof createPdvMigrationClient, 'function');
  await assert.rejects(() => createPdvMigrationClient({ DATABASE_URL: 'postgresql://prod.invalid/app' }, async () => { loaded = true; return {}; }), /QA_ISOLADO|isolado/i);
  assert.equal(loaded, false, 'destination must be rejected before loading Prisma');
});

test('shared DEV and arbitrary hosts are rejected before Prisma loading', async () => {
  for (const env of [
    { PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgresql://dev@127.0.0.1:5432/cervejaria_dev' },
    { PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgresql://qa@db.internal:55439/cervejaria_qa_pdv_unico' },
    { PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgresql://qa@127.0.0.1:55439/other_db' },
  ]) {
    let loaded = false;
    await assert.rejects(() => createPdvMigrationClient(env, async () => { loaded = true; return {}; }));
    assert.equal(loaded, false);
  }
});

test('the allowlisted disposable destination is passed explicitly after validation', async () => {
  const env = { PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgresql://qa:secret@127.0.0.1:55439/cervejaria_qa_pdv_unico' };
  let captured;
  const client = await createPdvMigrationClient(env, async () => ({ PrismaClient: class { constructor(options) { captured = options; } } }));
  assert.deepEqual(captured, { datasources: { db: { url: env.QA_DATABASE_URL } } });
  assert.ok(client instanceof Object);
});
