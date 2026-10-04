import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest } from './pdv-unico-qa-migration-manifest.mjs';
import { verifyMigratorQaManifest } from './pdv-unico-migrator-qa-manifest.mjs';

// Validate the exact disposable QA target before loading a client or executing SQL.
const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL não coincide com QA_DATABASE_URL validada.');
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = process.env.PDV_QA_RUN_ID ?? `manual-${process.pid}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-catalog-${runId}-`));
const generatedClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-catalog-client-${runId}`);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-catalog-qa-manifest.json'), 'utf8'));
const { manifestSha256, ...manifestBody } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(manifestBody))), manifestSha256, 'candidate manifest digest');
const schemaIndex = spawnSync('git', ['show', ':backend/prisma/schema.prisma'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(schemaIndex.status, 0, schemaIndex.stderr);
assert.equal(sha256(Buffer.from(schemaIndex.stdout)), manifest.delivery.schemaSha256, 'staged schema hash');
const candidateSql = await readFile(path.join(repoRoot, manifest.delivery.migrationPath));
assert.equal(sha256(candidateSql), manifest.delivery.migrationSha256, 'candidate SQL hash');
for (const candidate of manifest.codeCandidates) {
  assert.equal(sha256(await readFile(path.join(repoRoot, candidate.path))), candidate.sha256, `candidate code hash: ${candidate.path}`);
}
const baseSchema = spawnSync('git', ['show', `${manifest.baseline.commit}:${manifest.baseline.schemaPath}`], { cwd: repoRoot, encoding: null });
assert.equal(baseSchema.status, 0, baseSchema.stderr);
assert.equal(sha256(baseSchema.stdout), manifest.baseline.schemaSha256, 'baseline schema blob hash');

function runPrisma(args, env) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1600)}`);
}

const history = JSON.parse(await readFile(path.join(repoRoot, manifest.baseline.historicalManifestPath), 'utf8'));
const coreManifest = JSON.parse(await readFile(path.join(repoRoot, manifest.baseline.coreManifestPath), 'utf8'));
const coreCandidateManifestBytes = await readFile(path.join(repoRoot, manifest.baseline.coreCandidateManifestPath));
assert.equal(sha256(await readFile(path.join(repoRoot, manifest.baseline.historicalManifestPath))), manifest.baseline.historicalManifestSha256);
assert.equal(sha256(await readFile(path.join(repoRoot, manifest.baseline.coreManifestPath))), manifest.baseline.coreManifestSha256);
assert.equal(sha256(coreCandidateManifestBytes), manifest.baseline.coreCandidateManifestSha256);
await verifyPinnedManifest(history);
const { migration: coreSql } = await verifyMigratorQaManifest(coreManifest);
assert.equal(coreManifest.confirmedBaseline.migration.name, manifest.baseline.coreMigrationName);
const bundle = await materializePinnedMigrationBundle(history, tempRoot);
const coreDir = path.join(bundle.migrationsDir, manifest.baseline.coreMigrationName);
await mkdir(coreDir, { recursive: true });
await writeFile(path.join(coreDir, 'migration.sql'), coreSql);
const candidateDir = path.join(bundle.migrationsDir, manifest.delivery.migrationName);
await mkdir(candidateDir, { recursive: true });
await writeFile(path.join(candidateDir, 'migration.sql'), candidateSql);

