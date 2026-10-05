import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const photo = process.env.PDV_REPRESENTATIVE_PHOTO_FILE;
if (!photo) throw new Error('PDV_REPRESENTATIVE_PHOTO_FILE must point to the sanitized photo in OS temp.');
const runId = randomBytes(8).toString('hex');
const containerName = `codex-pdv-representative-qa-${runId}`;
const port = await selectFreePort();
const password = randomBytes(32).toString('base64url');
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
url.username = 'postgres'; url.password = password; url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const backendRoot = fileURLToPath(new URL('..', import.meta.url));
const schemaPath = process.env.PDV_QA_SCHEMA_PATH ? path.resolve(process.env.PDV_QA_SCHEMA_PATH) : 'prisma/schema.prisma';
function run(args, options = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DIRECT_URL' || key === 'PDV_CANONICAL_CONFIG_QA' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: containerName, PDV_REPRESENTATIVE_PHOTO_FILE: photo, QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  const result = spawnSync(process.execPath, args, { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`Representative QA child exited ${result.status}: ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(-5000)}`);
  return result.stdout ?? '';
}
async function selectFreePort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve(true)));
    });
    if (available) return candidate;
  }
  throw new Error('No free port in disposable QA range 55439-55449.');
}

const prismaCli = new URL('../node_modules/prisma/build/index.js', import.meta.url);
let created = false;
try {
  const docker = spawnSync('docker', ['run', '-d', '--rm', '--name', containerName, '--label', 'codex.purpose=pdv-representative-disposable-qa', '--label', `codex.run=${runId}`, '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g', '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine'], { encoding: 'utf8', windowsHide: true });
  if (docker.status !== 0) throw new Error(`Could not start disposable PostgreSQL QA: ${(docker.stderr || docker.stdout).slice(0, 1200)}`);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable PostgreSQL QA did not become ready within 60 seconds.');
  const prismaPath = fileURLToPath(prismaCli);
  run([prismaPath, 'generate', '--schema', schemaPath]);
  run([prismaPath, 'migrate', 'deploy', '--schema', schemaPath]);
  run(['--import', 'tsx', 'scripts/pdv-unico-representative-qa.isolated.test.mjs'], { stdio: 'inherit' });
} finally {
  if (created) {
    const inspected = spawnSync('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerName], { encoding: 'utf8', windowsHide: true });
    if (inspected.status !== 0 || inspected.stdout.trim() !== `pdv-representative-disposable-qa|${runId}`) throw new Error('Refusing to stop QA container with mismatched ownership labels.');
    const stopped = spawnSync('docker', ['stop', containerName], { encoding: 'utf8', windowsHide: true });
    if (stopped.status !== 0) throw new Error(`Failed to remove disposable QA container ${containerName}.`);
    console.log(`QA_REPRESENTATIVE_CONTAINER_REMOVED=${containerName}; storage=tmpfs; target=127.0.0.1:${port}`);
  }
}
