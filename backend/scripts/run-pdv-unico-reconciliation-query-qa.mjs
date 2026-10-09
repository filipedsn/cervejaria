import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = randomBytes(8).toString('hex');
const cutoverRunId = 'tap76-pdv-565bc24d1ec64d3e82bb9bef247af972';
const containerName = `codex-pdv-reconciliation-qa-${runId}`;
const purpose = 'pdv-reconciliation-query-disposable-qa';
const port = 55439;
const password = randomBytes(32).toString('base64url');
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/cervejaria_qa_pdv_unico` }).toString();
const tempRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), `pdv-reconciliation-qa-${runId}-`)));
const clientDir = path.join(tempRoot, 'client');
const schemaPath = path.join(tempRoot, 'schema.prisma');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const schema = execFileSync('git', ['show', `${revision}:backend/prisma/schema.prisma`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: backendRoot, encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(-2400)}`);
  return result.stdout ?? '';
}
async function assertPortFree() {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve())); });
}
let created = false;
try {
  await assertPortFree();
  await mkdir(clientDir, { recursive: true });
  await writeFile(schemaPath, schema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${clientDir.replaceAll('\\', '/')}"`));
  run('docker', ['run', '-d', '--rm', '--name', containerName, '--label', `codex.purpose=${purpose}`, '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let n = 0; n < 60; n++) { if (spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { encoding: 'utf8', windowsHide: true }).status === 0) { ready = true; break; } await delay(1000); }
  if (!ready) throw new Error('Disposable QA PostgreSQL was not ready.');
  run(process.execPath, [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--schema', schemaPath, '--skip-generate'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  run(process.execPath, [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'generate', '--schema', schemaPath], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, QA_DATABASE_URL: databaseUrl, PDV_QA_PRISMA_CLIENT: clientDir });
  const output = run(process.execPath, ['--import', 'tsx', 'scripts/pdv-unico-live-reconciliation.query.qa.mjs'], { env });
  const cases = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const evidence = { ...cases, cutoverRunId, schemaRevision: revision, qaRunId: runId, testedAt: new Date().toISOString() };
  const receiptsRoot = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'TAP Quiver', 'pdv-cutover-receipts');
  await mkdir(receiptsRoot, { recursive: true });
  const evidenceFile = path.join(receiptsRoot, `${cutoverRunId}.reconciliation-query-qa-${runId}.json`);
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(evidence)}\nQA_EVIDENCE_FILE=${evidenceFile}\n`);
} finally {
  if (created) {
    const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', containerName]);
    if (labels.trim() !== `${purpose}|${runId}`) throw new Error('Refusing to stop a QA container without matching ownership labels.');
    run('docker', ['stop', containerName]);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
