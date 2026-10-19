import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex');
const container = `codex-clientes-search-qa-${runId}`;
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await selectPort();
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
url.username = 'postgres';
url.password = randomBytes(24).toString('base64url');
url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
let created = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: backendRoot, encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stderr ?? ''}${result.stdout ?? ''}`.replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 2500);
    throw new Error(`${command} failed (${result.status}): ${output}`);
  }
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
  throw new Error('No free disposable QA port in 55439-55449.');
}

try {
  run('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=clientes-search-disposable-qa', '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${url.password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable PostgreSQL for client search QA did not become ready.');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: container, QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
    JWT_SECRET: randomBytes(32).toString('hex') });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema=prisma/schema.prisma'], { env });
  run(process.execPath, ['--import', 'tsx', 'scripts/clientes-search.isolated.test.mjs'], { env, stdio: 'inherit' });
  console.log('CLIENTES_SEARCH_DISPOSABLE_QA=PASS; storage=tmpfs; PROD_ACCESS_USED=NO; SHARED_DEV_ACCESSED=NO');
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `clientes-search-disposable-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels.');
    run('docker', ['stop', '--timeout', '5', container]);
  }
}
