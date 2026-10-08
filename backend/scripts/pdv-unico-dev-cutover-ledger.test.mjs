import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { validateDevMigrationLedger } from './pdv-unico-dev-cutover-ledger.mjs';

const boundary = '20261004150000_pdv_finance_session_link';
const migrations = [
  ...Array.from({ length: 85 }, (_, index) => ({ name: `202609${String(index).padStart(6, '0')}_existing`, checksum: '' })),
  ...Array.from({ length: 4 }, (_, index) => ({ name: `20261003${String(index).padStart(4, '0')}_minimum`, checksum: '' })),
  { name: boundary, checksum: '' },
  ...Array.from({ length: 9 }, (_, index) => ({ name: `20261005${String(index).padStart(4, '0')}_dependent`, checksum: '' })),
].map((row) => ({ ...row, checksum: createHash('sha256').update(row.name).digest('hex') })).sort((a, b) => a.name.localeCompare(b.name));

const ledger = (count) => migrations.slice(0, count).map(({ name, checksum }) => ({ migration_name: name, checksum, finished: true, rolled_back: false }));

test('accepts the normal source ledger: 85 applied, 14 pending, boundary not applied', () => {
  const result = validateDevMigrationLedger({ migrations, ledgerRows: ledger(85), boundary });
  assert.equal(result.status, 'VALID');
  assert.equal(result.stage, 'before-minimum-migrations');
  assert.equal(result.appliedCount, 85);
  assert.equal(result.pendingCount, 14);
  assert.equal(result.boundaryApplied, false);
});

test('accepts resume after the minimum migration batch through the boundary', () => {
  const boundaryIndex = migrations.findIndex(({ name }) => name === boundary);
  const result = validateDevMigrationLedger({ migrations, ledgerRows: ledger(boundaryIndex + 1), boundary });
  assert.equal(result.stage, 'after-minimum-migrations');
  assert.equal(result.appliedCount, 90);
  assert.equal(result.pendingCount, 9);
  assert.equal(result.boundaryApplied, true);
});

test('accepts a schema-complete ledger with all 99 exact migrations', () => {
  const result = validateDevMigrationLedger({ migrations, ledgerRows: ledger(99), boundary });
  assert.equal(result.stage, 'schema-complete');
  assert.equal(result.appliedCount, 99);
  assert.equal(result.pendingCount, 0);
});

test('rejects unknown, checksum-divergent, failed, and out-of-order ledgers', () => {
  const badChecksum = ledger(85);
  badChecksum[0] = { ...badChecksum[0], checksum: '0'.repeat(64) };
  const failed = [...ledger(85), { ...migrations[85], migration_name: migrations[85].name, finished: false, rolled_back: false }];
  const outOfOrder = [migrations[0], migrations[2]].map(({ name, checksum }) => ({ migration_name: name, checksum, finished: true, rolled_back: false }));
  assert.throws(() => validateDevMigrationLedger({ migrations, ledgerRows: [...ledger(85), { migration_name: '20269999999999_unknown', checksum: '0'.repeat(64), finished: true, rolled_back: false }], boundary }), /Unknown migration/);
  assert.throws(() => validateDevMigrationLedger({ migrations, ledgerRows: badChecksum, boundary }), /checksum diverges/);
  assert.throws(() => validateDevMigrationLedger({ migrations, ledgerRows: failed, boundary }), /Failed or incomplete/);
  assert.throws(() => validateDevMigrationLedger({ migrations, ledgerRows: outOfOrder, boundary }), /order has a gap/);
});
