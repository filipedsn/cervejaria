import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { assertTestProdWriteGuard } from '../../scripts/test-prod-write-guard.mjs';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variables = parse(await readFile(path.join(backend, '.env.development')));
assertTestProdWriteGuard({ environment: { ...variables, NODE_ENV: 'development' }, requireDevDatabase: true, context: 'agenda archive DEV migration' });
const runtime = new URL(variables.DATABASE_URL);
const migration = new URL(variables.MIGRATE_DATABASE_URL || variables.DATABASE_URL);
if (runtime.hostname !== migration.hostname || runtime.port !== migration.port || runtime.pathname !== migration.pathname || migration.port !== '5434' || migration.pathname !== '/cervejaria_dev') throw new Error('Refusing migration outside the exact DEV database.');
const name = '20261009180000_agenda_archive';
const temporary = await mkdtemp(path.join(tmpdir(), 'agenda-archive-dev-'));
try {
  await mkdir(path.join(temporary, 'migrations', name), { recursive: true });
  await writeFile(path.join(temporary, 'schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n schemas = ["public", "quiosque"]\n}\n');
  await writeFile(path.join(temporary, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  await writeFile(path.join(temporary, 'migrations', name, 'migration.sql'), await readFile(path.join(backend, 'prisma', 'migrations', name, 'migration.sql')));
  // The standard environment runner selects DEV migration credentials. This
  // bundle contains only this migration; unrelated local migrations are excluded.
  const result = spawnSync(process.execPath, ['scripts/run-with-env.mjs', 'development', 'npx', 'prisma', 'migrate', 'deploy', '--schema', path.join(temporary, 'schema.prisma')], { cwd: backend, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`DEV archive migration failed (exit ${result.status}); inspect DEV migration status without printing credentials.`);
  console.log(`DEV_MIGRATION_APPLIED=${name}; target=cervejaria_dev:5434; only-this-migration`);
} finally {
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('agenda-archive-dev-')) throw new Error('Unexpected temporary migration path.');
  await rm(resolved, { recursive: true, force: true });
}
