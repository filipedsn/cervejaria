import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { materializeGitSnapshot } from '../../backend/scripts/pdv-unico-git-snapshot.mjs';

const [repoRootArg, commit, expectedTree, destinationArg, inventoryPathArg] = process.argv.slice(2);
if (!repoRootArg || !/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[a-f0-9]{40}$/.test(expectedTree ?? '') || !destinationArg || !inventoryPathArg) {
  throw new Error('usage: materialize-release-source-snapshot.mjs <repo> <commit> <tree> <destination> <inventory>');
}
const repoRoot = path.resolve(repoRootArg);
const destination = path.resolve(destinationArg);
const inventoryPath = path.resolve(inventoryPathArg);
const git = (...args) => {
  const result = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return result.trim();
};
if (git('rev-parse', `${commit}^{commit}`).toLowerCase() !== commit) throw new Error('requested commit did not resolve exactly');
const pinnedTree = git('rev-parse', `${commit}^{tree}`).toLowerCase();
if (pinnedTree !== expectedTree) throw new Error(`tree mismatch: expected=${expectedTree} actual=${pinnedTree}`);
await mkdir(destination, { recursive: true });
const snapshot = await materializeGitSnapshot({ repoRoot, commit, destination });
if (snapshot.tree !== expectedTree || snapshot.commit !== commit) throw new Error('materializer identity differs from pinned commit/tree');
try { await access(path.join(destination, '.git')); throw new Error('snapshot unexpectedly contains .git'); } catch (error) { if (error.message.includes('unexpectedly')) throw error; }
const verify = async (root, prefix = '') => {
  const entries = await readdir(root, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...await verify(path.join(root, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
    else throw new Error(`unsupported file type in snapshot: ${rel}`);
  }
  return found;
};
const actualPaths = (await verify(destination)).sort();
const expectedPaths = snapshot.files.map((file) => file.path).sort();
if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error('snapshot has missing or extra files relative to the pinned tree');
for (const file of snapshot.files) {
  const bytes = await readFile(path.join(destination, file.path));
  const { createHash } = await import('node:crypto');
  const gitHash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (gitHash !== file.blob || sha256 !== file.sha256) throw new Error(`snapshot blob verification failed: ${file.path}`);
}
const inventory = { format: 'tap-quiver-git-source-snapshot/v1', commit, tree: expectedTree, materializedBlobCount: snapshot.materializedBlobCount, files: snapshot.files };
await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ commit, tree: expectedTree, materializedBlobCount: snapshot.materializedBlobCount, inventoryPath }));
