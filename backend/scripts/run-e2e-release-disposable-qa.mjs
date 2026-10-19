import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { createPinnedManifest, materializePinnedMigrationBundle } from './pdv-unico-qa-migration-manifest.mjs';

const runId = randomBytes(8).toString('hex');
const container = `codex-release-pdv-qa-${runId}`;
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `release-pdv-qa-${runId}-`));
const port = await selectPort();
const password = randomBytes(32).toString('base64url');
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`);
url.username = 'postgres';
url.password = password;
url.searchParams.set('connection_limit', '12');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const releaseSha = process.env.PDV_GIT_QA_COMMIT ?? command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
const manifest = await createPinnedManifest(releaseSha);
const bundle = await materializePinnedMigrationBundle(manifest, tempRoot);
const frontendDist = path.join(tempRoot, 'frontend-dist');
const contextFile = path.join(tempRoot, 'release-context.json');

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${executable} ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(-2200)}`);
  return (result.stdout ?? '').trim();
}

async function selectPort() {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const free = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => error.code === 'EADDRINUSE' || error.code === 'EACCES' ? resolve(false) : reject(error));
      server.listen(candidate, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error('Não há porta livre no intervalo QA descartável 55439-55449.');
}

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^PROD/i.test(key) || /_DATABASE_URL$/i.test(key) || ['DATABASE_URL', 'DIRECT_URL', 'PDV_CANONICAL_CONFIG_QA', 'PDV_CANONICAL_TENANTS', 'PDV_INDIVIDUAL_PERMISSIONS_ENABLED'].includes(key)) delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, PDV_QA_CONTAINER: container,
    QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
    PDV_CANONICAL_ALL: '1',
    QA_MODE: '1', QA_RATE_LIMIT_LOGIN_MAX: '500', RELEASE_SHA: releaseSha, RELEASE_QA_CONTEXT: contextFile,
    LOG_LEVEL: 'silent',
    FRONTEND_DIST: frontendDist, JWT_SECRET: randomBytes(48).toString('base64url'),
    UPLOADS_DIR: path.join(tempRoot, 'uploads'),
  });
  if (env.PDV_CANONICAL_CONFIG_QA !== undefined || env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED !== undefined || Object.keys(env).some((key) => /^PROD/i.test(key))) throw new Error('QA environment contains a forbidden production/canonical override.');
  return env;
}

let created = false;
let app;
try {
  const env = cleanEnvironment();
  command('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=release-pdv-qa', '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine'], { cwd: repoRoot });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('PostgreSQL descartável não ficou pronto em 60 segundos.');

  command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', `--schema=${bundle.schemaPath}`], { cwd: backendRoot, env, stdio: 'inherit' });
  command(process.execPath, ['--import', '../scripts/node24-tsx-host.mjs', '--import', 'tsx', 'qa/release/seed-release.ts'], { cwd: backendRoot, env, stdio: 'inherit' });
  command(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', frontendDist, '--emptyOutDir'], { cwd: frontendRoot, env, stdio: 'inherit' });

  Object.assign(process.env, env);
  const { buildApp, setupSocketIO } = await import('../src/app.ts');
  app = await buildApp();
  setupSocketIO(app, app.server);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const baseURL = address;
  process.env.RELEASE_QA_BASE_URL = baseURL;
  const context = JSON.parse(await (await import('node:fs/promises')).readFile(contextFile, 'utf8'));
  for (const key of ['owner', 'ownerB']) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: context.users[key].email, senha: context.users[key].password } });
    if (login.statusCode !== 200) throw new Error(`Setup login ${key} failed: HTTP ${login.statusCode}`);
    const cookies = login.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(';', 1)[0];
    const configuration = await app.inject({ method: 'GET', url: '/api/cervejaria/configuracao-operacional', headers: { cookie } });
    const payload = JSON.parse(configuration.body);
    if (configuration.statusCode !== 200 || payload.configurationSource !== 'CANONICAL_PDV') throw new Error(`Setup canonical configuration check failed for ${key}: ${configuration.statusCode} ${configuration.body}`);
    console.log(`RELEASE_QA_CANONICAL_SETUP=${key}:CANONICAL_PDV`);
  }

  const playwrightArgs = ['node_modules/playwright/cli.js', 'test', '--config=playwright.release.config.ts', ...process.argv.slice(2)];
  const testExitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, playwrightArgs, { cwd: repoRoot, env: { ...process.env }, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  if (testExitCode !== 0) throw new Error(`Playwright release QA failed (${testExitCode}).`);
} finally {
  if (app) await app.close().catch(() => undefined);
  if (created) {
    const labels = command('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container], { cwd: repoRoot });
    if (labels !== `release-pdv-qa|${runId}`) throw new Error('Recusando remover container QA com ownership labels divergentes.');
    command('docker', ['stop', '--timeout', '5', container], { cwd: repoRoot });
    console.log(`RELEASE_QA_CONTAINER_REMOVED=${container}; storage=tmpfs; bind=127.0.0.1:${port}`);
  }
  if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(tempRoot).startsWith(`release-pdv-qa-${runId}-`)) throw new Error('Caminho de limpeza temporária inválido.');
  await rm(tempRoot, { recursive: true, force: true });
}
