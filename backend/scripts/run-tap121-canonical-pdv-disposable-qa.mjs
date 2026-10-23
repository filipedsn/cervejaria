import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex');
const container = `codex-tap121-qa-${runId}`;
const password = randomBytes(32).toString('base64url');
let port;
let created = false;
let databaseUrl;
const temp = await mkdtemp(path.join(os.tmpdir(), `tap121-qa-${runId}-`));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key) || key === 'PDV_CANONICAL_TENANTS') delete env[key];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stdout ?? '')}\n${(result.stderr ?? '')}`.replaceAll(databaseUrl ?? '', '[QA URL REDACTED]').replaceAll(password, '[REDACTED]').slice(-4500));
  return (result.stdout ?? '').trim();
}

try {
  for (let candidate = 55439; candidate <= 55449; candidate++) {
    const available = await new Promise((resolve) => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(candidate, '127.0.0.1', () => server.close((error) => resolve(!error))); });
    if (available) { port = candidate; break; }
  }
  if (!port) throw new Error('No free disposable TAP-121 QA port.');
  const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`); url.username = 'postgres'; url.password = password;
  databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_CANONICAL_CONFIG_QA: '1', PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '1', DATABASE_URL: databaseUrl, QA_DATABASE_URL: databaseUrl, JWT_SECRET: password, UPLOADS_DIR: path.join(temp, 'uploads') });
  run('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=tap121-canonical-pdv-disposable-qa', '--label', `codex.run=${runId}`, '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']); created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) { if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { windowsHide: true }).status === 0) { ready = true; break; } await new Promise((resolve) => setTimeout(resolve, 1000)); }
  if (!ready) throw new Error('Disposable TAP-121 PostgreSQL did not become ready.');
  const schemaPath = path.join(temp, 'schema.prisma');
  await writeFile(schemaPath, await readFile(new URL('../prisma/schema.prisma', import.meta.url)));
  run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schemaPath], { env });
  const apiOutput = run(process.execPath, ['--import', 'tsx', 'scripts/tap121-canonical-pdv.isolated.test.mjs'], { env });
  const browserOutput = run(process.execPath, ['--import', 'tsx', 'scripts/tap121-canonical-pdv.browser.qa.mjs'], { env });
  const categoryOrderResult = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/tap-category-order-canonical.browser.qa.mjs'], {
    cwd: process.cwd(),
    env: { ...env, PDV_GAMIFIED_CATEGORY_CATALOG: '1' },
    encoding: 'utf8', windowsHide: true, timeout: 180000,
  });
  if (categoryOrderResult.error) throw categoryOrderResult.error;
  if (categoryOrderResult.status !== 0) throw new Error(`TAP category order browser QA failed (${categoryOrderResult.status}): ${(categoryOrderResult.stderr || categoryOrderResult.stdout || '').slice(-3200)}`);
  const categoryOrderOutput = categoryOrderResult.stdout ?? '';
  console.log([apiOutput, browserOutput, categoryOrderOutput].join('\n').split(/\r?\n/).filter((line) => /^(RUN |PASS |RECONCILIATION|INVENTORY_DISABLED|QA_TAP121_|QA_CATEGORY_ORDER_)/.test(line)).join('\n'));
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `tap121-canonical-pdv-disposable-qa|${runId}`) throw new Error('Disposable TAP-121 QA container ownership mismatch.');
    run('docker', ['stop', container]);
    console.log('QA_TAP121_DATABASE_REMOVED=tmpfs');
  }
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith(`tap121-qa-${runId}-`)) throw new Error('Unexpected temporary TAP-121 QA path.');
  await rm(resolved, { recursive: true, force: true });
}
