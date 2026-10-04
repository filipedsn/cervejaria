import { spawnSync } from 'node:child_process';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.argv[2] !== 'test') throw new Error('Uso: run-isolated-qa-historical.mjs test');
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
const cwd = new URL('..', import.meta.url);
// Each fixture verifies its immutable baseline. The graph test belongs to the
// current catalog-capable chain and runs in qa:pdv-finance-disposable.
for (const args of [
  ['scripts/event-cash-fk.isolated.test.mjs'],
  ['scripts/pdv-unico-core-schema.isolated.test.mjs'],
  ['--import', 'tsx', 'scripts/pdv-unico-business-migrator.isolated.test.mjs'],
  ['--import', 'tsx', '--test', 'scripts/event-deletion.isolated.test.ts'],
]) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