const { PrismaClient } = await (async () => {
  const schemaPath = path.join(tempRoot, 'candidate-schema.prisma');
  const schema = Buffer.from(schemaIndex.stdout);
  await writeFile(schemaPath, schema);
  const schemaWithOutput = schema.toString('utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`);
  const generateSchemaPath = path.join(tempRoot, 'generate-candidate.prisma');
  await writeFile(generateSchemaPath, schemaWithOutput);
  const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
  runPrisma(['validate', '--schema', schemaPath], env);
  runPrisma(['generate', '--schema', generateSchemaPath], env);
  return import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
})();

let db;
try {
  // Only the schema and migration blobs pinned above are placed in the disposable bundle.
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const before = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(before[0].count, history.migrations.length + 1, 'pinned history plus core migration before catalog candidate');
  const deployEnv = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
  for (const name of Object.keys(deployEnv)) if (/^PROD/i.test(name) || /_DATABASE_URL$/.test(name) && name !== 'DATABASE_URL') delete deployEnv[name];
  runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], deployEnv);
  const after = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(after[0].count, history.migrations.length + 2, 'catalog SQL candidate is recorded as the final applied migration');
  const migrationRow = await db.$queryRaw`SELECT migration_name, checksum FROM "_prisma_migrations" WHERE migration_name = ${manifest.delivery.migrationName} AND finished_at IS NOT NULL`;
  assert.equal(migrationRow.length, 1);
  assert.equal(migrationRow[0].checksum, sha256(candidateSql));

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration } = await import('./pdv-unico-catalog-migrator.ts');
  const { readPdvCatalogSourceSnapshot } = await import('./pdv-unico-catalog-source.ts');
  const suffix = `${process.env.PDV_QA_RUN_ID ?? process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  async function tenant(prefix, plannedOperationsEnabled = false, capabilityOverrides = { tapsEnabled: null, inventoryEnabled: null, kitchenEnabled: null }) {
    const company = await db.cervejaria.create({ data: { nome: `${prefix} ${suffix}`, slug: `${prefix.toLowerCase()}-${suffix}` } });
    const point = await db.pontoVenda.create({ data: { cervejariaId: company.id, nome: `${prefix} canonical`, ativo: true, usaCaixa: true } });
    await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: 17 } });
    await db.configuracaoOperacional.create({ data: { cervejariaId: company.id, directSalesEnabled: true, plannedOperationsEnabled, ...capabilityOverrides, kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true, whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: false } });
    const result = await runPdvBusinessMigration({ db, companyId: company.id, runId: `pdv-base-${prefix}-${suffix}` });
    assert.equal(result.status, 'COMPLETED', 'required canonical PDV prerequisite');
    return { company, point };
  }

  const explicitFalse = { tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false };
  const main = await tenant('catalogqa', true, explicitFalse);
  const secondMode = await tenant('catalogcash', false, explicitFalse);
  const product = await db.produto.create({ data: {
    id: `product-${suffix}`, cervejariaId: main.company.id, nome: 'QA Original', categoria: 'Bebidas', descricao: 'texto completo', cor: 'cobre', estilo: 'ale', tipo: 'BEBIDA', formato: 'CHOPE', controlaEstoque: true, exigePreparo: true, ordem: 13, ativo: true,
    precos: { create: [{ id: `price-unit-${suffix}`, volumeMl: 1, preco: '0.00' }, { id: `price-500-${suffix}`, volumeMl: 500, preco: '6.75' }, { id: `price-1000-${suffix}`, volumeMl: 1000, preco: '12.10' }] },
    gruposOpcionais: { create: [{ id: `group-${suffix}`, nome: 'QA extras', obrigatorio: false, maximo: 2, ordem: 7, ativo: true, opcoes: { create: [{ id: `option-${suffix}`, nome: 'QA limão', precoAdicional: '0.00', ordem: 11, ativo: true }] } }] },
  } });
  const menus = [];
  for (const [name, price, active] of [['QA dia', '8.25', true], ['QA noite', '9.75', false]]) {
    menus.push(await db.cardapio.create({ data: { id: `menu-${menus.length}-${suffix}`, cervejariaId: main.company.id, nome: name, ativo: active, chopeVolumesConfigurados: active, produtos: { create: [{ id: `menu-item-${menus.length}-${suffix}`, produtoId: product.id, volumeMl: 500, precoUnit: price }] } } }));
  }
  const optional = await db.opcional.create({ data: { id: `optional-${suffix}`, cervejariaId: main.company.id, nome: 'QA ginger', preco: '0.40', ativo: true, produtos: { create: [{ id: `optional-link-${suffix}`, produtoId: product.id, ordem: 5 }] } } });
  const command = await db.comanda.create({ data: { id: `historical-command-${suffix}`, origem: 'QUIOSQUE', pontoVendaId: main.point.id } });
  const historicalItem = await db.itemComanda.create({ data: { comandaId: command.id, produtoId: product.id, volumeMl: 500, quantidade: 2, precoUnit: '4.32', nome: 'QA Snapshot Name', observacao: 'historical memo', exigePreparo: true, opcionais: { create: [{ id: `historical-option-${suffix}`, opcionalCatalogoId: optional.id, nome: 'QA Snapshot Extra', precoAdicional: '0.27', quantidade: 1 }] } }, include: { opcionais: true } });

  const sourceSnapshot = await db.$transaction((tx) => readPdvCatalogSourceSnapshot(tx, main.company.id), { isolationLevel: 'RepeatableRead' });
  const sourceProduct = sourceSnapshot.products.find((row) => row.id === product.id);
  assert.equal(sourceProduct.descricao, 'texto completo');
  assert.equal(sourceProduct.precos.length, 3);
  assert.equal(sourceProduct.gruposOpcionais[0].opcoes[0].ordem, 11);
  assert.equal(sourceSnapshot.menus.find((row) => row.id === menus[1].id).produtos[0].precoUnit.toFixed(2), '9.75');
  const catalogRunId = `catalog-main-${suffix}`;
  const migrated = await runPdvCatalogMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: catalogRunId });
  assert.equal(migrated.status, 'COMPLETED', JSON.stringify(migrated));

  async function exactRows(companyId) {
    const [products, prices, menusRows, menuRows, optionsRows, groups, links, optionals, config] = await Promise.all([
      db.produto.count({ where: { cervejariaId: companyId, pontoVendaId: main.point.id } }),
      db.preco.findMany({ where: { produtoId: product.id }, orderBy: { volumeMl: 'asc' } }),
      db.cardapio.count({ where: { cervejariaId: companyId, pontoVendaId: main.point.id } }),
      db.cardapioProduto.findMany({ where: { cardapio: { cervejariaId: companyId } }, orderBy: { cardapioId: 'asc' } }),
      db.produtoOpcional.findMany({ where: { grupo: { produtoId: product.id } } }),
      db.produtoOpcionalGrupo.findMany({ where: { produtoId: product.id } }),
      db.produtoOpcionalVinculo.findMany({ where: { opcionalId: optional.id } }),
      db.opcional.findMany({ where: { cervejariaId: companyId, pontoVendaId: main.point.id } }),
      db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: main.point.id } }),
    ]);
    return { products, prices, menusRows, menuRows, optionsRows, groups, links, optionals, config };
  }
  const afterFirst = await exactRows(main.company.id);
  assert.equal(afterFirst.products, 1);
  assert.equal(afterFirst.menusRows, 2);
  assert.deepEqual(afterFirst.prices.map((row) => [row.id, row.volumeMl, row.preco.toFixed(2)]), [[`price-unit-${suffix}`, 1, '0.00'], [`price-500-${suffix}`, 500, '6.75'], [`price-1000-${suffix}`, 1000, '12.10']]);
  assert.deepEqual(afterFirst.menuRows.map((row) => [row.id, row.precoUnit.toFixed(2), row.cervejariaId, row.pontoVendaId]), [[`menu-item-0-${suffix}`, '8.25', main.company.id, main.point.id], [`menu-item-1-${suffix}`, '9.75', main.company.id, main.point.id]]);
  assert.deepEqual(afterFirst.groups.map((row) => [row.id, row.ordem]), [[`group-${suffix}`, 7]]);
  assert.deepEqual(afterFirst.optionsRows.map((row) => [row.id, row.ordem, row.precoAdicional.toFixed(2)]), [[`option-${suffix}`, 11, '0.00']]);
  assert.deepEqual(afterFirst.links.map((row) => [row.id, row.ordem, row.cervejariaId, row.pontoVendaId]), [[`optional-link-${suffix}`, 5, main.company.id, main.point.id]]);
  assert.deepEqual([afterFirst.config.tapsEnabled, afterFirst.config.inventoryEnabled, afterFirst.config.kitchenEnabled, afterFirst.config.quantidadeMesas], [false, false, false, 17]);

  assert.equal((await runPdvCatalogMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: catalogRunId })).status, 'COMPLETED', 'same completed run revalidation');
  assert.equal((await runPdvCatalogMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: `catalog-newrun-${suffix}` })).status, 'COMPLETED', 'new run reuses stable destinations');
  assert.equal((await runPdvCatalogMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: catalogRunId })).status, 'COMPLETED', 'old completed run revalidates after another run updates stable maps');
  const afterReruns = await exactRows(main.company.id);
  assert.equal(afterReruns.products, afterFirst.products);
  assert.deepEqual(afterReruns.prices.map((row) => row.id), afterFirst.prices.map((row) => row.id));
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: main.company.id, sourceType: { startsWith: 'CATALOGO_' } } }), 1 + afterFirst.prices.length + afterFirst.groups.length + afterFirst.optionsRows.length + afterFirst.menuRows.length + 2 + afterFirst.links.length + afterFirst.optionals.length);
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: main.company.id, sourceType: 'PDV_CONFIGURACAO' } }), 1);

  const second = await runPdvCatalogMigration({ db, companyId: secondMode.company.id, pointId: secondMode.point.id, runId: `catalog-second-${suffix}` });
  assert.equal(second.status, 'COMPLETED');
  const [eventConfig, cashConfig] = await Promise.all([
    db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: main.point.id } }),
    db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondMode.point.id } }),
  ]);
  assert.deepEqual([eventConfig.tapsEnabled, eventConfig.inventoryEnabled, eventConfig.kitchenEnabled], [cashConfig.tapsEnabled, cashConfig.inventoryEnabled, cashConfig.kitchenEnabled]);

  const historicalBefore = await db.itemComanda.findUniqueOrThrow({ where: { id: historicalItem.id }, include: { opcionais: true } });
  await db.produto.update({ where: { id: product.id }, data: { nome: 'QA Edited Catalog' } });
  await db.preco.update({ where: { id: `price-500-${suffix}` }, data: { preco: '15.55' } });
  await db.produtoOpcional.update({ where: { id: `option-${suffix}` }, data: { nome: 'Edited add-on', precoAdicional: '5.00' } });
  const historicalAfter = await db.itemComanda.findUniqueOrThrow({ where: { id: historicalItem.id }, include: { opcionais: true } });
  assert.deepEqual({ id: historicalAfter.id, nome: historicalAfter.nome, preco: historicalAfter.precoUnit.toFixed(2), volume: historicalAfter.volumeMl, option: historicalAfter.opcionais[0].nome, optionPrice: historicalAfter.opcionais[0].precoAdicional.toFixed(2) }, { id: historicalBefore.id, nome: historicalBefore.nome, preco: historicalBefore.precoUnit.toFixed(2), volume: historicalBefore.volumeMl, option: historicalBefore.opcionais[0].nome, optionPrice: historicalBefore.opcionais[0].precoAdicional.toFixed(2) });
  const changedPayload = await runPdvCatalogMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: `catalog-changed-source-${suffix}` });
  assert.equal(changedPayload.status, 'BLOCKED');
  assert.equal(changedPayload.code, 'SOURCE_PAYLOAD_CHANGED');
  assert.equal((await db.produto.findUniqueOrThrow({ where: { id: product.id } })).nome, 'QA Edited Catalog', 'divergent source never overwritten');

  const foreignCompany = await db.cervejaria.create({ data: { nome: `foreign ${suffix}`, slug: `foreign-${suffix}` } });
  const foreignPoint = await db.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'foreign point' } });
  await assert.rejects(db.produto.update({ where: { id: product.id }, data: { pontoVendaId: foreignPoint.id } }), (error) => error.code === 'P2003');

  // Interruption returns the last committed checkpoint; an intrabatch callback failure rolls back destination, map, receipt and checkpoint.
  const rollbackTenant = await tenant('catalogrollback', false);
  const rollbackProduct = await db.produto.create({ data: { id: `rollback-product-${suffix}`, cervejariaId: rollbackTenant.company.id, nome: 'Resume QA', tipo: 'BEBIDA', ativo: true, precos: { create: [{ id: `rollback-price-${suffix}`, volumeMl: 1, preco: '3.00' }] } } });
  let failed = false;
  try { await runPdvCatalogMigration({ db, companyId: rollbackTenant.company.id, pointId: rollbackTenant.point.id, runId: `catalog-rollback-${suffix}`, afterDestinationWrite: () => { throw new Error('synthetic rollback boundary'); } }); }
  catch (error) { failed = error.message === 'synthetic rollback boundary'; }
  assert.equal(failed, true);
  assert.equal(await db.configuracaoPontoVenda.count({ where: { pontoVendaId: rollbackTenant.point.id } }), 0);
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: rollbackTenant.company.id, sourceType: 'PDV_CONFIGURACAO' } }), 0);
  assert.equal(await db.pdvMigrationRun.count({ where: { id: `catalog-rollback-${suffix}` } }), 0);
  const paused = await runPdvCatalogMigration({ db, companyId: rollbackTenant.company.id, pointId: rollbackTenant.point.id, runId: `catalog-resume-${suffix}`, maxBatches: 1 });
  assert.equal(paused.status, 'RUNNING');
  assert.equal((paused.checkpoint).completedSourceKeys.length, 1);
  assert.equal((await runPdvCatalogMigration({ db, companyId: rollbackTenant.company.id, pointId: rollbackTenant.point.id, runId: `catalog-resume-${suffix}` })).status, 'COMPLETED');
  const fallbackConfig = await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: rollbackTenant.point.id } });
  assert.deepEqual([fallbackConfig.inventoryEnabled, fallbackConfig.kitchenEnabled], [true, true]);

  // Barrier proof: first caller holds the advisory transaction lock inside its first destination write; pg_stat_activity proves the second is waiting on that lock.
  const concurrent = await tenant('catalogconcurrent', false);
  let enteredResolve; let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let pausedAtDestination = false;
  const sharedRunId = `catalog-concurrent-${suffix}`;
  const firstCall = runPdvCatalogMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sharedRunId, afterDestinationWrite: async () => {
    if (pausedAtDestination) return;
    pausedAtDestination = true;
    enteredResolve();
    await release;
  } });
  await entered;
  const secondCall = runPdvCatalogMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sharedRunId });
  let waiting = false;
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < 10000) {
    const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND query ILIKE '%pg_advisory_xact_lock%'`;
    if (rows[0].count >= 1) { waiting = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(waiting, true, 'second request observed waiting on the PostgreSQL advisory lock');
  releaseResolve();
  const concurrentResults = await Promise.all([firstCall, secondCall]);
  assert.ok(concurrentResults.every((result) => result.status === 'COMPLETED'));
  assert.equal(await db.configuracaoPontoVenda.count({ where: { pontoVendaId: concurrent.point.id } }), 1);
  const concurrentRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sharedRunId } });
  assert.equal(concurrentRun.status, 'COMPLETED');
  assert.equal((concurrentRun.checkpoint).lastConfirmedBatch, (concurrentRun.checkpoint).completedSourceKeys.length);

  // Altering only the migration-owned target configuration is separate from changing its source payload.
  await db.configuracaoPontoVenda.update({ where: { pontoVendaId: concurrent.point.id }, data: { kitchenEnabled: false } });
  const destinationBlock = await runPdvCatalogMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sharedRunId });
  assert.equal(destinationBlock.status, 'BLOCKED');
  assert.equal(destinationBlock.code, 'MAPPED_DESTINATION_DIVERGED');
  assert.equal((await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: concurrent.point.id } })).kitchenEnabled, false);

  console.log(`PDV_CATALOG_QA=PASS; migration=${manifest.delivery.migrationName}; schema_rows=${after[0].count}; main_product=${product.id}; menus=2; prices=3; price_zero=0.00; reruns=same,new,old-completed; rollback=clean; concurrency=pg_advisory_lock_observed; PROD_ACCESS_USED=NO`);
} finally {
  if (db) await db.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
