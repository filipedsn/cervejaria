import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function newlineVariant(bytes, ending) {
  const output = Buffer.allocUnsafe(bytes.length * (ending === 'crlf' ? 2 : 1));
  let target = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x0d && bytes[index + 1] === 0x0a) {
      index += 1;
      if (ending === 'crlf') {
        output[target++] = 0x0d;
        output[target++] = 0x0a;
      } else output[target++] = 0x0a;
    } else if (byte === 0x0a) {
      if (ending === 'crlf') {
        output[target++] = 0x0d;
        output[target++] = 0x0a;
      } else output[target++] = 0x0a;
    } else output[target++] = byte;
  }
  return output.subarray(0, target);
}

/** Hash only the original Git bytes and exact LF/CRLF line-ending variants. */
export function createDevMigrationChecksumRecord(name, gitBytes) {
  if (!Buffer.isBuffer(gitBytes)) throw new TypeError(`Git migration content must be binary: ${name}`);
  const candidates = [
    ['git', gitBytes],
    ['lf', newlineVariant(gitBytes, 'lf')],
    ['crlf', newlineVariant(gitBytes, 'crlf')],
  ];
  const seen = new Set();
  const checksumVariants = candidates.flatMap(([variant, bytes]) => {
    const checksum = sha256(bytes);
    if (seen.has(checksum)) return [];
    seen.add(checksum);
    return [{ variant, checksum }];
  });
  return { name, checksum: sha256(gitBytes), checksumVariants };
}

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repoRoot, encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

