import { spawnSync } from 'node:child_process';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.argv[2] !== 'test') throw new Error('Uso: run-isolated-qa.mjs test (exige banco QA isolado e vazio)');
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
const cwd = new URL('..', import.meta.url);
for (const args of [
  ['scripts/event-cash-fk.isolated.test.mjs'],
  ['scripts/pdv-unico-core-schema.isolated.test.mjs'],
  ['--import', 'tsx', 'scripts/pdv-unico-business-migrator.isolated.test.mjs'],
  ['--import', 'tsx', '--test', 'scripts/event-deletion.isolated.test.ts'],
  ['--import', 'tsx', '--test', 'scripts/pdv-unico-planner.isolated.test.ts'],
]) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
