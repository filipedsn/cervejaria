import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const runId = randomBytes(8).toString('hex');
const container = `tap96-realtime-${runId}`;
const purpose = 'tap96-realtime-security-disposable';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PROD|^OTEL_|^ELASTIC_OTEL_|DATABASE_URL|^PDV_CANONICAL/.test(k)));
let created = false;
let databaseUrl;
function command(executable, args, options = {}) {
  const r = spawnSync(executable, args, { cwd: new URL('..', import.meta.url), env, encoding: 'utf8', windowsHide: true, timeout: 240_000, ...options });
  if (r.status !== 0) throw new Error(`${executable} ${args[0]} failed: ${String(r.stderr || r.stdout || r.error).replaceAll(databaseUrl ?? '', '[QA URL]').slice(-1800)}`);
  return r.stdout?.trim();
}
try {
  let port;
  for (let p = 55439; p <= 55449; p++) {
    const free = await new Promise(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (free) { port = p; break; }
  }
  if (!port) throw new Error('No private QA database port available');
  const password = randomBytes(32).toString('hex');
  databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/cervejaria_qa_pdv_unico`;
  Object.assign(env, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', PDV_QA_RUN_ID: runId, DATABASE_URL: databaseUrl, QA_DATABASE_URL: databaseUrl,
    JWT_SECRET: randomBytes(48).toString('hex'), LOG_LEVEL: 'silent', QA_MODE: '1', QA_PUBLIC_RATE_LIMIT_MAX: '500', PDV_INDIVIDUAL_PERMISSIONS_ENABLED: '0' });
  validateIsolatedQaEnvironment(env);
  command('docker', ['run', '-d', '--rm', '--name', container, '--label', `codex.purpose=${purpose}`, '--label', `codex.run=${runId}`,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
    '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=cervejaria_qa_pdv_unico', 'postgres:16-alpine']);
  created = true;
  for (let i = 0; ; i++) {
    const r = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { windowsHide: true });
    if (r.status === 0) break;
    if (i >= 30) throw new Error('Private QA database did not become ready');
    await new Promise(r => setTimeout(r, 1000));
  }
  command(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate']);
  const output = command(process.execPath, ['--import', '../scripts/node24-tsx-host.mjs', '--import', 'tsx', 'scripts/tap96-realtime-security.isolated.mjs']);
  console.log(output);
} finally {
  if (created) {
    const label = command('docker', ['inspect', '--format', '{{ index .Config.Labels "codex.purpose" }}', container]);
    if (label !== purpose) throw new Error('Refusing cleanup without matching disposable ownership');
    command('docker', ['stop', container]);
  }
}
