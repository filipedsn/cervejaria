import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const digest = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const git = (args, options = {}) => execFileSync('git', args, { cwd: repoRoot, ...options });

export async function buildPdvCommerceQaManifest() {
  const baselineCommit = git(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const schemaPath = 'backend/prisma/schema.prisma';
  const schemaCandidate = git(['show', `${baselineCommit}:${schemaPath}`]);
  const migrationPath = 'backend/prisma/migrations/20261004170000_pdv_commerce_inventory_context/migration.sql';
  const priorFiles = {
    historical: 'docs/testing/pdv-unico-qa-migration-manifest.json',
    core: 'docs/testing/pdv-unico-core-qa-manifest.json',
    catalog: 'docs/testing/pdv-unico-catalog-qa-manifest.json',
    session: 'docs/testing/pdv-unico-session-qa-manifest.json',
    finance: 'docs/testing/pdv-unico-finance-qa-manifest.json',
    commerce: 'docs/testing/pdv-unico-commerce-qa-manifest.json',
  };
  const priorManifests = {};
  const immutableManifests = [];
  for (const [name, file] of Object.entries(priorFiles)) {
    priorManifests[name] = { path: file };
    immutableManifests.push({ path: file, sha256: digest(await readFile(path.join(repoRoot, file))) });
  }
  const finance = JSON.parse(await readFile(path.join(repoRoot, priorFiles.finance), 'utf8'));
  const session = JSON.parse(await readFile(path.join(repoRoot, priorFiles.session), 'utf8'));
  const codePaths = [...new Set([
    'backend/scripts/pdv-unico-catalog-migrator.ts',
    'backend/scripts/pdv-unico-business-migrator.ts',
    'backend/scripts/pdv-unico-catalog-transform.ts',
    'backend/scripts/pdv-unico-catalog-transform.test.ts',
    'backend/scripts/pdv-unico-source-graph.ts',
    'backend/scripts/pdv-unico-commerce-source.ts',
    'backend/scripts/pdv-unico-commerce-transform.ts',
    'backend/scripts/pdv-unico-commerce-migrator.isolated.test.mjs',
    'backend/scripts/pdv-unico-kitchen-order-preparation.ts',
    'backend/scripts/pdv-unico-session-transform.ts',
    'backend/scripts/run-pdv-unico-commerce-disposable-qa.mjs',
    'backend/scripts/pdv-unico-commerce-qa-manifest.mjs',
    'backend/scripts/pdv-unico-finance-migrator.isolated.test.mjs',
    'backend/scripts/pdv-unico-finance-source.ts',
    'backend/scripts/pdv-unico-finance-transform.ts',
    'backend/scripts/pdv-unico-finance-reconcile.ts',
    'backend/scripts/run-pdv-unico-finance-disposable-qa.mjs',
    'backend/scripts/run-pdv-unico-historical-disposable-qa.mjs',
    'backend/scripts/run-isolated-qa-historical.mjs',
    'backend/scripts/pdv-unico-core-schema.isolated.test.mjs',
    'backend/scripts/pdv-unico-migrator-qa-manifest.mjs',
    'backend/scripts/pdv-unico-qa-migration-manifest.mjs',
    'backend/scripts/isolated-qa-env.mjs',
    'backend/scripts/pdv-unico-planner.isolated.test.ts',
    'backend/package.json',
    'backend/scripts/pdv-unico-migrator-qa-manifest.mjs',
    'backend/scripts/pdv-unico-core-schema.isolated.test.mjs',
    'backend/scripts/run-isolated-qa-historical.mjs',
    'backend/scripts/pdv-unico-finance-migrator.isolated.test.mjs',
    'backend/scripts/pdv-unico-planner.isolated.test.ts',
    'backend/package.json',
  ])];
  const data = {
    version: 1,
    baseline: {
      commit: baselineCommit,
      schemaPath,
      schemaSha256: digest(git(['show', `${baselineCommit}:${schemaPath}`])),
    },
    immutableManifests,
    priorManifests: {
      ...priorManifests,
      session: { ...priorManifests.session, path: session.delivery.migrationPath, name: session.delivery.migrationName, commit: baselineCommit, sha256: session.delivery.migrationSha256 },
      finance: { ...priorManifests.finance, migrationName: finance.delivery.migrationName, migrationPath: finance.delivery.migrationPath, migrationSha256: finance.delivery.migrationSha256 },
    },
    delivery: {
      schemaCommit: baselineCommit,
      schemaSha256: digest(schemaCandidate),
      migrationName: path.basename(path.dirname(migrationPath)),
      migrationPath,
      migrationSha256: digest(await readFile(path.join(repoRoot, migrationPath))),
    },
    preCommerceSchema: {
      commit: '128f69fb2fd6904aa823ff17448a6ff13e9d9595',
      path: schemaPath,
      sha256: digest(git(['show', `128f69fb2fd6904aa823ff17448a6ff13e9d9595:${schemaPath}`])),
    },
    codeCandidates: await Promise.all(codePaths.map(async (file) => ({ path: file, sha256: digest(await readFile(path.join(repoRoot, file))) }))),
  };
  return { ...data, manifestSha256: digest(Buffer.from(JSON.stringify(data))) };
}

if (process.argv.includes('--write')) {
  const file = path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
  await writeFile(file, `${JSON.stringify(await buildPdvCommerceQaManifest(), null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, file)} from immutable HEAD schema bytes; Git index is not an input.`);
} else {
  console.log(JSON.stringify(await buildPdvCommerceQaManifest(), null, 2));
}
