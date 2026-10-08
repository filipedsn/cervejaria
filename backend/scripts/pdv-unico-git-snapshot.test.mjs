import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { materializeGitSnapshot, writeSnapshotImportGuard } from './pdv-unico-git-snapshot.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'pdv-git-snapshot-test-'));
after(() => rm(root, { recursive: true, force: true }));

test('snapshot materialization uses immutable Git blobs and rejects workspace source imports', async () => {
  const repo = path.join(root, 'repo');
  const source = path.join(repo, 'backend', 'scripts', 'probe.mjs');
  const snapshot = path.join(root, 'snapshot');
  await mkdir(path.dirname(source), { recursive: true });
  execFileSync('git', ['init', '--quiet', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'snapshot-test@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Snapshot Test']);
  await writeFile(source, "export const origin = 'git-commit';\n");
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '--quiet', '-m', 'snapshot fixture']);
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(source, "export const origin = 'mutable-workspace';\n");

  const materialized = await materializeGitSnapshot({ repoRoot: repo, commit, destination: snapshot });
  assert.equal(materialized.materializedBlobCount, 1);
  assert.match(await readFile(path.join(snapshot, 'backend/scripts/probe.mjs'), 'utf8'), /git-commit/);
  assert.match(await readFile(source, 'utf8'), /mutable-workspace/);

  const guard = path.join(root, 'origin-guard.mjs');
  const audit = path.join(root, 'origin-audit.jsonl');
  await writeSnapshotImportGuard({ filePath: guard, auditPath: audit });
  const env = {
    ...process.env,
    PDV_CUTOVER_SNAPSHOT_ROOT: snapshot,
    PDV_CUTOVER_DEPENDENCY_ROOTS: '[]',
    PDV_CUTOVER_GENERATED_ROOTS: '[]',
    PDV_CUTOVER_IMPORT_AUDIT: audit,
    PDV_CUTOVER_IMPORT_GUARD: guard,
  };
  const accepted = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, '--input-type=module', '-e', `const probe=await import(${JSON.stringify(pathToFileURL(path.join(snapshot, 'backend/scripts/probe.mjs')).href)}); console.log(probe.origin)`], { encoding: 'utf8', env, windowsHide: true });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /git-commit/);
  const rejected = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, '--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(source).href)})`], { encoding: 'utf8', env, windowsHide: true });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PDV_CUTOVER_IMPORT_ORIGIN_REJECTED/);
});
