import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditSnapshotModules } from './pdv-unico-git-snapshot-import-audit.mjs';
import { materializeGitSnapshot } from './pdv-unico-git-snapshot.mjs';

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
const qaTempParent = path.join(repoRoot, 'artifacts', 'rbac-permissions-ui-2026-10-10');
const tempRoot = await mkdtemp(path.join(qaTempParent, `git-snapshot-${runId}-`));
const snapshotRoot = path.join(tempRoot, 'git-source-snapshot');
const backendSnapshot = path.join(snapshotRoot, 'backend');
const auditFile = path.join(tempRoot, 'module-origins.jsonl');
const auditHook = path.join(tempRoot, 'pdv-import-origin-guard.mjs');
const evidencePath = process.argv.find((value) => value.startsWith('--evidence-out='))?.slice('--evidence-out='.length);
const cutover = process.argv.includes('--cutover');
const focus = process.argv.find(value => value.startsWith('--focus='))?.slice(8);
const resumeFile = process.argv.find(value => value.startsWith('--resume-operation='))?.slice(19);
if (focus && !['categories', 'permissions'].includes(focus)) throw new Error('Unknown focused QA gate.');
const normalizedSha256 = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const byteSha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (args, options = {}) => execFileSync('git', args, { cwd: repoRoot, ...options });
const measuredCommands = [];
const run = (command, args, options = {}) => {
  const started = performance.now();
  const result = spawnSync(command, args, { windowsHide: true, ...options });
  measuredCommands.push({ command: args.filter(arg => !arg.includes('node_modules')).join(' '), cwd: path.relative(snapshotRoot, options.cwd ?? snapshotRoot), durationMs: Math.round(performance.now() - started), exitCode: result.status });
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
    if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || key === 'QA_DATABASE_URL' || key === 'PDV_CANONICAL_CONFIG_QA' || key === 'PDV_CANONICAL_TENANTS' || key === 'PDV_ISOLATED_QA' || key === 'PDV_INDIVIDUAL_PERMISSIONS_ENABLED'
      || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key) || key === 'GIT_WORK_TREE') delete env[key];
  }
  env.GIT_DIR = gitDir;
  env.PDV_GIT_QA_COMMIT = selectedCommit;
  env.PDV_GAMIFIED_CATEGORY_CATALOG = '';
  return env;
}

const auditHookSource = `
import { appendFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const snapshot = path.resolve(process.env.PDV_GIT_QA_SNAPSHOT);
const allowed = JSON.parse(process.env.PDV_GIT_QA_ALLOWED_ROOTS ?? '[]').map((item) => path.resolve(item));
const qaPrismaClients = [...JSON.parse(process.env.PDV_QA_GENERATED_CLIENT_ROOTS ?? '[]'), process.env.PDV_QA_PRISMA_CLIENT, process.env.PDV_SOURCE_PRISMA_CLIENT, process.env.PDV_INVENTORY_PRISMA_CLIENT].filter(Boolean).map(item => path.resolve(item));
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
        appendFileSync(auditFile, JSON.stringify({ path: actualPath, snapshotProjectSource: inSnapshot && !inSnapshotDependencies, qaGeneratedPrismaClient: qaPrismaClients.some(root => inside(root, actualPath)) }) + '\\n');
      }
    }
    return result;
  },
});
`;

