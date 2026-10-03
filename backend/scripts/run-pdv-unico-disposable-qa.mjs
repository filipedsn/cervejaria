import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex');
const containerName = `codex-pdv-qa-${runId}`;
const containerLabel = 'codex.purpose=pdv-unico-disposable-qa';
const runLabel = `codex.run=${runId}`;
const password = randomBytes(32).toString('base64url');
const url = new URL('postgresql://127.0.0.1:55439/cervejaria_qa_pdv_unico');
url.username = 'postgres';
url.password = password;
url.searchParams.set('connection_limit', '4');
const targetUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(0, 1200)}`);
  return (result.stdout ?? '').trim();
}

async function assertQaPortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(55439, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

let created = false;
try {
  await assertQaPortFree();
  run('docker', ['run', '-d', '--rm', '--name', containerName, '--label', containerLabel, '--label', runLabel,
    '-p', '127.0.0.1:55439:5432', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine'], { windowsHide: true });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable QA PostgreSQL did not become ready within 60 seconds');

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  }
  env.NODE_ENV = 'test';
  env.PDV_ISOLATED_QA = '1';
  env.QA_DATABASE_URL = targetUrl;
  env.DATABASE_URL = targetUrl;
  const result = spawnSync(process.execPath, ['scripts/run-isolated-qa.mjs', 'test'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Isolated QA suite failed with exit code ${result.status ?? 'unknown'}`);
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerName], { windowsHide: true });
    if (labels !== `pdv-unico-disposable-qa|${runId}`) throw new Error('Refusing to remove QA container: ownership labels do not match this run');
    run('docker', ['stop', containerName], { windowsHide: true });
    console.log(`QA_DISPOSABLE_CONTAINER_REMOVED=${containerName}; storage=tmpfs; published=127.0.0.1:55439 only`);
  }
}
