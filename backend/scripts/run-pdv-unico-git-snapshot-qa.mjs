import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const backendRoot = path.join(repoRoot, 'backend');
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const selectedArgIndex = process.argv.findIndex((value) => value === '--commit' || value.startsWith('--commit='));
const selectedArg = selectedArgIndex < 0 ? undefined : process.argv[selectedArgIndex];
const selectedInput = selectedArg === undefined
  ? 'HEAD'
  : selectedArg === '--commit'
    ? process.argv[selectedArgIndex + 1] ?? ''
    : selectedArg.slice('--commit='.length);
if (!selectedInput.trim() || selectedInput.startsWith('-')) throw new Error('--commit must identify a Git commit.');
const selectedCommit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${selectedInput}^{commit}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
const selectedTree = execFileSync('git', ['rev-parse', `${selectedCommit}^{tree}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
const runId = randomBytes(8).toString('hex');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-git-qa-${runId}-`));
const snapshotRoot = path.join(tempRoot, 'git-source-snapshot');
const backendSnapshot = path.join(snapshotRoot, 'backend');
const auditFile = path.join(tempRoot, 'module-origins.jsonl');
const auditHook = path.join(tempRoot, 'pdv-import-origin-guard.mjs');
const evidencePath = process.argv.find((value) => value.startsWith('--evidence-out='))?.slice('--evidence-out='.length);
const normalizedSha256 = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const byteSha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (args, options = {}) => execFileSync('git', args, { cwd: repoRoot, ...options });
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? 'unknown'}`);
  return result;
};

async function localStateFingerprint() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const unstaged = git(['diff', '--binary']);
  const staged = git(['diff', '--cached', '--binary']);
  const untrackedPaths = git(['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean).sort();
  const untracked = [];
  for (const relativePath of untrackedPaths) {
    const bytes = await readFile(path.join(repoRoot, relativePath));
    untracked.push({ path: relativePath, sha256: byteSha256(bytes) });
  }
  const state = {
    statusSha256: byteSha256(status),
    unstagedDiffSha256: byteSha256(unstaged),
    stagedDiffSha256: byteSha256(staged),
    untracked,
  };
  return { state, sha256: byteSha256(Buffer.from(JSON.stringify(state))) };
}

function npmCliPath() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const result = candidates.find(existsSync);
  if (!result) throw new Error(`npm CLI not found in expected Node installation locations: ${candidates.join(', ')}`);
  return result;
}

function qaEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || key === 'QA_DATABASE_URL' || key === 'PDV_CANONICAL_CONFIG_QA'
      || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key) || key === 'GIT_WORK_TREE') delete env[key];
  }
  env.GIT_DIR = gitDir;
  env.PDV_GIT_QA_COMMIT = selectedCommit;
  return env;
}

const auditHookSource = `
import { appendFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const snapshot = path.resolve(process.env.PDV_GIT_QA_SNAPSHOT);
const allowed = JSON.parse(process.env.PDV_GIT_QA_ALLOWED_ROOTS ?? '[]').map((item) => path.resolve(item));
const qaPrismaClient = process.env.PDV_QA_PRISMA_CLIENT ? path.resolve(process.env.PDV_QA_PRISMA_CLIENT) : null;
const auditFile = process.env.PDV_GIT_QA_IMPORT_AUDIT;
const hookFile = path.resolve(process.env.PDV_GIT_QA_IMPORT_HOOK);
const inside = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url?.startsWith('file:')) {
      const resolvedPath = path.resolve(fileURLToPath(result.url));
      let actualPath = resolvedPath;
      try { actualPath = realpathSync.native(resolvedPath); } catch {}
      const isHook = actualPath.toLowerCase() === hookFile.toLowerCase();
      const isAllowed = isHook || allowed.some((root) => inside(root, actualPath));
      if (!isAllowed) throw new Error('PDV_GIT_IMPORT_ORIGIN_REJECTED: ' + actualPath);
      if (!isHook) {
        const inSnapshot = inside(snapshot, actualPath);
        const inSnapshotDependencies = inside(path.join(snapshot, 'backend', 'node_modules'), actualPath);
        appendFileSync(auditFile, JSON.stringify({ path: actualPath, snapshotProjectSource: inSnapshot && !inSnapshotDependencies, qaGeneratedPrismaClient: qaPrismaClient ? inside(qaPrismaClient, actualPath) : false }) + '\\n');
      }
    }
    return result;
  },
});
`;

let succeeded = false;
let syntheticExitCode = null;
let representativeExitCode = null;
const runnerPath = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');
const runnerWorkingTreeSha256 = normalizedSha256(await readFile(fileURLToPath(import.meta.url)));
const runnerSelectedCommitSha256 = normalizedSha256(git(['show', `${selectedCommit}:${runnerPath}`]));
if (runnerWorkingTreeSha256 !== runnerSelectedCommitSha256) {
  throw new Error(`Certification runner differs from selected Git revision: ${runnerPath}`);
}
console.log(`PDV_GIT_QA_RUNNER commit=${selectedCommit}:${runnerPath}; sha256=${runnerSelectedCommitSha256}; origin=selected-Git-blob`);
const localBefore = await localStateFingerprint();
const startTree = git(['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
try {
  await mkdir(snapshotRoot, { recursive: true });
  const objectTree = git(['rev-parse', `${selectedCommit}^{tree}`], { encoding: 'utf8' }).trim();
  if (objectTree !== selectedTree) throw new Error('Selected Git tree changed during materialization.');
  const trackedEntries = git(['ls-tree', '-r', '-z', '--full-tree', selectedCommit]).toString('utf8').split('\0').filter(Boolean);
  const objectIds = trackedEntries.map((entry) => entry.slice(0, entry.indexOf('\t')).split(' ')[2]);
  const batchObjects = git(['cat-file', '--batch'], {
    input: Buffer.from(`${objectIds.join('\n')}\n`),
    maxBuffer: 512 * 1024 * 1024,
  });
  const blobById = new Map();
  let batchOffset = 0;
  for (const expectedId of objectIds) {
    const headerEnd = batchObjects.indexOf(0x0a, batchOffset);
    if (headerEnd < 0) throw new Error('git cat-file --batch returned a truncated header.');
    const [actualId, objectType, sizeText] = batchObjects.subarray(batchOffset, headerEnd).toString('ascii').split(' ');
    const size = Number(sizeText);
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (actualId !== expectedId || objectType !== 'blob' || !Number.isSafeInteger(size) || bodyEnd >= batchObjects.length || batchObjects[bodyEnd] !== 0x0a) {
      throw new Error(`Unexpected git cat-file --batch result for ${expectedId}.`);
    }
    blobById.set(actualId, batchObjects.subarray(bodyStart, bodyEnd));
    batchOffset = bodyEnd + 1;
  }
  let materializedBlobCount = 0;
  for (const entry of trackedEntries) {
    const tab = entry.indexOf('\t');
    const [mode, objectType, objectId] = entry.slice(0, tab).split(' ');
    const relativePath = entry.slice(tab + 1);
    if (objectType !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error(`Unsupported tracked entry in certified tree: ${entry.slice(0, tab)} ${relativePath}`);
    }
    const gitBlobBytes = blobById.get(objectId);
    if (!gitBlobBytes) throw new Error(`Git blob was not returned for ${relativePath}`);
    const filePath = path.resolve(snapshotRoot, relativePath);
    if (!filePath.startsWith(`${snapshotRoot}${path.sep}`)) throw new Error(`Tracked path escapes the QA snapshot: ${relativePath}`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, gitBlobBytes);
    if (mode === '100755') await chmod(filePath, 0o755);
    const materializedBytes = await readFile(filePath);
    const materializedBlobId = createHash('sha1').update(`blob ${materializedBytes.length}\0`).update(materializedBytes).digest('hex');
    if (materializedBlobId !== objectId) throw new Error(`Materialized tracked blob differs from Git object: ${relativePath}`);
    materializedBlobCount++;
  }
  if (!existsSync(path.join(backendSnapshot, 'package-lock.json'))) throw new Error('Pinned snapshot is missing backend/package-lock.json.');

  const lockHash = byteSha256(await readFile(path.join(backendSnapshot, 'package-lock.json')));
  const npmCli = npmCliPath();
  const env = qaEnvironment();
  console.log(`PDV_GIT_QA_SOURCE commit=${selectedCommit}; tree=${selectedTree}; materialization=git-cat-file; trackedBlobs=${materializedBlobCount}; code=tracked-tree-only`);
  console.log(`PDV_GIT_QA_DEPENDENCIES package-lock.sha256=${lockHash}; install=npm-ci-in-snapshot; node=${process.version}`);
  run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: backendSnapshot, env, stdio: 'inherit' });

  await writeFile(auditHook, auditHookSource, 'utf8');
  const nodeGlobalModules = path.join(path.dirname(process.execPath), 'node_modules');
  const userNodeModules = path.join(os.homedir(), 'node_modules');
  env.PDV_GIT_QA_SNAPSHOT = snapshotRoot;
  env.PDV_GIT_QA_ALLOWED_ROOTS = JSON.stringify([snapshotRoot, nodeGlobalModules, userNodeModules]);
  env.PDV_GIT_QA_IMPORT_AUDIT = auditFile;
  env.PDV_GIT_QA_IMPORT_HOOK = auditHook;
  env.NODE_OPTIONS = `--import=${pathToFileURL(auditHook).href}`;

  run(process.execPath, ['scripts/pdv-unico-commerce-qa-manifest.mjs', '--write'], { cwd: backendSnapshot, env, stdio: 'inherit' });
  const generatedManifestPath = path.join(snapshotRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
  const generatedManifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));
  if (generatedManifest.baseline.commit !== selectedCommit) throw new Error('Generated candidate manifest is not pinned to the selected code commit.');
  for (const relativePath of [
    'backend/src/lib/comanda-service.ts',
    'backend/src/routes/operacao/comandas.ts',
    'backend/src/routes/public.ts',
  ]) {
    if (!generatedManifest.codeCandidates.some((item) => item.path === relativePath)) {
      generatedManifest.codeCandidates.push({ path: relativePath, sha256: normalizedSha256(git(['show', `${selectedCommit}:${relativePath}`])) });
    }
  }
  generatedManifest.codeCandidates.sort((left, right) => left.path.localeCompare(right.path));
  const { manifestSha256: _oldManifestHash, ...generatedManifestBody } = generatedManifest;
  generatedManifest.manifestSha256 = normalizedSha256(Buffer.from(JSON.stringify(generatedManifestBody)));
  await writeFile(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`, 'utf8');
  for (const candidate of generatedManifest.codeCandidates) {
    const materialized = normalizedSha256(await readFile(path.join(snapshotRoot, candidate.path)));
    const committed = normalizedSha256(git(['show', `${selectedCommit}:${candidate.path}`]));
    if (materialized !== committed || materialized !== candidate.sha256) throw new Error(`Snapshot candidate is not the selected Git blob: ${candidate.path}`);
  }
  console.log(`PDV_GIT_QA_MANIFEST baseline=${generatedManifest.baseline.commit}; candidates=${generatedManifest.codeCandidates.length}; manifest.sha256=${generatedManifest.manifestSha256}; tracked-tree-verification=PASS`);
  for (const relativePath of [
    'backend/src/lib/comanda-service.ts',
    'backend/src/routes/operacao/comandas.ts',
    'backend/src/routes/public.ts',
  ]) {
    const candidate = generatedManifest.codeCandidates.find((item) => item.path === relativePath);
    if (!candidate) throw new Error(`Required operational source is not covered by codeCandidates: ${relativePath}`);
    console.log(`PDV_GIT_QA_CANDIDATE ${relativePath}=${candidate.sha256}; origin=${selectedCommit}:${relativePath}`);
  }

  run(process.execPath, ['--test', 'scripts/pdv-unico-commerce-qa-manifest.test.mjs'], { cwd: backendSnapshot, env, stdio: 'inherit' });

  const synthetic = spawnSync(process.execPath, [npmCli, 'run', 'qa:pdv-current-disposable'], { cwd: backendSnapshot, env, stdio: 'inherit', windowsHide: true });
  if (synthetic.error) throw synthetic.error;
  syntheticExitCode = synthetic.status ?? 1;
  console.log(`PDV_GIT_QA_SYNTHETIC=${syntheticExitCode === 0 ? 'PASS' : 'BLOCKED'}; exitCode=${syntheticExitCode}`);
  if (env.PDV_REPRESENTATIVE_PHOTO_FILE) {
    const representative = spawnSync(process.execPath, [npmCli, 'run', 'qa:pdv-representative'], { cwd: backendSnapshot, env, stdio: 'inherit', windowsHide: true });
    if (representative.error) throw representative.error;
    representativeExitCode = representative.status ?? 1;
    console.log(`PDV_GIT_QA_REPRESENTATIVE=${representativeExitCode === 0 ? 'PASS' : 'BLOCKED'}; exitCode=${representativeExitCode}`);
  }

  const auditLines = (await readFile(auditFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const sourceModules = [...new Set(auditLines.filter((entry) => entry.snapshotProjectSource).map((entry) => entry.path))].sort();
  const externalLocalModules = auditLines.filter((entry) => !entry.snapshotProjectSource && !entry.qaGeneratedPrismaClient
    && !entry.path.toLowerCase().includes(`${path.sep}node_modules${path.sep}`)
    && !entry.path.toLowerCase().includes(`${path.sep}node_modules`));
  if (externalLocalModules.length) throw new Error(`Unexpected non-snapshot, non-dependency modules were loaded: ${JSON.stringify(externalLocalModules.slice(0, 10))}`);
  for (const expected of (syntheticExitCode === 0 && representativeExitCode === 0 ? [
    `${path.sep}backend${path.sep}src${path.sep}app.ts`,
    `${path.sep}backend${path.sep}src${path.sep}lib${path.sep}comanda-service.ts`,
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}operacao${path.sep}comandas.ts`,
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}public.ts`,
    `${path.sep}backend${path.sep}scripts${path.sep}pdv-unico-commerce-migrator.isolated.test.mjs`,
    ...(env.PDV_REPRESENTATIVE_PHOTO_FILE ? [`${path.sep}backend${path.sep}scripts${path.sep}pdv-unico-representative-qa.isolated.test.mjs`] : []),
  ] : [])) {
    if (!sourceModules.some((modulePath) => modulePath.endsWith(expected))) throw new Error(`Import audit did not observe certified snapshot module ${expected}.`);
  }
  const importAuditSha256 = normalizedSha256(Buffer.from(sourceModules.join('\n') + '\n'));
  const externalDependencyModules = [...new Set(auditLines.filter((entry) => !entry.snapshotProjectSource && !entry.qaGeneratedPrismaClient && !entry.path.toLowerCase().startsWith(snapshotRoot.toLowerCase())).map((entry) => entry.path))].sort();
  const prismaClientPackage = JSON.parse(await readFile(path.join(userNodeModules, '@prisma/client/package.json'), 'utf8'));
  const lockedPrismaClient = JSON.parse(await readFile(path.join(backendSnapshot, 'package-lock.json'), 'utf8')).packages['node_modules/@prisma/client'];
  if (!lockedPrismaClient || prismaClientPackage.version !== lockedPrismaClient.version) {
    throw new Error(`External Prisma runtime version differs from snapshot lock: runtime=${prismaClientPackage.version}; lock=${lockedPrismaClient?.version}`);
  }
  console.log(`PDV_GIT_IMPORT_AUDIT=PASS; commit=${selectedCommit}; snapshotProjectModules=${sourceModules.length}; pathList.sha256=${importAuditSha256}; externalWorkspaceModules=0; externalDependencyModules=${externalDependencyModules.length}; prismaRuntime=${prismaClientPackage.version}`);

  const localAfter = await localStateFingerprint();
  const endTree = git(['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  if (localAfter.sha256 !== localBefore.sha256 || endTree !== startTree) {
    throw new Error(`Working tree/index changed during certification. before=${localBefore.sha256}/${startTree}; after=${localAfter.sha256}/${endTree}`);
  }
  const evidence = {
    version: 1,
    certification: (syntheticExitCode === 0 && (representativeExitCode === null || representativeExitCode === 0)) ? (representativeExitCode === null ? 'synthetic-only' : 'pdv-unico-current-disposable') : 'BLOCKED',
    syntheticRegression: { result: syntheticExitCode === 0 ? 'PASS' : 'BLOCKED', suite: 'pdv-unico-current-disposable', exitCode: syntheticExitCode },
    representativeRehearsal: representativeExitCode === null ? { result: 'NOT_RUN', reason: 'No representative photo supplied.' } : { result: representativeExitCode === 0 ? 'PASS' : 'BLOCKED', exitCode: representativeExitCode },
    selectedCommit,
    selectedTree,
    certificationRunnerPath: runnerPath,
    certificationRunnerSha256: runnerSelectedCommitSha256,
    sourceMaterialization: 'git cat-file extraction of selectedCommit; every tracked file verified against exact Git blob SHA-1; no checkout/worktree; npm ci in temporary snapshot',
    materializedTrackedBlobCount: materializedBlobCount,
    packageLockSha256: lockHash,
    nodeVersion: process.version,
    generatedCandidateManifest: {
      baselineCommit: generatedManifest.baseline.commit,
      manifestSha256: generatedManifest.manifestSha256,
      codeCandidateCount: generatedManifest.codeCandidates.length,
    },
    moduleOriginAudit: {
      result: syntheticExitCode === 0 && representativeExitCode === 0 ? 'PASS' : 'PARTIAL_BLOCKED_RUN',
      snapshotProjectModuleCount: sourceModules.length,
      snapshotProjectModulePathListSha256: importAuditSha256,
      nonSnapshotWorkspaceModuleCount: 0,
      externalDependencyModuleCount: externalDependencyModules.length,
      externalPrismaRuntimeVersion: prismaClientPackage.version,
    },
    localState: {
      beforeSha256: localBefore.sha256,
      afterSha256: localAfter.sha256,
      identical: true,
      stagedDiffSha256: localBefore.state.stagedDiffSha256,
      unstagedDiffSha256: localBefore.state.unstagedDiffSha256,
      untrackedFileCount: localBefore.state.untracked.length,
    },
    prodAccessUsed: 'NO',
    devSharedAccess: 'NO',
  };
  if (evidencePath) await writeFile(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`PDV_GIT_QA_LOCAL_STATE=UNCHANGED; fingerprint=${localAfter.sha256}; staged=${localAfter.state.stagedDiffSha256}; unstaged=${localAfter.state.unstagedDiffSha256}; untracked=${localAfter.state.untracked.length}`);
  console.log(`PDV_GIT_QA_EVIDENCE=${JSON.stringify(evidence)}`);
  succeeded = syntheticExitCode === 0 && (representativeExitCode === null || representativeExitCode === 0);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (succeeded) console.log(`PDV_GIT_QA_TEMPORARY_SNAPSHOT_REMOVED=PASS; runId=${runId}`);
else {
  console.log(`PDV_GIT_QA_TEMPORARY_SNAPSHOT_REMOVED=PASS; runId=${runId}`);
  process.exitCode = 1;
}
