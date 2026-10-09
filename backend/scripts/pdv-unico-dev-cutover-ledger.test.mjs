import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createDevMigrationChecksumRecord,
  MigrationLedgerDivergenceError,
  readReviewedDevMigrations,
  validateDevMigrationLedger,
} from './pdv-unico-dev-cutover-ledger.mjs';

const boundary = '20261004150000_pdv_finance_session_link';
const initialName = '20250704180000_init';
const historicalName = '20260731162046_modulo_quiosque_fundacao';
const fixtureMigrations = [
  createDevMigrationChecksumRecord(initialName, Buffer.from('SELECT 1;\nSELECT 2;\n', 'utf8')),
  createDevMigrationChecksumRecord(historicalName, Buffer.from('CREATE TABLE fixture(id int);\n', 'utf8')),
  createDevMigrationChecksumRecord(boundary, Buffer.from('ALTER TABLE fixture ADD COLUMN ok boolean;\n', 'utf8')),
];
const row = (migration, checksum = migration.checksum, fields = {}) => ({ migration_name: migration.name, checksum, finished: true, rolled_back: false, ...fields });
const expectDivergences = (ledgerRows) => {
  try {
    validateDevMigrationLedger({ migrations: fixtureMigrations, ledgerRows, boundary });
    assert.fail('Expected migration ledger to be blocked.');
  } catch (error) {
    assert.ok(error instanceof MigrationLedgerDivergenceError);
    return error.divergences;
  }
};

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

test('accepts the 20260731162046 historical LF checksum from its Git blob', () => {
  const result = validateDevMigrationLedger({
    migrations: fixtureMigrations,
    ledgerRows: [row(fixtureMigrations[0]), row(fixtureMigrations[1]), row(fixtureMigrations[2])],
    boundary,
  });
  assert.equal(result.status, 'VALID');
  assert.equal(result.checksumMatches.find((match) => match.migration === historicalName).variant, 'git');
});

test('accepts the historical init checksum from exact CRLF bytes', () => {
  const init = fixtureMigrations[0];
  const crlfChecksum = createDevMigrationChecksumRecord(init.name, Buffer.from('SELECT 1;\r\nSELECT 2;\r\n', 'utf8')).checksum;
  const result = validateDevMigrationLedger({ migrations: fixtureMigrations, ledgerRows: [row(init, crlfChecksum)], boundary });
  assert.equal(result.checksumMatches[0].variant, 'crlf');
});

test('accepts and reports a ledger mixing LF and CRLF checksums', () => {
  const init = fixtureMigrations[0];
  const initCrlf = createDevMigrationChecksumRecord(init.name, Buffer.from('SELECT 1;\r\nSELECT 2;\r\n', 'utf8')).checksum;
  const result = validateDevMigrationLedger({
    migrations: fixtureMigrations,
    ledgerRows: [row(init, initCrlf), row(fixtureMigrations[1]), row(fixtureMigrations[2])],
    boundary,
  });
  assert.deepEqual(result.checksumMatches.map(({ migration, variant }) => [migration, variant]), [
    [initialName, 'crlf'], [historicalName, 'git'], [boundary, 'git'],
  ]);
});

test('newline variants preserve BOM, encoding bytes, whitespace, and SQL bytes', () => {
  const bomAndTrailingSpace = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('SELECT 1;  \n', 'utf8')]);
  const record = createDevMigrationChecksumRecord('fixture', bomAndTrailingSpace);
  const expectedCrlf = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('SELECT 1;  \r\n', 'utf8')]);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(record.checksumVariants.find(({ variant }) => variant === 'git').checksum, hash(bomAndTrailingSpace));
  assert.equal(record.checksumVariants.find(({ variant }) => variant === 'crlf').checksum, hash(expectedCrlf));
});

