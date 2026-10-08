import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const git = (args, encoding = 'utf8') => execFileSync('git', args, {
  cwd: repoRoot, encoding, env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: undefined }, maxBuffer: 512 * 1024 * 1024,
});
const revision = git(['rev-parse', 'HEAD']).trim();
const scriptRelative = 'backend/scripts/run-pdv-unico-dev-cutover.mjs';
const materializerRelative = 'backend/scripts/pdv-unico-git-snapshot.mjs';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const relative of [scriptRelative, materializerRelative]) {
  const working = await readFile(path.join(repoRoot, relative));
  const committed = git(['show', `${revision}:${relative}`], null);
  if (sha256(working) !== sha256(committed)) throw new Error(`Immutable DEV executor requires an unmodified confirmed Git source: ${relative}`);
}

// This import is allowed only after its exact working bytes matched the confirmed Git blob above.
const { materializeGitSnapshot, writeSnapshotImportGuard } = await import('./pdv-unico-git-snapshot.mjs');
const runId = `${process.pid}-${Date.now()}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `tap76-dev-executor-${runId}-`));
const snapshotRoot = path.join(tempRoot, 'git-source-snapshot');
const guardPath = path.join(tempRoot, 'import-origin-guard.mjs');
const auditPath = path.join(tempRoot, 'import-origins.jsonl');
const { tree, materializedBlobCount } = await materializeGitSnapshot({ repoRoot, gitDir, commit: revision, destination: snapshotRoot });
const dependencyRoot = path.join(backendRoot, 'node_modules');
if (!existsSync(dependencyRoot)) throw new Error('Backend dependencies are missing; install from the reviewed lockfile before running the DEV executor.');
await mkdir(path.join(snapshotRoot, 'backend'), { recursive: true });
await symlink(dependencyRoot, path.join(snapshotRoot, 'backend', 'node_modules'), 'junction');
await writeSnapshotImportGuard({ filePath: guardPath, auditPath });

const env = { ...process.env };
for (const name of Object.keys(env)) if (/^PROD(?:_|$)/i.test(name) || name === 'GIT_WORK_TREE') delete env[name];
env.GIT_DIR = gitDir;
env.PDV_CUTOVER_IMMUTABLE_EXECUTION = '1';
env.PDV_CUTOVER_SNAPSHOT_ROOT = snapshotRoot;
env.PDV_CUTOVER_DEPENDENCY_ROOTS = JSON.stringify([dependencyRoot]);
env.PDV_CUTOVER_GENERATED_ROOTS = JSON.stringify([tempRoot]);
env.PDV_CUTOVER_IMPORT_AUDIT = auditPath;
env.PDV_CUTOVER_IMPORT_GUARD = guardPath;
env.PDV_CUTOVER_DEV_CONFIG_FILE = path.join(backendRoot, '.env.development');
env.PDV_CUTOVER_TEMP_ROOT = tempRoot;
env.TEMP = tempRoot;
env.TMP = tempRoot;
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${pathToFileURL(guardPath).href}`].filter(Boolean).join(' ');

process.stdout.write(`PDV_DEV_EXECUTOR_SOURCE revision=${revision}; tree=${tree}; blobs=${materializedBlobCount}; worker=git-snapshot; imports=guarded\n`);
const worker = path.join(snapshotRoot, 'backend', 'scripts', 'run-pdv-unico-dev-cutover-worker.mjs');
const result = spawnSync(process.execPath, [worker, ...process.argv.slice(2)], { cwd: path.join(snapshotRoot, 'backend'), env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
  const origins = (await readFile(auditPath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const externalProjectImports = origins.filter((row) => !row.snapshotProjectSource && !row.dependency && !row.generatedClient);
  if (externalProjectImports.length) throw new Error(`Mutable workspace imports were executed: ${externalProjectImports.map((row) => row.path).join(', ')}`);
  process.stdout.write(`PDV_DEV_EXECUTOR_IMPORT_PROOF revision=${revision}; projectImports=${origins.filter((row) => row.snapshotProjectSource).length}; externalProjectImports=0; audit=${auditPath}\n`);
}
