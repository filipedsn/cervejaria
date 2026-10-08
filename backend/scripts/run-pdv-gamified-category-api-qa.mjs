import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { createPinnedManifest, materializePinnedMigrationBundle } from './pdv-unico-qa-migration-manifest.mjs';

const runId = randomBytes(8).toString('hex');
const container = `codex-pdv-gamified-api-qa-${runId}`;
const port = await selectPort();
const password = randomBytes(24).toString('base64url');
const url = new URL(`postgresql://127.0.0.1:${port}/pdv_gamified_api_qa`);
url.username = 'postgres';
url.password = password;
url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-gamified-api-${runId}-`));
const commit = process.env.PDV_GIT_QA_COMMIT;
if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) throw new Error('API QA requires the full selected Git commit from the snapshot runner.');
const manifest = createPinnedManifest(commit);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: backendRoot, encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 2200)}`);
  return (result.stdout ?? '').trim();
}
async function selectPort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve(true)));
    });
    if (available) return candidate;
  }
  throw new Error('No free disposable category API QA port in 55439-55449.');
}

let created = false;
try {
  run('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=pdv-gamified-category-api-qa', '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=pdv_gamified_api_qa', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'pdv_gamified_api_qa'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable PostgreSQL for category API QA did not become ready.');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, {
    NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: container,
    QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
  });
  const bundle = await materializePinnedMigrationBundle(manifest, tempRoot);
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', `--schema=${bundle.schemaPath}`], { env, stdio: 'inherit' });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pdv-gamified-category-api.isolated.test.mjs'], {
    cwd: backendRoot,
    env: { ...env, PDV_GAMIFIED_CATEGORY_CATALOG: '1', PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '1', PDV_CANONICAL_CONFIG_QA: '', JWT_SECRET: randomBytes(32).toString('hex') },
    encoding: 'utf8', windowsHide: true, timeout: 180000, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Authenticated category API QA failed (${result.status}).`);
  console.log(`PDV_GAMIFIED_CATEGORY_API_QA=PASS; migrations=${manifest.migrations.length}; commit=${commit}; database=disposable-tmpfs; PROD_ACCESS_USED=NO; SHARED_DEV_ACCESSED=NO`);
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `pdv-gamified-category-api-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels.');
    run('docker', ['stop', '--timeout', '5', container]);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
