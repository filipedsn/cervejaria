import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const selected = process.argv.find((value) => value.startsWith('--commit='))?.slice('--commit='.length);
if (!selected || !/^[0-9a-f]{40}$/i.test(selected)) throw new Error('Pass --commit=<full 40-character SHA>.');
const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${selected}^{commit}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
if (commit !== selected.toLowerCase()) throw new Error('The selected QA revision must resolve to the exact supplied commit.');
const manifestPath = 'docs/testing/pdv-gamified-categories-qa-manifest.json';
const manifest = JSON.parse(execFileSync('git', ['show', `${commit}:${manifestPath}`], { cwd: repoRoot, encoding: 'utf8' }));
const files = new Set([
  manifestPath,
  'backend/scripts/run-pdv-gamified-category-qa.mjs',
  ...manifest.candidates.map((candidate) => candidate.path),
]);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-gamified-category-${commit.slice(0, 8)}-`));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
try {
  for (const file of files) {
    const blob = execFileSync('git', ['show', `${commit}:${file}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
    const target = path.join(tempRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, blob);
  }
  const { manifestSha256, ...body } = manifest;
  if (sha256(Buffer.from(JSON.stringify(body))) !== manifestSha256) throw new Error('Snapshot QA manifest digest mismatch.');
  for (const candidate of manifest.candidates) {
    const content = await readFile(path.join(tempRoot, candidate.path));
    if (sha256(content) !== candidate.sha256) throw new Error(`Snapshot candidate differs from ${commit}: ${candidate.path}`);
  }
  const env = { ...process.env, NODE_ENV: 'test', PDV_QA_RUN_ID: `snapshot-${commit.slice(0, 12)}` };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'DIRECT_URL' || /_DATABASE_URL$/.test(key) || /^PROD/i.test(key)) delete env[key];
  const result = spawnSync(process.execPath, [path.join(tempRoot, 'backend/scripts/run-pdv-gamified-category-qa.mjs')], { cwd: tempRoot, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Disposable QA failed on ${commit}: ${(result.stderr || result.stdout).slice(0, 1800)}`);
  console.log(`PDV_GAMIFIED_CATEGORY_GIT_SNAPSHOT=${commit}; ${result.stdout.trim()}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
