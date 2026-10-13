import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function git(repoRoot, args, gitDir) {
  const env = { ...process.env };
  if (gitDir) {
    env.GIT_DIR = gitDir;
    delete env.GIT_WORK_TREE;
  }
  return execFileSync('git', args, { cwd: repoRoot, env, maxBuffer: 512 * 1024 * 1024 });
}

const gitBlobId = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** Materialize a Git tree from object storage; the mutable worktree is never read as source. */
export async function materializeGitSnapshot({ repoRoot, commit, destination, gitDir, includePaths }) {
  const actualTree = git(repoRoot, ['rev-parse', `${commit}^{tree}`], gitDir).toString('utf8').trim();
  const pathspec = includePaths?.length ? ['--', ...includePaths] : [];
  const trackedEntries = git(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', commit, ...pathspec], gitDir).toString('utf8').split('\0').filter(Boolean);
  const objectIds = trackedEntries.map((entry) => entry.slice(0, entry.indexOf('\t')).split(' ')[2]);
  const byteBatch = objectIds.length ? gitBatchBytes(repoRoot, objectIds, gitDir) : Buffer.alloc(0);
  const blobById = new Map();
  let offset = 0;
  for (const expectedId of objectIds) {
    const headerEnd = byteBatch.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error('git cat-file --batch returned a truncated object header.');
    const [actualId, objectType, sizeText] = byteBatch.subarray(offset, headerEnd).toString('ascii').split(' ');
    const size = Number(sizeText);
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (actualId !== expectedId || objectType !== 'blob' || !Number.isSafeInteger(size) || bodyEnd >= byteBatch.length || byteBatch[bodyEnd] !== 0x0a) throw new Error(`Unexpected Git object body for ${expectedId}.`);
    blobById.set(actualId, byteBatch.subarray(bodyStart, bodyEnd));
    offset = bodyEnd + 1;
  }
  let materializedBlobCount = 0;
  const materializedFiles = [];
  for (const entry of trackedEntries) {
    const tab = entry.indexOf('\t');
    const [mode, objectType, objectId] = entry.slice(0, tab).split(' ');
    const relativePath = entry.slice(tab + 1);
    if (objectType !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`Unsupported tracked Git entry: ${entry.slice(0, tab)} ${relativePath}`);
    const target = path.resolve(destination, relativePath);
    if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error(`Git path escapes snapshot destination: ${relativePath}`);
    const bytes = blobById.get(objectId);
    if (!bytes) throw new Error(`Git blob was not materialized: ${relativePath}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (mode === '100755') await chmod(target, 0o755);
    const materializedBytes = await readFile(target);
    if (gitBlobId(materializedBytes) !== objectId) throw new Error(`Materialized file differs from its Git blob: ${relativePath}`);
    materializedFiles.push({ path: relativePath, mode, blob: objectId, size: materializedBytes.length, sha256: createHash('sha256').update(materializedBytes).digest('hex') });
    materializedBlobCount++;
  }
  return { commit, tree: actualTree, materializedBlobCount, files: materializedFiles };
}

function gitBatchBytes(repoRoot, objectIds, gitDir) {
  const env = { ...process.env };
  if (gitDir) { env.GIT_DIR = gitDir; delete env.GIT_WORK_TREE; }
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot, env, input: Buffer.from(`${objectIds.join('\n')}\n`),
    maxBuffer: 512 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout) throw new Error('git cat-file --batch failed while materializing the selected revision.');
  return result.stdout;
}

/** Write a strict Node module-resolution hook that rejects mutable project imports. */
export async function writeSnapshotImportGuard({ filePath, auditPath }) {
  const source = `
import { appendFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const snapshot = path.resolve(process.env.PDV_CUTOVER_SNAPSHOT_ROOT);
const dependencyRoots = JSON.parse(process.env.PDV_CUTOVER_DEPENDENCY_ROOTS || '[]').map((root) => path.resolve(root));
const generatedRoots = JSON.parse(process.env.PDV_CUTOVER_GENERATED_ROOTS || '[]').map((root) => path.resolve(root));
const audit = process.env.PDV_CUTOVER_IMPORT_AUDIT;
const guard = path.resolve(process.env.PDV_CUTOVER_IMPORT_GUARD);
const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (!resolved.url?.startsWith('file:')) return resolved;
  const candidate = path.resolve(fileURLToPath(resolved.url));
  let actual = candidate;
  try { actual = realpathSync.native(candidate); } catch {}
  const isGuard = actual.toLowerCase() === guard.toLowerCase();
  const isSnapshot = inside(snapshot, actual);
  const isDependency = dependencyRoots.some((root) => inside(root, actual));
  const isGenerated = !isSnapshot && generatedRoots.some((root) => inside(root, actual));
  if (!isGuard && !isSnapshot && !isDependency && !isGenerated) throw new Error('PDV_CUTOVER_IMPORT_ORIGIN_REJECTED: ' + actual);
  if (!isGuard) appendFileSync(audit, JSON.stringify({ path: actual, snapshotProjectSource: isSnapshot && !actual.toLowerCase().includes(path.sep + 'node_modules' + path.sep), dependency: isDependency, generatedClient: isGenerated }) + '\\n');
  return resolved;
} });
`;
  await writeFile(filePath, source, 'utf8');
  await writeFile(auditPath, '', { flag: 'wx' });
  return { filePath, auditPath };
}
