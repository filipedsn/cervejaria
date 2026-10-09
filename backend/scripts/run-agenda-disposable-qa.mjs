import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex'); const container = `codex-agenda-qa-${runId}`;
const password = randomBytes(32).toString('base64url');
let port;
for (let candidate = 55439; candidate <= 55449; candidate++) {
  const free = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error)); server.listen(candidate, '127.0.0.1', () => server.close(() => resolve(true))); });
  if (free) { port = candidate; break; }
}
if (!port) throw new Error('No free disposable QA port.');
const url = new URL(`postgresql://127.0.0.1:${port}/cervejaria_qa_pdv_unico`); url.username = 'postgres'; url.password = password;
const databaseUrl = validateIsolatedQaEnvironment({ PDV_ISOLATED_QA: '1', QA_DATABASE_URL: url.toString() }).toString();
const temporary = await mkdtemp(path.join(tmpdir(), 'agenda-qa-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key) || key === 'PDV_CANONICAL_TENANTS') delete env[key];
Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: databaseUrl, QA_DATABASE_URL: databaseUrl, PDV_CANONICAL_CONFIG_QA: '1', PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '1' });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${`${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(databaseUrl, '[QA DATABASE]').replaceAll(password, '[REDACTED]').slice(-5000)}`);
  return (result.stdout ?? '').trim();
}
let created = false;
try {
  run('docker', ['run', '-d', '--rm', '--name', container, '--label', 'codex.purpose=agenda-disposable-qa', '--label', `codex.run=${runId}`, '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:17-alpine']); created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) { if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { windowsHide: true }).status === 0) { ready = true; break; } await delay(1000); }
  if (!ready) throw new Error('QA database did not become ready.');
  // Provision the disposable database only. No migration/cutover suite runs.
  const schemaPath = path.join(temporary, 'schema.prisma');
  await writeFile(schemaPath, await readFile(new URL('../prisma/schema.prisma', import.meta.url)));
  run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schemaPath], { env });
  const output = run(process.execPath, ['--import', 'tsx', 'scripts/agenda.isolated.test.ts'], { env });
  console.log(output);
} finally {
  if (created) { const labels = run('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]); if (labels !== `agenda-disposable-qa|${runId}`) throw new Error('QA ownership mismatch.'); run('docker', ['stop', container]); console.log('QA_AGENDA_DATABASE_REMOVED=tmpfs'); }
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('agenda-qa-')) throw new Error('Unexpected QA temporary path.');
  await rm(resolved, { recursive: true, force: true });
}
