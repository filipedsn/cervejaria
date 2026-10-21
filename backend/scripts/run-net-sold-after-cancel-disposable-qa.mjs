import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomBytes(8).toString('hex');
const containerName = `codex-net-sold-cancel-qa-${runId}`;
const containerLabel = 'net-sold-after-cancel-disposable-qa';
const password = randomBytes(32).toString('base64url');
let port;
let created = false;
const schemaDir = await mkdtemp(path.join(os.tmpdir(), `net-sold-cancel-schema-${runId}-`));
const schemaPath = path.join(schemaDir, 'schema.prisma');
let databaseUrl;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${(result.stderr || result.stdout || '')
        .replaceAll(databaseUrl ?? '', '[QA URL REDACTED]')
        .slice(0, 1600)}`,
    );
  }
  return (result.stdout ?? '').trim();
}

async function findFreePort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => resolve(!error)));
    });
    if (free) return candidate;
  }
  throw new Error('No free isolated QA port in 55439-55449.');
}

async function waitForPg() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], {
        encoding: 'utf8',
        windowsHide: true,
      }).status === 0
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Disposable PostgreSQL did not become ready within 60 seconds.');
}

try {
  port = await findFreePort();
  const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
  url.username = 'postgres';
  url.password = password;
  url.searchParams.set('connection_limit', '8');
  databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();

  const schema = run('git', ['show', 'HEAD:backend/prisma/schema.prisma'], { cwd: path.dirname(backendDir) });
  await writeFile(schemaPath, schema, 'utf8');
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    containerName,
    '--label',
    `codex.purpose=${containerLabel}`,
    '--label',
    `codex.run=${runId}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    '--tmpfs',
    '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=cervejaria_qa_pdv_unico',
    'postgres:17-alpine',
  ]);
  created = true;
  await waitForPg();

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'test',
    PDV_ISOLATED_QA: '1',
    PDV_QA_RUN_ID: runId,
    PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '1',
    QA_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
  });

  run('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', schemaPath], {
    cwd: backendDir,
    env,
    shell: true,
  });
  run(
    process.execPath,
    ['--import', 'tsx', '--test', ...process.argv.slice(2), 'scripts/net-sold-after-cancel.isolated.test.mjs'],
    { cwd: backendDir, env, stdio: 'inherit' },
  );
} finally {
  if (created) {
    const labels = run('docker', [
      'inspect',
      '-f',
      '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}',
      containerName,
    ]);
    if (labels !== `${containerLabel}|${runId}`) {
      throw new Error('Refusing to remove a disposable QA container with mismatched ownership labels.');
    }
    run('docker', ['stop', containerName]);
    console.log(`QA_NET_SOLD_CONTAINER_REMOVED=${containerName}; storage=tmpfs; bind=127.0.0.1:${port}`);
  }
  await rm(schemaDir, { recursive: true, force: true });
}
