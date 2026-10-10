import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const schemaPath = 'backend/prisma/schema.prisma';
const lockPath = 'backend/prisma/migrations/migration_lock.toml';

function git(args, encoding = 'buffer') {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: encoding === 'buffer' ? undefined : encoding });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? result.stdout).slice(0, 500)}`);
  return result.stdout;
}

const digest = (data) => createHash('sha256').update(data).digest('hex');
const snapshotRoot = process.env.PDV_GIT_QA_SNAPSHOT ? path.resolve(process.env.PDV_GIT_QA_SNAPSHOT) : null;
const sourceBytes = (gitPath, baseCommit) => snapshotRoot
  ? readFile(path.join(snapshotRoot, gitPath))
  : git(['show', `${baseCommit}:${gitPath}`]);
async function snapshotMigrationPaths() {
  const root = path.join(snapshotRoot, 'backend/prisma/migrations');
  const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const paths = [];
  for (const name of names) {
    try { await readFile(path.join(root, name, 'migration.sql')); paths.push(`backend/prisma/migrations/${name}/migration.sql`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return paths;
}
export function currentCommit() { return String(git(['rev-parse', 'HEAD'], 'utf8')).trim(); }

export async function createPinnedManifest(baseCommit = currentCommit()) {
  const paths = snapshotRoot
    ? await snapshotMigrationPaths()
    : String(git(['ls-tree', '-r', '--name-only', baseCommit, '--', 'backend/prisma/migrations'], 'utf8'))
    .split(/\r?\n/).filter((name) => name.endsWith('/migration.sql')).sort();
  if (paths.length === 0) throw new Error('Pinned migration manifest cannot be empty');
  const migrations = await Promise.all(paths.map(async (gitPath) => ({
    name: gitPath.split('/').at(-2),
    gitPath,
    sha256: digest(await sourceBytes(gitPath, baseCommit)),
  })));
  const schemaSha256 = digest(await sourceBytes(schemaPath, baseCommit));
  const lockSha256 = digest(await sourceBytes(lockPath, baseCommit));
  const manifestData = { baseCommit, provider: 'postgresql', schemaPath, schemaSha256, lockPath, lockSha256, migrations };
  const manifestSha256 = digest(Buffer.from(JSON.stringify(manifestData)));
  return { ...manifestData, manifestSha256 };
}

export async function verifyPinnedManifest(manifest) {
  if (!snapshotRoot) {
    const commit = String(git(['cat-file', '-t', manifest.baseCommit], 'utf8')).trim();
    if (commit !== 'commit') throw new Error(`Pinned migration base is not a commit: ${manifest.baseCommit}`);
  }
  const actual = await createPinnedManifest(manifest.baseCommit);
  if (actual.manifestSha256 !== manifest.manifestSha256) throw new Error('Pinned migration manifest differs from committed Git objects');
  if (JSON.stringify(actual.migrations) !== JSON.stringify(manifest.migrations)) throw new Error('Migration sequence differs from pinned manifest');
  return actual;
}

export async function materializePinnedMigrationBundle(manifest, destination, { exclude = [] } = {}) {
  await verifyPinnedManifest(manifest);
  if (exclude.some((name) => !manifest.migrations.some((migration) => migration.name === name))) throw new Error('Cannot exclude migration absent from pinned manifest');
  const prismaDir = path.join(destination, 'prisma');
  const migrationsDir = path.join(prismaDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(path.join(prismaDir, 'schema.prisma'), await sourceBytes(manifest.schemaPath, manifest.baseCommit));
  await writeFile(path.join(migrationsDir, 'migration_lock.toml'), await sourceBytes(manifest.lockPath, manifest.baseCommit));
  for (const migration of manifest.migrations) {
    if (exclude.includes(migration.name)) continue;
    const targetDir = path.join(migrationsDir, migration.name);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'migration.sql'), await sourceBytes(migration.gitPath, manifest.baseCommit));
  }
  return { schemaPath: path.join(prismaDir, 'schema.prisma'), migrationsDir };
}

export async function writePinnedMigration(manifest, name, destination) {
  const migration = manifest.migrations.find((item) => item.name === name);
  if (!migration) throw new Error(`Migration is not part of pinned manifest: ${name}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await sourceBytes(migration.gitPath, manifest.baseCommit));
}

if (process.argv[2] === '--write') {
  const output = path.resolve(repoRoot, process.argv[3] ?? 'docs/testing/pdv-unico-qa-migration-manifest.json');
  const manifest = await createPinnedManifest(process.argv[4] ?? currentCommit());
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote pinned manifest base=${manifest.baseCommit} migrations=${manifest.migrations.length} sha256=${manifest.manifestSha256} file=${path.relative(repoRoot, output)}`);
}
