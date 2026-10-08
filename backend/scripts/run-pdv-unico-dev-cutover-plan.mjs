import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDevCutoverPlan, resolveAllowedTenant, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--apply')) throw new Error('This entrypoint exposes a guarded plan only. Apply stays disabled until DEV acceptance gates are explicitly closed.');
const tenantIds = args.filter((arg) => arg.startsWith('--tenant=')).map((arg) => arg.slice('--tenant='.length));
for (const arg of args) if (arg !== '--dry-run' && arg !== '--plan' && !arg.startsWith('--tenant=')) throw new Error(`Unknown argument: ${arg}`);
const envContent = await readFile(path.join(backendRoot, '.env.development'), 'utf8');
const line = envContent.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='));
if (!line) throw new Error('DATABASE_URL is missing from backend/.env.development.');
let databaseUrl = line.slice(line.indexOf('=') + 1).trim();
if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) databaseUrl = databaseUrl.slice(1, -1);
const checked = validateDevCutoverEnvironment({ ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl });
const plan = buildDevCutoverPlan({ tenantIds, mode: 'dry-run' });
process.stdout.write(`${JSON.stringify({ ...plan, target: checked, connectsToDatabase: false, appliesMigrations: false, selectedTenantNames: plan.tenants.map(({ id }) => resolveAllowedTenant(id).name) }, null, 2)}\n`);
