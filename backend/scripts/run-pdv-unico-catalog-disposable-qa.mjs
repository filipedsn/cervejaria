import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex');
const containerName = `codex-pdv-catalog-qa-${runId}`;
const purposeLabel = 'codex.purpose=pdv-unico-catalog-disposable-qa';
const runLabel = `codex.run=${runId}`;
const password = randomBytes(32).toString('base64url');
const url = new URL('postgresql://127.0.0.1:55439/cervejaria_qa_pdv_unico');
url.username = 'postgres'; url.password = password; url.searchParams.set('connection_limit', '4');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1000)}`);
  return (result.stdout ?? '').trim();
}

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(55439, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

let created = false;
try {
  await assertPortFree();
  run('docker', ['run', '-d', '--rm', '--name', containerName, '--label', purposeLabel, '--label', runLabel,
    '-p', '127.0.0.1:55439:5432', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable QA PostgreSQL did not become ready within 60 seconds');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  const cwd = new URL('..', import.meta.url);
  for (const args of [
    ['scripts/event-cash-fk.isolated.test.mjs'],
    ['scripts/pdv-unico-core-schema.isolated.test.mjs'],
    ['--import', 'tsx', 'scripts/pdv-unico-business-migrator.isolated.test.mjs'],
    ['--import', 'tsx', '--test', 'scripts/event-deletion.isolated.test.ts'],
    ['--import', 'tsx', 'scripts/pdv-unico-catalog-migrator.isolated.test.mjs'],
    ['--import', 'tsx', '--test', 'scripts/pdv-unico-planner.isolated.test.ts'],
  ]) run(process.execPath, args, { cwd, env, stdio: 'inherit' });
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerName]);
    if (labels !== `pdv-unico-catalog-disposable-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels');
    run('docker', ['stop', containerName]);
    console.log(`QA_CATALOG_CONTAINER_REMOVED=${containerName}; storage=tmpfs; published=127.0.0.1:55439 only`);
  }
  for (const prefix of ['pdv-fk-client-', 'pdv-core-client-', 'pdv-migrator-client-', 'pdv-catalog-client-']) await rm(new URL(`../node_modules/.prisma/${prefix}${runId}`, import.meta.url), { recursive: true, force: true });
}
