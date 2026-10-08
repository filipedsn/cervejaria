import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildDevCutoverPlan, resolveAllowedTenant, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tenantIds = args.filter((arg) => arg.startsWith('--tenant=')).map((arg) => arg.slice('--tenant='.length));
const profile = args.find(arg => arg.startsWith('--profile='))?.slice(10) ?? 'dev';
if (!['dev', 'qa'].includes(profile)) throw new Error('Only DEV and owned QA profiles are accepted.');
for (const arg of args) if (!['--dry-run', '--plan', '--apply'].includes(arg) && !arg.startsWith('--tenant=') && !arg.startsWith('--profile=') && !/^--[a-z-]+=/.test(arg)) throw new Error(`Unknown argument: ${arg}`);
tenantIds.forEach(resolveAllowedTenant);
if (profile === 'qa') {
  if (!args.includes('--apply')) console.log(JSON.stringify({ ...buildDevCutoverPlan({ tenantIds }), environment: 'QA', target: 'executor-owned disposable QA', connectsToDatabase: false }));
  else {
    if (!tenantIds.length) throw new Error('Application requires explicit --tenant allowlist.');
    const result = spawnSync(process.execPath, ['scripts/run-pdv-unico-sequenced-qa.mjs'], { cwd: backendRoot, env: { ...process.env, PDV_CUTOVER_TENANTS: tenantIds.join(',') }, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} else {
const envContent = await readFile(path.join(backendRoot, '.env.development'), 'utf8');
const line = envContent.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='));
if (!line) throw new Error('DATABASE_URL is missing from backend/.env.development.');
let databaseUrl = line.slice(line.indexOf('=') + 1).trim();
if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) databaseUrl = databaseUrl.slice(1, -1);
const checked = validateDevCutoverEnvironment({ ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl });
if (args.includes('--apply')) {
  const result = spawnSync(process.execPath, ['scripts/run-pdv-unico-dev-cutover.mjs', ...args], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl }, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const plan = buildDevCutoverPlan({ tenantIds, mode: 'dry-run' });
process.stdout.write(`${JSON.stringify({ ...plan, revision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(backendRoot, '..'), encoding: 'utf8', windowsHide: true }).stdout.trim(), target: checked, connectsToDatabase: false, appliesMigrations: false, selectedTenantNames: plan.tenants.map(({ id }) => resolveAllowedTenant(id).name), applyRequires: ['--confirm-target=cervejaria_dev', '--confirm-revision=<current HEAD>', '--confirm-migrations-sha256=<reviewed Git migration digest>', '--backup-file=<DEV backup>', '--restore-drill=<matching PASS proof>', '--confirm-photo-sha256=<approved SHA-256>', '--run-id=<stable id>'] }, null, 2)}\n`);
}
