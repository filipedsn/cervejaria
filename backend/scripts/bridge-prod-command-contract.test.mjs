import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));
const runner = path.join(backendRoot, 'scripts', 'run-with-env.mjs');
const prodReadOnlyCommands = {
  'db:backfill-operational-enablement:dry-run:prod': 'scripts/backfill-operational-enablement.ts --dry-run',
  'db:backfill-cash-register:dry-run:prod': 'scripts/backfill-cash-register-capability.ts --dry-run',
  'db:reconcile-operational-materialization:prod': 'scripts/reconcile-operational-materialization.ts',
};
const prodWriteCommands = {
  'db:backfill-operational-enablement:prod': 'scripts/backfill-operational-enablement.ts',
  'db:backfill-cash-register:prod': 'scripts/backfill-cash-register-capability.ts',
};
function runRunner(...args) {
  return spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' });
}

test('bridge PROD commands explicitly select production without changing DEV commands', () => {
  for (const [name, target] of Object.entries(prodReadOnlyCommands)) {
    const command = packageJson.scripts[name];
    assert.match(command, /^node scripts\/run-with-env\.mjs production /);
    assert.ok(command.includes(target));
    assert.doesNotMatch(command, /development/);
  }
  for (const [name, target] of Object.entries(prodWriteCommands)) {
    const command = packageJson.scripts[name];
    assert.match(command, /^node scripts\/run-with-env\.mjs production /);
    assert.ok(command.includes(target));
    assert.doesNotMatch(command, /--allow-prod-maintenance/);
  }
  assert.match(packageJson.scripts['db:backfill-operational-enablement:dry-run'], /run-with-env\.mjs development/);
  assert.match(packageJson.scripts['db:backfill-cash-register'], /run-with-env\.mjs development/);
});

test('runner fails closed for missing or unknown environments', () => {
  const missing = runRunner();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Uso:/);
  const unknown = runRunner('staging', 'node', '-e', 'process.exit(0)');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Ambiente invalido/);
});

test('PROD bridge writes require explicit maintenance authorization before environment loading', () => {
  const withoutAuthorization = runRunner('production', 'npx', 'tsx', 'scripts/backfill-operational-enablement.ts');
  assert.notEqual(withoutAuthorization.status, 0);
  assert.match(withoutAuthorization.stderr, /--allow-prod-maintenance/);

  // Never invoke an authorized production write from a unit test: a developer
  // may legitimately have .env.production configured locally. Verify the
  // ordering directly instead, so the authorization guard remains fail-closed.
  const runnerSource = fs.readFileSync(runner, 'utf8');
  assert.ok(runnerSource.indexOf('isProdBridgeWrite && !hasMaintenanceAuthorization') < runnerSource.indexOf('const envFile'));

  const devAuthorization = runRunner('development', '--allow-prod-maintenance', 'node', '-e', 'process.exit(0)');
  assert.notEqual(devAuthorization.status, 0);
  assert.match(devAuthorization.stderr, /so pode ser usado com production/);
});

test('dry-runs and reconciliation remain read-only command contracts', () => {
  for (const name of Object.keys(prodReadOnlyCommands)) assert.doesNotMatch(packageJson.scripts[name], /--allow-prod-maintenance/);
  assert.match(packageJson.scripts['db:backfill-operational-enablement:dry-run:prod'], /--dry-run/);
  assert.match(packageJson.scripts['db:backfill-cash-register:dry-run:prod'], /--dry-run/);
  const reconciliation = fs.readFileSync(path.join(backendRoot, 'scripts', 'reconcile-operational-materialization.ts'), 'utf8');
  assert.doesNotMatch(reconciliation, /\.(?:create|update|updateMany|delete|deleteMany|\$executeRaw)\s*\(/);
});

test('bridge backfills query the current Prisma relation for the legacy quiosque table', () => {
  const operationalBackfill = fs.readFileSync(path.join(backendRoot, 'scripts', 'backfill-operational-enablement.ts'), 'utf8');
  const cashRegisterBackfill = fs.readFileSync(path.join(backendRoot, 'scripts', 'backfill-cash-register-capability.ts'), 'utf8');
  const reconciliation = fs.readFileSync(path.join(backendRoot, 'scripts', 'reconcile-operational-materialization.ts'), 'utf8');

  for (const source of [operationalBackfill, cashRegisterBackfill, reconciliation]) {
    assert.match(source, /configuracaoOperacao/);
    assert.doesNotMatch(source, /configuracaoQuiosque/);
  }
});
