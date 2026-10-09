import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('real DEV command executes a Git snapshot and emits import-origin proof without connecting', () => {
  const result = spawnSync(process.execPath, ['scripts/run-pdv-unico-dev-cutover.mjs', '--dry-run'], {
    cwd: backendRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PDV_DEV_EXECUTOR_SOURCE revision=[0-9a-f]{40}; tree=[0-9a-f]{40}; blobs=\d+; worker=git-snapshot; imports=guarded/);
  assert.match(result.stdout, /"connectsToDatabase": false/);
  assert.match(result.stdout, /"appliesMigrations": false/);
  assert.match(result.stdout, /PDV_DEV_EXECUTOR_IMPORT_PROOF revision=[0-9a-f]{40}; projectImports=\d+; externalProjectImports=0/);
});

test('real DEV command accepts the reviewed migrations SHA confirmation flag', () => {
  const result = spawnSync(process.execPath, ['scripts/run-pdv-unico-dev-cutover.mjs', '--dry-run', `--confirm-migrations-sha256=${'a'.repeat(64)}`], {
    cwd: backendRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"migrationsSha256": "[0-9a-f]{64}"/);
  assert.doesNotMatch(result.stderr, /Unknown argument/);
});
