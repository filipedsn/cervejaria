import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { createPinnedManifest, materializePinnedMigrationBundle } from './pdv-unico-qa-migration-manifest.mjs';

const runId = randomBytes(8).toString('hex');
const container = `codex-pdv-permissions-qa-${runId}`;
const port = await selectPort();
const password = randomBytes(32).toString('base64url');
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
url.username = 'postgres';
url.password = password;
url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const backendRoot = new URL('..', import.meta.url);
const backendPath = fileURLToPath(backendRoot);
const qaTempParent = path.resolve(process.env.PDV_QA_TEMP_PARENT ?? os.tmpdir());
const tempRoot = await mkdtemp(path.join(qaTempParent, `permissions-db-${runId}-`));
const qaSchemaPath = path.join(tempRoot, 'prisma', 'schema.prisma');
const migrationRoot = path.join(backendPath, 'prisma', 'migrations');
const selectedCommit = process.env.PDV_GIT_QA_COMMIT ?? String(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backendRoot, encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
if (!selectedCommit) throw new Error('Permission QA requires a selected committed revision.');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: backendRoot, encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  return (result.stdout ?? '').trim();
}
async function selectPort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const free = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error('No free disposable QA port in 55439-55449.');
}

let created = false;
try {
  run('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=pdv-individual-permissions-qa', '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable individual-permissions PostgreSQL did not become ready within 60 seconds.');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || key === 'PDV_INDIVIDUAL_PERMISSIONS_ENABLED' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: container, QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl, PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '0' });
  const manifest = await createPinnedManifest(selectedCommit);
  const trackedMigrations = new Set(manifest.migrations.map((migration) => migration.name));
  for (const entry of await readdir(migrationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const migrationFile = path.join(migrationRoot, entry.name, 'migration.sql');
    try { await access(migrationFile); }
    catch (error) {
      if (error.code === 'ENOENT') {
        const contents = await readdir(path.join(migrationRoot, entry.name));
        if (contents.length === 0) {
          console.log(`QA_IGNORED_EMPTY_MIGRATION_DIRECTORY=${entry.name}; source=selected-Git-revision-only`);
          continue;
        }
        throw new Error(`Incomplete migration directory found; refusing to ignore it: ${entry.name}`);
      }
      throw error;
    }
    if (!trackedMigrations.has(entry.name)) console.log(`QA_IGNORED_UNTRACKED_MIGRATION=${entry.name}; source=selected-Git-revision-only`);
  }
  const bundle = await materializePinnedMigrationBundle(manifest, tempRoot);
  if (bundle.schemaPath !== qaSchemaPath) throw new Error('Pinned schema materialization path mismatch.');
  Object.assign(env, { PDV_QA_SCHEMA_PATH: qaSchemaPath });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', `--schema=${qaSchemaPath}`], { env, stdio: 'inherit' });
  run(process.execPath, ['--import', 'tsx', 'scripts/pdv-individual-permissions.isolated.test.mjs'], { env, stdio: 'inherit' });
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `pdv-individual-permissions-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels.');
    run('docker', ['stop', '--timeout', '5', container]);
    console.log(`QA_PERMISSIONS_CONTAINER_REMOVED=${container}; storage=tmpfs; published=127.0.0.1:${port} only`);
  }
  if (!path.resolve(tempRoot).startsWith(`${qaTempParent}${path.sep}`) || !path.basename(tempRoot).startsWith(`permissions-db-${runId}-`)) throw new Error('Unsafe individual-permissions QA cleanup path.');
  await rm(tempRoot, { recursive: true, force: true });
}