/** Read the selected revision's migration blobs and reject real workspace SQL edits. */
export function readReviewedDevMigrations({ repoRoot, revision = 'HEAD', verifyWorkingTree = true }) {
  const files = git(repoRoot, ['ls-tree', '-r', '--name-only', revision, '--', 'backend/prisma/migrations'])
    .split(/\r?\n/).filter((name) => name.endsWith('/migration.sql'));
  if (!files.length) throw new Error(`No reviewed migration SQL exists at Git revision ${revision}.`);
  const migrations = files.map((gitPath) => {
    const name = gitPath.split('/').at(-2);
    const blobObjectId = git(repoRoot, ['rev-parse', `${revision}:${gitPath}`]).trim();
    const workingFile = path.join(repoRoot, ...gitPath.split('/'));
    if (verifyWorkingTree) {
      if (!existsSync(workingFile)) throw new Error(`Reviewed migration is missing from the materialized source: ${gitPath}`);
      const workingBlob = git(repoRoot, ['hash-object', `--path=${gitPath}`, '--', workingFile]).trim();
      if (workingBlob !== blobObjectId) throw new Error(`Migration file differs from reviewed Git SQL: ${gitPath}`);
    }
    const bytes = git(repoRoot, ['cat-file', 'blob', blobObjectId], null);
    return { ...createDevMigrationChecksumRecord(name, bytes), gitPath, blobObjectId };
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return migrations;
}

export class MigrationLedgerDivergenceError extends Error {
  constructor(divergences) {
    super(divergences.map(({ message }) => message).join('\n'));
    this.name = 'MigrationLedgerDivergenceError';
    this.divergences = divergences;
  }
}

/** Validate the complete ordered ledger, accepting only exact Git/LF/CRLF byte variants. */
export function validateDevMigrationLedger({ migrations, ledgerRows, boundary }) {
  if (!Array.isArray(migrations) || !migrations.length || !Array.isArray(ledgerRows)) throw new Error('A complete migration set and queried ledger rows are required.');
  const names = migrations.map((row) => row.name);
  const structural = [];
  if (new Set(names).size !== names.length || names.some((name, index) => index && names[index - 1] >= name)) structural.push({ code: 'INVALID_REVIEWED_MIGRATION_ORDER', message: 'Git migration names must be unique and strictly ordered.' });
  if (!names.includes(boundary)) structural.push({ code: 'MISSING_REVIEWED_BOUNDARY', message: `Reviewed migration boundary is missing from Git: ${boundary}` });
  if (structural.length) throw new MigrationLedgerDivergenceError(structural);

  const expected = new Map(migrations.map((migration) => [migration.name, migration]));
  const grouped = new Map();
  const divergences = [];
  const checksumMatches = [];
  const applied = new Set();
  for (const row of ledgerRows) {
    const name = row.migration_name;
    const migration = expected.get(name);
    const finished = row.finished === true || Boolean(row.finished_at);
    const rolledBack = row.rolled_back === true || Boolean(row.rolled_back_at);
    if (!finished && !rolledBack) divergences.push({ code: 'FAILED_OR_INCOMPLETE_MIGRATION', migration: name ?? null, message: `Failed or incomplete migration exists in database ledger: ${name}` });
    if (!migration) {
      divergences.push({ code: 'UNKNOWN_MIGRATION', migration: name ?? null, message: `Unknown migration in database ledger: ${name}` });
      continue;
    }
    const variants = migration.checksumVariants ?? [{ variant: 'git', checksum: migration.checksum }];
    const ledgerChecksum = typeof row.checksum === 'string' ? row.checksum.toLowerCase() : '';
    const match = variants.find(({ checksum }) => ledgerChecksum === checksum.toLowerCase());
    if (!match) divergences.push({ code: 'CHECKSUM_DIVERGENCE', migration: name, expected: variants.map(({ variant, checksum }) => ({ variant, checksum })), actual: row.checksum, message: `Migration checksum diverges from reviewed Git/LF/CRLF SQL: ${name}` });
    else checksumMatches.push({ migration: name, variant: match.variant, checksum: match.checksum });

    const records = grouped.get(name) ?? [];
    records.push({ finished, rolledBack });
    grouped.set(name, records);
    if (finished && !rolledBack) applied.add(name);
  }

  for (const [name, records] of grouped) {
    if (records.filter((record) => record.finished && !record.rolledBack).length > 1) divergences.push({ code: 'DUPLICATE_SUCCESSFUL_MIGRATION', migration: name, message: `Migration has multiple successful ledger records: ${name}` });
  }
  let gapSeen = false;
  for (const name of names) {
    if (!applied.has(name)) gapSeen = true;
    else if (gapSeen) divergences.push({ code: 'MIGRATION_ORDER_GAP', migration: name, message: `Migration ledger application order has a gap before ${name}.` });
  }
  const boundaryIndex = names.indexOf(boundary);
  const appliedNames = names.filter((name) => applied.has(name));
  const pendingNames = names.filter((name) => !applied.has(name));
  const pendingBeforeBoundary = pendingNames.some((name) => names.indexOf(name) <= boundaryIndex);
  const pendingAfterBoundary = pendingNames.some((name) => names.indexOf(name) > boundaryIndex);
  const boundaryApplied = applied.has(boundary);
  if (boundaryApplied && pendingBeforeBoundary) divergences.push({ code: 'BOUNDARY_ORDER_DIVERGENCE', message: 'Migration ledger is ordered incompatibly around the reviewed boundary.' });
  if (pendingAfterBoundary && !boundaryApplied && appliedNames.some((name) => names.indexOf(name) > boundaryIndex)) divergences.push({ code: 'POST_BOUNDARY_ORDER_DIVERGENCE', message: 'Post-boundary migrations exist before the reviewed boundary.' });
  if (divergences.length) throw new MigrationLedgerDivergenceError(divergences);

  return Object.freeze({
    status: 'VALID',
    appliedCount: appliedNames.length,
    pendingCount: pendingNames.length,
    ledgerRowCount: ledgerRows.length,
    appliedNames,
    pendingNames,
    boundary,
    boundaryApplied,
    checksumMatches,
    stage: pendingNames.length === 0 ? 'schema-complete' : boundaryApplied ? 'after-minimum-migrations' : 'before-minimum-migrations',
  });
}

async function runLedgerCli() {
  const args = process.argv.slice(2);
  const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const ledgerFile = value('ledger-file');
  const revision = value('revision') ?? 'HEAD';
  const boundary = value('boundary') ?? '20261004150000_pdv_finance_session_link';
  if (!ledgerFile) throw new Error('Ledger validation requires --ledger-file.');
  const { readFile } = await import('node:fs/promises');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const ledgerRows = JSON.parse(await readFile(ledgerFile, 'utf8'));
  const migrations = readReviewedDevMigrations({ repoRoot, revision });
  try {
    const result = validateDevMigrationLedger({ migrations, ledgerRows, boundary });
    process.stdout.write(`${JSON.stringify({ ...result, revision })}\n`);
  } catch (error) {
    if (!(error instanceof MigrationLedgerDivergenceError)) throw error;
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', divergences: error.divergences, revision })}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await runLedgerCli();
}