let succeeded = false;
let syntheticExitCode = null;
let representativeExitCode = null;
let globalDevPreflight = null;
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
  certificationWork: {
  await mkdir(snapshotRoot, { recursive: true });
  const { tree: objectTree, materializedBlobCount } = await materializeGitSnapshot({ repoRoot, commit: selectedCommit, destination: snapshotRoot, gitDir });
  if (objectTree !== selectedTree) throw new Error('Selected Git tree changed during materialization.');
  if (!existsSync(path.join(backendSnapshot, 'package-lock.json'))) throw new Error('Pinned snapshot is missing backend/package-lock.json.');

  const lockHash = byteSha256(await readFile(path.join(backendSnapshot, 'package-lock.json')));
  const npmCli = npmCliPath();
  const env = qaEnvironment();
  console.log(`PDV_GIT_QA_SOURCE commit=${selectedCommit}; tree=${selectedTree}; materialization=git-cat-file; trackedBlobs=${materializedBlobCount}; code=tracked-tree-only`);
  console.log(`PDV_GIT_QA_DEPENDENCIES package-lock.sha256=${lockHash}; install=npm-ci-in-snapshot; node=${process.version}`);
  run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: backendSnapshot, env, stdio: 'inherit' });
  run(process.execPath, [npmCli, 'run', 'build'], { cwd: backendSnapshot, env, stdio: 'inherit' });
  const frontendSnapshot = path.join(snapshotRoot, 'frontend');
  run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: frontendSnapshot, env, stdio: 'inherit' });
  run(process.execPath, [npmCli, 'run', 'build'], { cwd: frontendSnapshot, env, stdio: 'inherit' });
  run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: snapshotRoot, env, stdio: 'inherit' });

  if (focus !== 'permissions' && !resumeFile) {
    const uiPortServer = net.createServer();
    const uiPort = await new Promise((resolve, reject) => {
      uiPortServer.once('error', reject);
      uiPortServer.listen(0, '127.0.0.1', () => {
        const value = uiPortServer.address().port;
        uiPortServer.close((error) => error ? reject(error) : resolve(value));
      });
    });
    const uiUrl = `http://127.0.0.1:${uiPort}`;
    const vite = spawn(process.execPath, [path.join(frontendSnapshot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
      cwd: frontendSnapshot, env, windowsHide: true, stdio: 'ignore',
    });
    try {
      let uiReady = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (vite.exitCode !== null) throw new Error(`Snapshot Vite exited early (${vite.exitCode}).`);
        try { const response = await fetch(uiUrl); if (response.ok) { uiReady = true; break; } } catch {}
        await delay(500);
      }
      if (!uiReady) throw new Error('Snapshot Vite did not become ready for mocked category UI E2E.');
      const uiEnv = { ...env, E2E_SKIP_SERVER: '1', E2E_BASE_URL: uiUrl };
      run(process.execPath, [path.join(snapshotRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.config.ts', 'e2e/pdv-gamified-categories.spec.ts', '--project=chromium', '--no-deps', '--reporter=line', `--output=${path.join(os.tmpdir(), `pdv-category-ui-playwright-${runId}`)}`], { cwd: snapshotRoot, env: uiEnv, stdio: 'inherit' });
      console.log(`PDV_GIT_QA_UI_MOCKED=PASS; commit=${selectedCommit}; baseURL=${uiUrl}`);
    } finally {
      vite.kill();
    }
  }

  await writeFile(auditHook, auditHookSource, 'utf8');
  const nodeGlobalModules = path.join(path.dirname(process.execPath), 'node_modules');
  const userNodeModules = path.join(os.homedir(), 'node_modules');
  env.PDV_GIT_QA_SNAPSHOT = snapshotRoot;
  env.PDV_GIT_QA_ALLOWED_ROOTS = JSON.stringify([snapshotRoot, nodeGlobalModules, userNodeModules]);
  env.PDV_GIT_QA_IMPORT_AUDIT = auditFile;
  env.PDV_GIT_QA_IMPORT_HOOK = auditHook;
  env.NODE_OPTIONS = `--import=${pathToFileURL(auditHook).href}`;

  let generatedManifest = null;
  if (focus !== 'permissions' && !resumeFile) {
    run(process.execPath, ['scripts/pdv-unico-commerce-qa-manifest.mjs', '--write'], { cwd: backendSnapshot, env, stdio: 'inherit' });
    const generatedManifestPath = path.join(snapshotRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
    generatedManifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));
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
  }

  if (focus !== 'permissions' && !resumeFile) {
    run(process.execPath, ['--test', 'scripts/pdv-unico-commerce-qa-manifest.test.mjs'], { cwd: backendSnapshot, env, stdio: 'inherit' });
  }
  run(process.execPath, ['--import', 'tsx', '--test', 'scripts/pdv-unico-dev-cutover-core.test.mjs', 'scripts/pdv-unico-cutover-receipts.test.mjs', 'src/lib/pdv-tenant-activation.test.ts'], { cwd: backendSnapshot, env, stdio: 'inherit' });

  if (focus || resumeFile) {
    let gate = focus ?? 'categories';
    if (resumeFile) {
      gate = 'migrated-authenticated-operation';
      const resolved = path.resolve(resumeFile);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || path.basename(resolved) !== 'qa-operation-resume.json') throw new Error('QA resume must use its private owned temporary file.');
      const saved = JSON.parse(await readFile(resolved, 'utf8'));
      if (!path.resolve(saved.tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(saved.tempRoot).startsWith(`tap76-sequenced-${saved.runId}-`)) throw new Error('Invalid owned QA resume root.');
      const ownership = spawnSync('docker', ['inspect', '-f', '{{.Id}}|{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', saved.containerId], { encoding: 'utf8', windowsHide: true });
      if (ownership.status !== 0 || ownership.stdout.trim() !== `${saved.containerId}|pdv-unico-sequenced-disposable-qa|${saved.runId}`) throw new Error('QA resume ownership mismatch.');
      if (normalizedSha256(await readFile(path.join(saved.tempRoot, 'schema.prisma'))) !== normalizedSha256(await readFile(path.join(backendSnapshot, 'prisma/schema.prisma')))) throw new Error('Retained generated QA client schema differs from the candidate Git schema.');
      for (const key of ['NODE_ENV', 'PDV_ISOLATED_QA', 'PDV_QA_RUN_ID', 'PDV_QA_CONTAINER', 'DATABASE_URL', 'QA_DATABASE_URL', 'PDV_QA_PRISMA_CLIENT', 'PDV_CANONICAL_TENANTS', 'PDV_REPRESENTATIVE_PHOTO_FILE', 'PDV_UNLISTED_QA_TENANT', 'PDV_SENTINEL_BASELINE', 'PDV_SENTINEL_CREDENTIAL_FILE']) if (saved.environment[key] !== undefined) env[key] = saved.environment[key];
      env.PDV_OPERATION_DAY_OFFSET = process.env.PDV_OPERATION_DAY_OFFSET ?? '31';
      env.PDV_QA_GENERATED_CLIENT_ROOTS = JSON.stringify([env.PDV_QA_PRISMA_CLIENT]);
      env.PDV_GIT_QA_ALLOWED_ROOTS = JSON.stringify([snapshotRoot, nodeGlobalModules, userNodeModules, env.PDV_QA_PRISMA_CLIENT]);
      run(process.execPath, ['--import', 'tsx', 'scripts/pdv-unico-migrated-operation.qa.mjs'], { cwd: backendSnapshot, env, stdio: 'inherit' });
    } else if (gate === 'permissions') {
      run(process.execPath, ['scripts/run-pdv-individual-permissions-disposable-qa.mjs'], { cwd: backendSnapshot, env, stdio: 'inherit' });
    } else run(process.execPath, ['scripts/run-pdv-gamified-category-qa.mjs'], { cwd: backendSnapshot, env, stdio: 'inherit' });
    const lines = (await readFile(auditFile, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const unexpected = lines.filter(row => !row.snapshotProjectSource && !row.qaGeneratedPrismaClient && !row.path.toLowerCase().includes(`${path.sep}node_modules${path.sep}`));
    if (unexpected.length) throw new Error('Focused QA imported non-snapshot project code.');
    const localAfter = await localStateFingerprint();
    if (localAfter.sha256 !== localBefore.sha256 || git(['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim() !== startTree) throw new Error('Local state changed during focused certification.');
    const evidence = { result: 'PASS', scope: 'focused-gate-only', gate, selectedCommit, selectedTree, materializedTrackedBlobCount: materializedBlobCount, measuredCommands, importedWorkspaceModules: 0, localStateUnchanged: true, prodAccessUsed: 'NO', devSharedWrites: 'NO' };
    if (evidencePath) await writeFile(path.resolve(evidencePath), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`PDV_GIT_FOCUSED_EVIDENCE=${JSON.stringify(evidence)}`);
    succeeded = true;
    break certificationWork;
  }

  if (cutover) {
    const result = run(process.execPath, ['--import', 'tsx', 'scripts/run-pdv-unico-global-preflight.mjs'], { cwd: backendSnapshot, env: { ...env, PDV_DEV_CONFIG_FILE: path.join(backendRoot, '.env.development') }, encoding: 'utf8', stdio: 'pipe' });
    globalDevPreflight = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    if (!globalDevPreflight.queried || !globalDevPreflight.tenantCount || globalDevPreflight.coveredTenantCount !== globalDevPreflight.tenantCount) throw new Error('Global DEV preflight did not cover all tenants.');
    console.log(`PDV_GIT_GLOBAL_DEV_PREFLIGHT=${globalDevPreflight.status}; tenants=${globalDevPreflight.tenantCount}; transaction=RepeatableRead-READ-ONLY; writes=0`);
  }
  const syntheticStarted = performance.now();
  const synthetic = spawnSync(process.execPath, [npmCli, 'run', 'qa:pdv-current-disposable'], { cwd: backendSnapshot, env, stdio: 'inherit', windowsHide: true });
  measuredCommands.push({ command: 'qa:pdv-current-disposable', durationMs: Math.round(performance.now() - syntheticStarted), exitCode: synthetic.status });
  if (synthetic.error) throw synthetic.error;
  syntheticExitCode = synthetic.status ?? 1;
  console.log(`PDV_GIT_QA_SYNTHETIC=${syntheticExitCode === 0 ? 'PASS' : 'BLOCKED'}; exitCode=${syntheticExitCode}`);
  if (env.PDV_REPRESENTATIVE_PHOTO_FILE) {
    const representativeArgs = cutover
      ? ['scripts/run-pdv-unico-dev-cutover-plan.mjs', '--profile=qa', '--apply', '--tenant=cmr9yis3c0000hvu00q9fe7y1', '--tenant=cmsry9xrn0000hvlgopjxy0oo']
      : [npmCli, 'run', 'qa:pdv-representative'];
    const representativeStarted = performance.now();
    const representative = spawnSync(process.execPath, representativeArgs, { cwd: backendSnapshot, env, stdio: 'inherit', windowsHide: true });
    measuredCommands.push({ command: cutover ? 'guarded-cutover-sequence' : 'representative', durationMs: Math.round(performance.now() - representativeStarted), exitCode: representative.status });
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
  const moduleExpectationAudit = auditSnapshotModules({
    observedModules: sourceModules,
    syntheticResult: syntheticExitCode === 0 ? 'PASS' : 'BLOCKED',
    representativeResult: representativeExitCode === null ? 'NOT_RUN' : representativeExitCode === 0 ? 'PASS' : 'BLOCKED',
    representativeAttempted: representativeExitCode !== null,
  });
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
    measuredCommands,
    globalDevPreflight,
    generatedCandidateManifest: generatedManifest ? {
      baselineCommit: generatedManifest.baseline.commit,
      manifestSha256: generatedManifest.manifestSha256,
      codeCandidateCount: generatedManifest.codeCandidates.length,
    } : { result: 'NOT_RUN', reason: 'Focused RBAC gate does not require the PDV commerce candidate manifest.' },
    moduleOriginAudit: {
      result: syntheticExitCode === 0
        && (!moduleExpectationAudit.representativeModules.expectedCount || moduleExpectationAudit.representativeModules.result === 'ENTRYPOINT_OBSERVED')
        ? 'PASS'
        : 'PARTIAL_BLOCKED_RUN',
      snapshotProjectModuleCount: sourceModules.length,
      snapshotProjectModulePathListSha256: importAuditSha256,
      nonSnapshotWorkspaceModuleCount: 0,
      externalDependencyModuleCount: externalDependencyModules.length,
      externalPrismaRuntimeVersion: prismaClientPackage.version,
      expectations: moduleExpectationAudit,
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
    devSharedAccess: globalDevPreflight ? 'READ_ONLY' : 'NO',
  };
  if (evidencePath) await writeFile(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`PDV_GIT_QA_LOCAL_STATE=UNCHANGED; fingerprint=${localAfter.sha256}; staged=${localAfter.state.stagedDiffSha256}; unstaged=${localAfter.state.unstagedDiffSha256}; untracked=${localAfter.state.untracked.length}`);
  console.log(`PDV_GIT_QA_EVIDENCE=${JSON.stringify(evidence)}`);
  succeeded = syntheticExitCode === 0 && (representativeExitCode === null || representativeExitCode === 0);
  }
} finally {
  if (!path.resolve(tempRoot).startsWith(`${path.resolve(qaTempParent)}${path.sep}`) || !path.basename(tempRoot).startsWith(`git-snapshot-${runId}-`)) throw new Error('Unsafe Git QA temporary cleanup path.');
  await rm(tempRoot, { recursive: true, force: true });
}

if (succeeded) console.log(`PDV_GIT_QA_TEMPORARY_SNAPSHOT_REMOVED=PASS; runId=${runId}`);
else {
  console.log(`PDV_GIT_QA_TEMPORARY_SNAPSHOT_REMOVED=PASS; runId=${runId}`);
  process.exitCode = 1;
}
