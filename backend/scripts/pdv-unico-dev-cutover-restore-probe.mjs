import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';
import { readReviewedDevMigrations } from './pdv-unico-dev-cutover-ledger.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const args = process.argv.slice(2);
const value = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const databaseName = value('database');
const revision = value('revision') ?? 'HEAD';
const through = value('through') ?? '20261004150000_pdv_finance_session_link';
const recoveryPattern = /^cervejaria_restore_drill_dev_[0-9]{8}_[0-9]{6}$/;
if (!recoveryPattern.test(databaseName ?? '')) throw new Error('Migration probe accepts only its disposable recovery database.');
if (Object.keys(process.env).some((key) => /^PROD(?:_|$)/i.test(key))) throw new Error('PROD-related environment variables are forbidden for the recovery migration probe.');

const envFile = path.join(backendRoot, '.env.development');
const envText = await readFile(envFile, 'utf8');
const databaseLine = envText.split(/\r?\n/).find((line) => line.trim().startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DEV DATABASE_URL is missing for the isolated recovery probe.');
let sourceDatabaseUrl = databaseLine.slice(databaseLine.indexOf('=') + 1).trim();
if ((sourceDatabaseUrl.startsWith('"') && sourceDatabaseUrl.endsWith('"')) || (sourceDatabaseUrl.startsWith("'") && sourceDatabaseUrl.endsWith("'"))) sourceDatabaseUrl = sourceDatabaseUrl.slice(1, -1);
validateDevCutoverEnvironment({ NODE_ENV: 'development', DATABASE_URL: sourceDatabaseUrl });
const recoveryUrl = new URL(sourceDatabaseUrl);
if (!['localhost', '127.0.0.1'].includes(recoveryUrl.hostname) || recoveryUrl.port !== '5434' || recoveryUrl.pathname !== '/cervejaria_dev') throw new Error('Recovery probe source must be the approved local cervejaria_dev database.');
recoveryUrl.pathname = `/${databaseName}`;

const migrations = readReviewedDevMigrations({ repoRoot, revision });
const throughIndex = migrations.findIndex(({ name }) => name === through);
if (throughIndex < 0) throw new Error(`Migration probe boundary is absent from ${revision}: ${through}`);
const migrationFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', 'backend/prisma/migrations'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
  .split(/\r?\n/).filter((name) => name.endsWith('/migration.sql'));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tap76-recovery-migrate-probe-'));
const migrationsRoot = path.join(tempRoot, 'migrations');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const gitBytes = (file) => execFileSync('git', ['cat-file', 'blob', execFileSync('git', ['rev-parse', `${revision}:${file}`], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim()], { cwd: repoRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
try {
  await mkdir(migrationsRoot, { recursive: true });
  await writeFile(path.join(tempRoot, 'schema.prisma'), gitBytes('backend/prisma/schema.prisma'));
  await writeFile(path.join(migrationsRoot, 'migration_lock.toml'), gitBytes('backend/prisma/migrations/migration_lock.toml'));
  const selectedNames = new Set(migrations.slice(0, throughIndex + 1).map(({ name }) => name));
  for (const migrationFile of migrationFiles) {
    const name = migrationFile.split('/').at(-2);
    if (!selectedNames.has(name)) continue;
    const folder = path.join(migrationsRoot, name);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'migration.sql'), gitBytes(migrationFile));
  }
  const childEnv = { ...process.env, NODE_ENV: 'development', DATABASE_URL: recoveryUrl.toString() };
  for (const key of Object.keys(childEnv)) if (/^PROD(?:_|$)/i.test(key) || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || key === 'QA_DATABASE_URL') delete childEnv[key];
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(tempRoot, 'schema.prisma')], {
    cwd: tempRoot, env: childEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  const sanitize = (text) => (text ?? '').replaceAll(recoveryUrl.toString(), '[RECOVERY DATABASE URL REDACTED]').replaceAll(sourceDatabaseUrl, '[DEV DATABASE URL REDACTED]');
  const lines = sanitize(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim().split(/\r?\n/).filter(Boolean).slice(-18);
  if (result.error || result.status !== 0) {
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', through, revision, error: result.error?.message ?? `Prisma migrate deploy exited ${result.status}`, output: lines })}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify({ status: 'PASS', through, revision, migrationCount: throughIndex + 1, appliedOutput: lines })}\n`);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
