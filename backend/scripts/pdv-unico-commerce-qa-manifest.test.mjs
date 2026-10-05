import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPdvCommerceQaManifest, resolvePdvCommerceQaBaseline } from './pdv-unico-commerce-qa-manifest.mjs';

const repoRoot = new URL('../../', import.meta.url);
const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const gitSha256 = (args) => createHash('sha256')
  .update(execFileSync('git', args, { cwd: repoRoot }).toString('utf8').replaceAll('\r\n', '\n'))
  .digest('hex');

test('manifest baseline follows the selected valid Git commit without writing files', async () => {
  const selected = git(['rev-parse', '04d5e669c68e23a03d2a01fe728d448e85077431^{commit}']);
  const head = git(['rev-parse', 'HEAD']);
  const evidencePath = fileURLToPath(new URL('../../docs/testing/pdv-unico-integrated-qa-manifest.json', import.meta.url));
  const evidenceBefore = await readFile(evidencePath);
  assert.notEqual(selected, head, 'fixture commit differs from current HEAD');
  const previous = process.env.PDV_GIT_QA_COMMIT;
  process.env.PDV_GIT_QA_COMMIT = selected;
  try {
    const manifest = await buildPdvCommerceQaManifest();
    assert.equal(manifest.baseline.commit, selected);
    assert.equal(manifest.delivery.schemaCommit, selected);
    const candidate = manifest.codeCandidates.find((item) => item.path === 'backend/src/lib/comanda-service.ts');
    assert.equal(candidate.sha256, gitSha256(['show', `${selected}:backend/src/lib/comanda-service.ts`]));
    assert.equal(manifest.manifestSha256.length, 64);
    assert.deepEqual(await readFile(evidencePath), evidenceBefore, 'building the selected manifest does not modify the project');
  } finally {
    if (previous === undefined) delete process.env.PDV_GIT_QA_COMMIT;
    else process.env.PDV_GIT_QA_COMMIT = previous;
  }
});

test('manifest baseline defaults to HEAD when no revision is selected', async () => {
  const previous = process.env.PDV_GIT_QA_COMMIT;
  delete process.env.PDV_GIT_QA_COMMIT;
  try {
    const manifest = await buildPdvCommerceQaManifest();
    assert.equal(manifest.baseline.commit, git(['rev-parse', 'HEAD']));
  } finally {
    if (previous !== undefined) process.env.PDV_GIT_QA_COMMIT = previous;
  }
});

test('manifest rejects a non-commit revision instead of silently using HEAD', () => {
  assert.throws(() => resolvePdvCommerceQaBaseline('not-a-commit'), /not a valid Git commit/);
  assert.throws(() => resolvePdvCommerceQaBaseline('--upload-pack=unexpected'), /must be a Git commit revision/);
});