test('blocks actual SQL changes in a CRLF checkout while accepting line-ending conversion', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'tap76-ledger-lines-'));
  try {
    git(repo, 'init', '--quiet');
    git(repo, 'config', 'core.autocrlf', 'true');
    writeFileSync(path.join(repo, '.gitattributes'), '*.sql text eol=lf\n');
    const name = '20260101000000_fixture';
    const relative = path.join('backend', 'prisma', 'migrations', name, 'migration.sql');
    const file = path.join(repo, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    const lf = Buffer.from('SELECT 1;\nSELECT 2;\n');
    writeFileSync(file, lf);
    git(repo, 'add', '.gitattributes', relative.replaceAll(path.sep, '/'));
    git(repo, '-c', 'user.name=Ledger Test', '-c', 'user.email=ledger-test@example.invalid', 'commit', '--quiet', '-m', 'fixture');

    writeFileSync(file, Buffer.from('SELECT 1;\r\nSELECT 2;\r\n'));
    const reviewed = readReviewedDevMigrations({ repoRoot: repo, revision: 'HEAD' });
    assert.equal(reviewed.length, 1);
    assert.equal(reviewed[0].checksum, createDevMigrationChecksumRecord(name, lf).checksum);
    assert.deepEqual(readFileSync(file), Buffer.from('SELECT 1;\r\nSELECT 2;\r\n'));

    writeFileSync(file, Buffer.from('SELECT 9;\r\nSELECT 2;\r\n'));
    assert.throws(() => readReviewedDevMigrations({ repoRoot: repo, revision: 'HEAD' }), /differs from reviewed Git SQL/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('blocks an arbitrary checksum that is neither Git, LF, nor CRLF', () => {
  const divergences = expectDivergences([row(fixtureMigrations[0], '0'.repeat(64))]);
  assert.ok(divergences.some(({ code }) => code === 'CHECKSUM_DIVERGENCE'));
});

test('blocks an unknown migration', () => {
  const divergences = expectDivergences([{ migration_name: '20269999999999_unknown', checksum: '0'.repeat(64), finished: true, rolled_back: false }]);
  assert.ok(divergences.some(({ code }) => code === 'UNKNOWN_MIGRATION'));
});

test('blocks a failed or incomplete migration', () => {
  const divergences = expectDivergences([row(fixtureMigrations[0], fixtureMigrations[0].checksum, { finished: false, rolled_back: false })]);
  assert.ok(divergences.some(({ code }) => code === 'FAILED_OR_INCOMPLETE_MIGRATION'));
});

test('blocks an out-of-order ledger', () => {
  const divergences = expectDivergences([row(fixtureMigrations[0]), row(fixtureMigrations[2])]);
  assert.ok(divergences.some(({ code }) => code === 'MIGRATION_ORDER_GAP'));
});

test('reports every independent ledger divergence in one validation pass', () => {
  const divergences = expectDivergences([
    row(fixtureMigrations[0], '0'.repeat(64)),
    { migration_name: '20269999999999_unknown', checksum: '1'.repeat(64), finished: true, rolled_back: false },
    row(fixtureMigrations[1], fixtureMigrations[1].checksum, { finished: false, rolled_back: false }),
    row(fixtureMigrations[2]),
  ]);
  assert.deepEqual(new Set(divergences.map(({ code }) => code)), new Set([
    'CHECKSUM_DIVERGENCE', 'UNKNOWN_MIGRATION', 'FAILED_OR_INCOMPLETE_MIGRATION', 'MIGRATION_ORDER_GAP', 'BOUNDARY_ORDER_DIVERGENCE',
  ]));
});

const boundaryIndex = 89;
const migrations = [
  ...Array.from({ length: 85 }, (_, index) => `202609${String(index).padStart(6, '0')}_existing`),
  ...Array.from({ length: 4 }, (_, index) => `20261003${String(index).padStart(4, '0')}_minimum`),
  boundary,
  ...Array.from({ length: 9 }, (_, index) => `20261005${String(index).padStart(4, '0')}_dependent`),
].sort().map((name) => createDevMigrationChecksumRecord(name, Buffer.from(`${name}\n`)));
const ledger = (count) => migrations.slice(0, count).map((migration) => row(migration));

test('retains 85/90/99 valid DEV ledger states', () => {
  const source = validateDevMigrationLedger({ migrations, ledgerRows: ledger(85), boundary });
  assert.equal(source.stage, 'before-minimum-migrations');
  assert.equal(source.appliedCount, 85);
  const resumed = validateDevMigrationLedger({ migrations, ledgerRows: ledger(boundaryIndex + 1), boundary });
  assert.equal(resumed.stage, 'after-minimum-migrations');
  assert.equal(resumed.appliedCount, 90);
  const complete = validateDevMigrationLedger({ migrations, ledgerRows: ledger(99), boundary });
  assert.equal(complete.stage, 'schema-complete');
  assert.equal(complete.pendingCount, 0);
});
