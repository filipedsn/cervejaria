import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const digest = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const git = (args, options = {}) => execFileSync('git', args, { cwd: repoRoot, ...options });

export function resolvePdvCommerceQaBaseline(selectedRevision = process.env.PDV_GIT_QA_COMMIT) {
  if (!selectedRevision) return git(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const revision = selectedRevision.trim();
  if (!revision || revision.startsWith('-')) throw new Error('Selected QA baseline must be a Git commit revision.');
  try {
    return git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`Selected QA baseline is not a valid Git commit: ${revision}`);
  }
}

export async function buildPdvCommerceQaManifest(options = {}) {
  const baselineCommit = resolvePdvCommerceQaBaseline(options.baselineCommit ?? process.env.PDV_GIT_QA_COMMIT);
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
    immutableManifests.push({ path: file, sha256: digest(git(['show', `${baselineCommit}:${file}`])) });
  }
  const finance = JSON.parse(git(['show', `${baselineCommit}:${priorFiles.finance}`]).toString('utf8'));
  const session = JSON.parse(git(['show', `${baselineCommit}:${priorFiles.session}`]).toString('utf8'));
  const codePaths = [...new Set([
    'backend/scripts/pdv-unico-catalog-migrator.ts',
    'backend/scripts/pdv-unico-business-migrator.ts',
    'backend/scripts/pdv-unico-catalog-transform.ts',
    'backend/scripts/pdv-unico-catalog-transform.test.ts',
    'backend/scripts/pdv-unico-source-graph.ts',
    'backend/scripts/pdv-unico-commerce-source.ts',
    'backend/scripts/pdv-unico-commerce-transform.ts',
    'backend/scripts/pdv-unico-commerce-migrator.isolated.test.mjs',
    'backend/src/app.ts',
    'backend/src/lib/canonical-pdv-operational-config.ts',
    'backend/src/lib/canonical-pdv-operational-config.test.ts',
    'backend/src/lib/operational-profile.ts',
    'backend/src/lib/operational-profile.test.ts',
    'backend/src/lib/operational-config.ts',
    'backend/src/lib/operational-config.test.ts',
    'backend/src/lib/comanda-service.ts',
    'backend/src/lib/operacao/modulo.ts',
    'backend/src/lib/operacao/capacidades.ts',
    'backend/src/lib/operacao/capacidades.test.ts',
    'backend/src/lib/operacao/comanda-adapter.ts',
    'backend/src/lib/operacao/comanda-itens.ts',
    'backend/src/lib/operacao/contexto-ocorrencia.ts',
    'backend/src/lib/operacao/caixa.ts',
    'backend/src/lib/operacao/venda.ts',
    'backend/src/routes/operacao/index.ts',
    'backend/src/routes/cervejaria.ts',
    'backend/src/routes/admin.ts',
    'backend/src/routes/operacao/comandas.ts',
    'backend/src/routes/operacao/caixa.ts',
    'backend/src/routes/operacao/vendas.ts',
    'backend/src/routes/operacao/cozinha.ts',
    'backend/src/routes/public.ts',
    'backend/scripts/pdv-unico-kitchen-order-preparation.ts',
    'backend/scripts/inventory-pdv-unico-dev.ts',
    'backend/scripts/run-pdv-unico-dev-inventory-readonly.mjs',
    'backend/scripts/pdv-unico-dev-inventory-summary.mjs',
    'backend/scripts/pdv-unico-dev-inventory-summary.test.mjs',
    'backend/scripts/pdv-unico-session-transform.ts',
    'backend/scripts/run-pdv-unico-commerce-disposable-qa.mjs',
    'backend/scripts/run-pdv-unico-git-snapshot-qa.mjs',
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
    'backend/tsconfig.scripts.json',
    'backend/tsconfig.pdv-migration-scripts.json',
    'backend/scripts/pdv-unico-migrator-qa-manifest.mjs',
    'backend/scripts/pdv-unico-core-schema.isolated.test.mjs',
    'backend/scripts/run-isolated-qa-historical.mjs',
    'backend/scripts/pdv-unico-finance-migrator.isolated.test.mjs',
    'backend/scripts/pdv-unico-planner.isolated.test.ts',
    'backend/package.json',
  ])];
  // This self-test was added after the historical revision used by its
  // selection test. Include it whenever the selected commit contains it.
  const manifestTestPath = 'backend/scripts/pdv-unico-commerce-qa-manifest.test.mjs';
  const selectedFiles = git(['ls-tree', '-r', '--name-only', baselineCommit, '--', manifestTestPath], { encoding: 'utf8' }).trim();
  if (selectedFiles === manifestTestPath) codePaths.push(manifestTestPath);
  // A manifest can be regenerated for an older code commit while this
  // generator knows about newer candidates. Only hash candidate paths that
  // actually exist in the selected immutable tree.
  const selectedCandidatePaths = new Set(git(
    ['ls-tree', '-r', '--name-only', baselineCommit],
    { encoding: 'utf8' },
  ).split(/\r?\n/).filter(Boolean));
  const availableCodePaths = [...new Set(codePaths)].filter((file) => selectedCandidatePaths.has(file));
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
      migrationSha256: digest(git(['show', `${baselineCommit}:${migrationPath}`])),
    },
    preCommerceSchema: {
      commit: '128f69fb2fd6904aa823ff17448a6ff13e9d9595',
      path: schemaPath,
      sha256: digest(git(['show', `128f69fb2fd6904aa823ff17448a6ff13e9d9595:${schemaPath}`])),
    },
    devInventorySchema: {
      commit: '66ec00886b65eaea8e437fae4e9a36f7be971b09',
      path: schemaPath,
      sha256: digest(git(['show', `66ec00886b65eaea8e437fae4e9a36f7be971b09:${schemaPath}`])),
      compatibility: 'Matches DEV migration ledger through 20260930150000_company_pix_key; excludes additive PDV migrations not applied in DEV.',
    },
    codeCandidates: availableCodePaths
      .map((file) => ({ path: file, sha256: digest(git(['show', `${baselineCommit}:${file}`])) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  return { ...data, manifestSha256: digest(Buffer.from(JSON.stringify(data))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const file = path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
    await writeFile(file, `${JSON.stringify(await buildPdvCommerceQaManifest(), null, 2)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, file)} from immutable selected Git commit bytes; Git index is not an input.`);
  } else {
    console.log(JSON.stringify(await buildPdvCommerceQaManifest(), null, 2));
  }
}
