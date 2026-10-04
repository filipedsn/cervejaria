import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest } from './pdv-unico-qa-migration-manifest.mjs';
import { readPinnedBlob } from './pdv-unico-migrator-qa-manifest.mjs';

// Reject non-disposable targets before importing/generated Prisma clients or opening a connection.
const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL differs from the validated isolated QA target.');
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = process.env.PDV_QA_RUN_ID ?? `manual-${process.pid}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-commerce-${runId}-`));
const generatedClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-commerce-client-${runId}`);
const sha256 = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const manifestPath = path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const { manifestSha256, ...body } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(body)), manifestSha256), manifestSha256, 'current QA manifest digest');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', manifest.baseline.commit, 'HEAD'], { cwd: repoRoot }).status, 0, 'baseline is immutable ancestor');
assert.equal(sha256(readPinnedBlob(manifest.baseline.commit, manifest.baseline.schemaPath)), manifest.baseline.schemaSha256, 'baseline schema blob hash');
const candidateSchema = readPinnedBlob(manifest.delivery.schemaCommit, manifest.baseline.schemaPath);
assert.equal(sha256(candidateSchema), manifest.delivery.schemaSha256, 'pinned schema candidate hash');
const commerceSql = await readFile(path.join(repoRoot, manifest.delivery.migrationPath));
assert.equal(sha256(commerceSql), manifest.delivery.migrationSha256, 'candidate SQL hash');
for (const item of manifest.immutableManifests) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `immutable prior manifest ${item.path}`);
for (const item of manifest.codeCandidates) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `current code candidate ${item.path}`);

function runPrisma(args, targetUrl = databaseUrl, allowFailure = false) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: targetUrl };
  for (const name of Object.keys(env)) if (/^PROD/i.test(name) || (/_DATABASE_URL$/.test(name) && name !== 'DATABASE_URL')) delete env[name];
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (!allowFailure && result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed: ${(result.stderr || result.stdout).replaceAll(targetUrl, '[QA URL REDACTED]').slice(0, 1600)}`);
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}
const id = (name) => `${name}-qa-${runId}`;
const slug = (name) => `${name}-${runId}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
const plain = (value) => JSON.parse(JSON.stringify(value));
async function proveLegacyOrderContextPreflight(args) {
  const { history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, generatedClientDir, databaseUrl, runId } = args;
  const container = process.env.PDV_QA_CONTAINER;
  assert.match(container ?? '', /^codex-pdv-commerce-qa-[a-f0-9]+$/, 'preflight must run in the owned disposable container');
  const schemaBytes = readPinnedBlob(manifest.preCommerceSchema.commit, manifest.preCommerceSchema.path);
  assert.equal(sha256(schemaBytes), manifest.preCommerceSchema.sha256, 'pinned pre-commerce Prisma schema');
  const clientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-preflight-client-${runId}`);
  const schemaPath = path.join(tempRoot, 'pre-commerce-schema.prisma');
  const generatePath = path.join(tempRoot, 'generate-pre-commerce-schema.prisma');
  const schemaText = schemaBytes.toString('utf8');
  await writeFile(schemaPath, schemaBytes);
  await writeFile(generatePath, schemaText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${clientDir.replaceAll('\\', '/')}"`));
  runPrisma(['validate', '--schema', schemaPath]);
  runPrisma(['generate', '--schema', generatePath]);

  const databaseName = `pdv_preflight_${runId.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`;
  const created = spawnSync('docker', ['exec', container, 'createdb', '-U', 'postgres', databaseName], { encoding: 'utf8', windowsHide: true });
  assert.equal(created.status, 0, 'temporary preflight database created only inside this owned QA container');
  const target = new URL(databaseUrl); target.pathname = `/${databaseName}`;
  const preflightUrl = target.toString();
  const preflightRoot = path.join(tempRoot, 'legacy-preflight');
  const bundle = await materializePinnedMigrationBundle(history, preflightRoot);
  const coreSql = await readFile(path.join(repoRoot, core.migrationPath));
  const catalogSql = await readFile(path.join(repoRoot, catalog.delivery.migrationPath));
  const financeSql = await readFile(path.join(repoRoot, finance.delivery.migrationPath));
  for (const [name, sql] of [
    [core.migrationName, coreSql],
    [catalog.delivery.migrationName, catalogSql],
    [manifest.priorManifests.session.name, sessionSql],
    [finance.delivery.migrationName, financeSql],
  ]) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), sql);
  }
  const beforeCommerce = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl);
  assert.equal(beforeCommerce.status, 0, 'legacy preflight schema chain deploys through finance scope');
  const module = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
  const legacyDb = new module.PrismaClient({ datasources: { db: { url: preflightUrl } }, errorFormat: 'minimal' });
  try {
    const company = await legacyDb.cervejaria.create({ data: { id: `preflight-company-${runId}`, nome: 'Synthetic legacy preflight', slug: `preflight-${runId}` } });
    await legacyDb.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 2, createdAt: new Date('2026-12-01T08:00:00.000Z'), updatedAt: new Date('2026-12-01T09:00:00.000Z') } });
    const point = await legacyDb.pontoVenda.create({ data: { id: `preflight-point-${runId}`, cervejariaId: company.id, nome: 'Synthetic point' } });
    const product = await legacyDb.produto.create({ data: { id: `preflight-product-${runId}`, cervejariaId: company.id, nome: 'Synthetic legacy product' } });
    const operator = await legacyDb.usuario.create({ data: { id: `preflight-user-${runId}`, nome: 'Synthetic operator', email: `preflight-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
    const command = await legacyDb.comanda.create({ data: { id: `preflight-command-${runId}`, origem: 'CAIXA', pontoVendaId: point.id, status: 'ABERTA', total: '1.00' } });
    const order = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-a-${runId}`, cervejariaId: company.id, comandaId: command.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: operator.id } });
    const movementlessOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-b-${runId}`, cervejariaId: company.id, comandaId: command.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: operator.id } });
    const movement = await legacyDb.inventoryMovement.create({ data: { id: `preflight-movement-${runId}`, cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, pedidoId: order.id, tipo: 'SAIDA_VENDA', quantidade: '0.125', registradoPorId: operator.id } });
    const secondCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-second-company-${runId}`, nome: 'Synthetic second tenant', slug: `preflight-second-${runId}` } });
    const secondPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-second-point-${runId}`, cervejariaId: secondCompany.id, nome: 'Synthetic second PDV' } });
    const commerceDir = path.join(bundle.migrationsDir, manifest.delivery.migrationName);
    await mkdir(commerceDir, { recursive: true });
    await writeFile(path.join(commerceDir, 'migration.sql'), commerceSql);
    const failedDeploy = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl, true);
    assert.notEqual(failedDeploy.status, 0, 'legacy order with missing PDV must block the composite-FK migration before backfill');
    assert.match(failedDeploy.output, /PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED/, 'migration reports the explicit preflight blocker');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, null, 'preflight does not invent a link');
    assert.equal((await legacyDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125', 'legacy stock movement survives the blocked migration');
    const ddl = await legacyDb.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_constraint WHERE conname = 'MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey'`;
    assert.equal(ddl[0].count, 0, 'candidate DDL did not partially add the final constraint');
    console.log('QA_STAGE=legacy-preexisting-order-context-preflight-blocked; code=PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED; orderLink=unchanged-null; stockMovement=preserved');

    // The preparation uses the same pre-commercial Prisma Client and the real restartable runner.
    // Confirm the canonical PDV map first, as required by the operational migration chain.
    const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
    const { runPdvCatalogMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');
    const { readPdvKitchenOrderPreparationSnapshot, buildPdvKitchenOrderPreparationItems } = await import('./pdv-unico-kitchen-order-preparation.ts');
    const business = await runPdvBusinessMigration({ db: legacyDb, companyId: company.id, runId: `preflight-business-${runId}` });
    assert.equal(business.status, 'COMPLETED', JSON.stringify(business));
    const catalogRunId = `preflight-catalog-${runId}`;
    const catalogResult = await runPdvCatalogMigration({ db: legacyDb, companyId: company.id, pointId: point.id, runId: catalogRunId });
    assert.equal(catalogResult.status, 'COMPLETED', JSON.stringify(catalogResult));
    const preparationRunId = `preflight-order-preparation-${runId}`;
    const paused = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId, maxBatches: 1 });
    assert.equal(paused.status, 'RUNNING', `one proven order is committed as one checkpointed batch: ${JSON.stringify(paused)}`);
    const failureCheckpoint = plain(paused.checkpoint);
    const orderBeforeFailure = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } });
    await assert.rejects(runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId, afterDestinationWrite: (row) => { if (row.id === movementlessOrder.id) throw new Error('QA_KITCHEN_PREPARATION_ROLLBACK'); } }), /QA_KITCHEN_PREPARATION_ROLLBACK/);
    assert.deepEqual(plain((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: preparationRunId } })).checkpoint), failureCheckpoint, 'intra-batch failure retains the prior confirmed checkpoint');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, orderBeforeFailure.pontoVendaId, 'intra-batch write was rolled back');
    const prepared = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(prepared.status, 'COMPLETED', JSON.stringify(prepared));
    const preparedOrder = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(preparedOrder.pontoVendaId, point.id, 'only context proven by the comanda and canonical map is assigned');
    assert.equal(preparedOrder.id, order.id);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).pontoVendaId, point.id, 'a same-tenant CAIXA comanda is sufficient authority even without stock movement');
    assert.equal((await legacyDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125', 'movement identity and exact quantity are unchanged');
    const preparationReplay = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(preparationReplay.status, 'COMPLETED', 'same-run preparation replay revalidates');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id, 'replay does not alter the assignment');

    // Same-run and new-run corruption checks verify the certificate without repairing its destination.
    const newRunReplay = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: `preflight-order-preparation-replay-${runId}` });
    assert.equal(newRunReplay.status, 'COMPLETED', 'new run reuses stable preparation maps');
    const originalOrderState = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } });
    const originalStatus = originalOrderState.status;
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { status: 'CANCELADO', updatedAt: originalOrderState.updatedAt } });
    const sourceTamper = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(sourceTamper.status, 'BLOCKED');
    assert.equal(sourceTamper.code, 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH', 'the certified source photograph changes and invalidates the run');
    assert.equal((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: preparationRunId } })).status, 'BLOCKED');
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { status: originalStatus, updatedAt: originalOrderState.updatedAt } });
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { pontoVendaId: secondPoint.id, updatedAt: (await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).updatedAt } });
    const destinationTamper = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(destinationTamper.status, 'BLOCKED');
    assert.equal(destinationTamper.code, 'KITCHEN_ORDER_EXISTING_PDV_CONFLICT');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).pontoVendaId, secondPoint.id, 'preparation does not overwrite an adulterated cross-tenant target');
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { pontoVendaId: point.id, updatedAt: (await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).updatedAt } });
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId })).status, 'COMPLETED', 'restoring the certified values permits revalidation without advancing the checkpoint');
    const concurrent = await Promise.all([
      runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: `preflight-order-concurrent-a-${runId}` }),
      runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: `preflight-order-concurrent-b-${runId}` }),
    ]);
    assert(concurrent.every((result) => result.status === 'COMPLETED'), JSON.stringify(concurrent));

    // A second tenant proves a movement-free assignment from its own comanda/PDV authority.
    const secondBusiness = await runPdvBusinessMigration({ db: legacyDb, companyId: secondCompany.id, runId: `preflight-second-business-${runId}` });
    assert.equal(secondBusiness.status, 'COMPLETED', JSON.stringify(secondBusiness));
    const secondOperator = await legacyDb.usuario.create({ data: { id: `preflight-second-user-${runId}`, nome: 'Synthetic second operator', email: `preflight-second-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: secondCompany.id } });
    const secondCommand = await legacyDb.comanda.create({ data: { id: `preflight-second-command-${runId}`, origem: 'CAIXA', pontoVendaId: secondPoint.id, status: 'ABERTA', total: '2.00' } });
    const secondOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-second-order-${runId}`, cervejariaId: secondCompany.id, comandaId: secondCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-02T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: secondOperator.id } });
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: secondCompany.id, pointId: secondPoint.id, runId: `preflight-second-prep-${runId}` })).status, 'COMPLETED');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: secondOrder.id } })).pontoVendaId, secondPoint.id, 'tenant two is independently attributed');

    // Conflicts use real rows from QA and the same transform; no expected blocker is injected.
    const conflictCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-conflict-company-${runId}`, nome: 'Synthetic conflict tenant', slug: `preflight-conflict-${runId}` } });
    const conflictPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-conflict-point-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic conflict canonical PDV' } });
    const conflictBusiness = await runPdvBusinessMigration({ db: legacyDb, companyId: conflictCompany.id, runId: `preflight-conflict-business-${runId}` });
    assert.equal(conflictBusiness.status, 'COMPLETED', JSON.stringify(conflictBusiness));
    const alternatePoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-conflict-alt-point-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic noncanonical PDV' } });
    const conflictOperator = await legacyDb.usuario.create({ data: { id: `preflight-conflict-user-${runId}`, nome: 'Synthetic conflict operator', email: `preflight-conflict-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: conflictCompany.id } });
    const conflictProduct = await legacyDb.produto.create({ data: { id: `preflight-conflict-product-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic conflict product' } });
    const conflictCommand = await legacyDb.comanda.create({ data: { id: `preflight-conflict-command-${runId}`, origem: 'CAIXA', pontoVendaId: conflictPoint.id, status: 'ABERTA', total: '3.00' } });
    const conflictingOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-conflict-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: conflictCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const conflictMovements = await legacyDb.inventoryMovement.createMany({ data: [
      { id: `preflight-conflict-movement-a-${runId}`, cervejariaId: conflictCompany.id, pontoVendaId: conflictPoint.id, produtoId: conflictProduct.id, pedidoId: conflictingOrder.id, tipo: 'SAIDA_VENDA', quantidade: '0.125', registradoPorId: conflictOperator.id },
      { id: `preflight-conflict-movement-b-${runId}`, cervejariaId: conflictCompany.id, pontoVendaId: alternatePoint.id, produtoId: conflictProduct.id, pedidoId: conflictingOrder.id, tipo: 'SAIDA_VENDA', quantidade: '0.250', registradoPorId: conflictOperator.id },
    ] });
    assert.equal(conflictMovements.count, 2);
    const conflictSnapshot = await readPdvKitchenOrderPreparationSnapshot(legacyDb, conflictCompany.id);
    assert.throws(() => buildPdvKitchenOrderPreparationItems({ companyId: conflictCompany.id, pointId: conflictPoint.id, confirmedPdvSourceKey: `PDV:${conflictPoint.id}`, snapshot: { ...conflictSnapshot, orders: conflictSnapshot.orders.filter((row) => row.id === conflictingOrder.id), movements: conflictSnapshot.movements.filter((row) => row.pedidoId === conflictingOrder.id) }, confirmedOccurrences: {} }), (error) => error.code === 'KITCHEN_ORDER_MULTIPLE_MOVEMENT_PDVS');
    const unprovenCommand = await legacyDb.comanda.create({ data: { id: `preflight-unproven-command-${runId}`, origem: 'CAIXA', status: 'ABERTA', total: '0.00' } });
    const unprovenOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-unproven-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: unprovenCommand.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const foreignCommand = await legacyDb.comanda.create({ data: { id: `preflight-foreign-command-${runId}`, origem: 'CAIXA', pontoVendaId: point.id, status: 'ABERTA', total: '0.00' } });
    const foreignOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-foreign-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: foreignCommand.id, pontoVendaId: null, numero: 3, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const withOtherBlocks = await readPdvKitchenOrderPreparationSnapshot(legacyDb, conflictCompany.id);
    const runTransformForOrder = (orderId) => buildPdvKitchenOrderPreparationItems({ companyId: conflictCompany.id, pointId: conflictPoint.id, confirmedPdvSourceKey: `PDV:${conflictPoint.id}`, snapshot: { ...withOtherBlocks, orders: withOtherBlocks.orders.filter((row) => row.id === orderId), movements: withOtherBlocks.movements.filter((row) => row.pedidoId === orderId) }, confirmedOccurrences: {} });
    assert.throws(() => runTransformForOrder(unprovenOrder.id), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_UNPROVEN');
    assert.throws(() => runTransformForOrder(foreignOrder.id), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_UNPROVEN');
    const blockedConflict = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: conflictCompany.id, pointId: conflictPoint.id, runId: `preflight-conflict-prep-${runId}` });
    assert.equal(blockedConflict.status, 'BLOCKED');
    assert.equal(blockedConflict.code, 'KITCHEN_ORDER_MULTIPLE_MOVEMENT_PDVS');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: conflictingOrder.id } })).pontoVendaId, null, 'conflicting links remain untouched');
    await legacyDb.inventoryMovement.deleteMany({ where: { pedidoId: conflictingOrder.id } });
    await legacyDb.pedidoOperacao.delete({ where: { id: conflictingOrder.id } });
    await legacyDb.pedidoOperacao.deleteMany({ where: { id: { in: [unprovenOrder.id, foreignOrder.id] } } });
    await legacyDb.comanda.deleteMany({ where: { id: { in: [unprovenCommand.id, foreignCommand.id] } } });
    console.log('QA_STAGE=order-context-preparation-two-tenants; movementless=assigned; multiple-pdv-movements=blocked; source-target-tamper=blocked; pause-rollback-replay-concurrency=verified');

    const rolledBack = runPrisma(['migrate', 'resolve', '--rolled-back', manifest.delivery.migrationName], preflightUrl);
    assert.equal(rolledBack.status, 0, 'QA Prisma failed migration row is explicitly marked rolled back after verifying transactional preflight made no DDL changes');
    const recovered = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl);
    assert.equal(recovered.status, 0, 'commerce migration deploy succeeds after safe context preparation and QA migration recovery');
    const constraint = await legacyDb.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname = 'MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey'`;
    assert.equal(constraint.length, 1);
    assert.equal(constraint[0].confdeltype, 'r');
    assert.equal(constraint[0].convalidated, true);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id, 'restrictive migration preserves the prepared order context');
    console.log('QA_STAGE=legacy-order-context-prepared-recovered-and-commerce-migration-applied; orderId=preserved; movement=0.125; constraint=validated-restrictive');
    await legacyDb.$disconnect();
    const { PrismaClient: MigratedPrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
    const migratedDb = new MigratedPrismaClient({ datasources: { db: { url: preflightUrl } }, errorFormat: 'minimal' });
    try {
      const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
      const { runPdvCatalogMigration, runPdvCommerceMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');
      for (const [label, result] of [
        ['business', await runPdvBusinessMigration({ db: migratedDb, companyId: company.id, runId: `preflight-business-${runId}` })],
        ['catalog', await runPdvCatalogMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: catalogRunId })],
        ['preparation', await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: company.id, pointId: point.id, runId: preparationRunId })],
      ]) assert.equal(result.status, 'COMPLETED', `post-commercial SQL prior-scope revalidation ${label}: ${JSON.stringify(result)}`);
      const commerceRunId = `preflight-commerce-${runId}`;
      const commerce = await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: commerceRunId });
      assert.equal(commerce.status, 'COMPLETED', `post-preparation commerce mapping: ${JSON.stringify(commerce)}`);
      const postMigrationRows = await migratedDb.pedidoOperacao.findMany({ where: { id: { in: [order.id, movementlessOrder.id] } }, orderBy: { id: 'asc' } });
      assert.deepEqual(postMigrationRows.map((row) => [row.id, row.pontoVendaId]), [[order.id, point.id], [movementlessOrder.id, point.id]]);
      assert.equal((await migratedDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125');
      assert.equal((await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'commerce same-run revalidation');
      assert.equal((await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: `preflight-commerce-replay-${runId}` })).status, 'COMPLETED', 'commerce new-run replay preserves prepared links');
      console.log('QA_STAGE=post-preparation-commercial-scope-completed-and-replayed; scopes=business,catalog,preparation,commerce; orders=2; movements=1');
    } finally { await migratedDb.$disconnect(); }
  } finally {
    await legacyDb.$disconnect();
    const dropped = spawnSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', databaseName], { encoding: 'utf8', windowsHide: true });
    assert.equal(dropped.status, 0, 'only the temporary QA preflight database is removed');
  }
}
let db;
let preflightDb;
let preflightDatabaseName;
try {
  const history = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.historical.path), 'utf8'));
  await verifyPinnedManifest(history);
  const core = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.core.path), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.catalog.path), 'utf8'));
  const finance = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.finance.path), 'utf8'));
  const sessionSql = readPinnedBlob(manifest.priorManifests.session.commit, manifest.priorManifests.session.path);
  const candidates = [
    [core.migrationName, await readFile(path.join(repoRoot, core.migrationPath))],
    [catalog.delivery.migrationName, await readFile(path.join(repoRoot, catalog.delivery.migrationPath))],
    [manifest.priorManifests.session.name, sessionSql],
    [finance.delivery.migrationName, await readFile(path.join(repoRoot, finance.delivery.migrationPath))],
    [manifest.delivery.migrationName, commerceSql],
  ];
  assert.equal(sha256(candidates[0][1]), core.migrationSha256, 'pinned core SQL');
  assert.equal(sha256(candidates[1][1]), catalog.delivery.migrationSha256, 'pinned catalog SQL');
  assert.equal(sha256(candidates[2][1]), manifest.priorManifests.session.sha256, 'pinned session SQL');
  assert.equal(sha256(candidates[3][1]), finance.delivery.migrationSha256, 'pinned finance SQL');
  const bundle = await materializePinnedMigrationBundle(history, tempRoot);
  for (const [name, sql] of candidates) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), sql);
  }
  const candidateText = candidateSchema.toString('utf8');
  await writeFile(bundle.schemaPath, candidateSchema);
  const validatePath = path.join(tempRoot, 'commerce-schema.prisma');
  await writeFile(validatePath, candidateSchema);
  const generatePath = path.join(tempRoot, 'generate-commerce-schema.prisma');
  const normalizedClientDir = generatedClientDir.replaceAll('\\', '/');
  await writeFile(generatePath, candidateText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${normalizedClientDir}"`));
  runPrisma(['validate', '--schema', validatePath]);
  runPrisma(['generate', '--schema', generatePath]);
  await proveLegacyOrderContextPreflight({ history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, generatedClientDir, databaseUrl, runId });
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl }, encoding: 'utf8', windowsHide: true });
  if (deploy.status !== 0) throw new Error(`QA-only migration deploy failed: ${(deploy.stderr || deploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const regressionEnv = { ...process.env };
  for (const name of Object.keys(regressionEnv)) if (name === 'DATABASE_URL' || name === 'DIRECT_URL' || /_DATABASE_URL$/.test(name) || /^PROD/i.test(name)) delete regressionEnv[name];
  Object.assign(regressionEnv, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  const deletionRegression = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', 'scripts/event-deletion.isolated.test.ts'], { cwd: backendRoot, env: regressionEnv, encoding: 'utf8', windowsHide: true });
  const deletionOutput = `${deletionRegression.stdout ?? ''}\n${deletionRegression.stderr ?? ''}`;
  process.stdout.write(deletionOutput);
  if (deletionRegression.status !== 0) throw new Error(`Commercial-chain event deletion regression failed with exit code ${deletionRegression.status ?? 'unknown'}.`);
  const deletionTests = Number(deletionOutput.match(/^# tests (\d+)$/m)?.[1] ?? 0);
  const deletionPassed = Number(deletionOutput.match(/^# pass (\d+)$/m)?.[1] ?? -1);
  const deletionSkipped = Number(deletionOutput.match(/^# skipped (\d+)$/m)?.[1] ?? -1);
  if (deletionTests < 8 || deletionPassed !== deletionTests || deletionSkipped !== 0) throw new Error(`Commercial-chain event deletion gate requires at least 8 executed tests and zero skips (tests=${deletionTests}, pass=${deletionPassed}, skipped=${deletionSkipped}).`);
  const { PrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
  const applied = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(applied.length, history.migrations.length + 5, 'full historical + operational core/catalog/session/finance + commerce chain');
  const constraints = await db.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('Comanda_pontoVendaId_ocorrenciaId_fkey','EstoqueSaldoQuiosque_pontoVendaId_cervejariaId_fkey','EstoqueSaldoQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pontoVendaId_cervejariaId_fkey','MovimentoEstoqueQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey') ORDER BY conname`;
  assert.equal(constraints.length, 6);
  assert(constraints.every((row) => row.confdeltype === 'r' && row.convalidated), 'tenant/context/history constraints are validated and restrictive');

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration, runPdvFinanceMigration, runPdvCommerceMigration } = await import('./pdv-unico-catalog-migrator.ts');
  const { readPdvCommerceSourceSnapshot } = await import('./pdv-unico-commerce-source.ts');
  const company = await db.cervejaria.create({ data: { nome: `QA commerce ${runId}`, slug: slug('commerce') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 4, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  console.log('QA_STAGE=synthetic-unit-and-event-fixtures-created');
  const trailer = await db.trailer.create({ data: { id: id('trailer'), cervejariaId: company.id, nome: 'synthetic trailer', identificador: 'QA-COMMERCE' } });
  const existingPoint = await db.pontoVenda.create({ data: { id: id('existing-point'), cervejariaId: company.id, nome: 'canonical synthetic PDV' } });
  const events = [];
  for (const [name, date, status] of [['first-occurrence', '2026-11-05T00:00:00.000Z', 'FECHADO'], ['second-occurrence', '2026-11-12T00:00:00.000Z', 'ABERTO']]) events.push(await db.evento.create({ data: { id: id(name), cervejariaId: company.id, trailerId: trailer.id, nome: name, local: 'QA', data: new Date(date), horaInicio: '18:00', horaFim: '22:00', status, recorrencia: 'NENHUMA' } }));
  const weeklyAgenda = await db.evento.create({ data: { id: id('weekly-agenda'), cervejariaId: company.id, trailerId: trailer.id, nome: 'Synthetic weekly agenda', local: 'QA recurring location', data: null, recorrencia: 'SEMANAL', diaSemana: 4, horaInicio: '18:30', horaFim: '22:30', status: 'ABERTO' } });
  const recurringOccurrences = [];
  for (const [name, date] of [['weekly-occurrence-one', '2026-11-19T00:00:00.000Z'], ['weekly-occurrence-two', '2026-11-26T00:00:00.000Z']]) recurringOccurrences.push(await db.evento.create({ data: { id: id(name), cervejariaId: company.id, trailerId: trailer.id, serieId: weeklyAgenda.id, nome: name, local: 'QA recurring location', data: new Date(date), recorrencia: 'NENHUMA', status: 'FECHADO' } }));
  events.push(weeklyAgenda, ...recurringOccurrences);
  const { readPdvPlanningSourceSnapshot } = await import('./pdv-unico-source-graph.ts');
  await db.$transaction((tx) => readPdvPlanningSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=shared-source-graph-read');
  const businessRunId = id('business');
  const business = await runPdvBusinessMigration({ db, companyId: company.id, runId: businessRunId });
  assert.equal(business.status, 'COMPLETED', JSON.stringify(business));
  console.log('QA_STAGE=business-maps-confirmed');
  const point = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: company.id } });
  assert.equal(point.id, existingPoint.id, 'existing canonical PDV is preserved');
  const recurringTargets = await db.ocorrenciaOperacional.findMany({ where: { agendaId: weeklyAgenda.id }, orderBy: { data: 'asc' } });
  assert.deepEqual(recurringTargets.map((row) => [row.id, row.data.toISOString().slice(0, 10)]), recurringOccurrences.map((row) => [row.id, row.data.toISOString().slice(0, 10)]), 'recurring occurrences retain distinct dates and the agenda link');
  const product = await db.produto.create({ data: { id: id('product'), cervejariaId: company.id, nome: 'Synthetic product', controlaEstoque: true } });
  const catalogRunId = id('catalog');
  const catalogRun = await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: catalogRunId });
  assert.equal(catalogRun.status, 'COMPLETED', JSON.stringify(catalogRun));
  console.log('QA_STAGE=catalog-and-session-dependencies-confirmed');
  const owner = await db.usuario.create({ data: { nome: 'Synthetic operator', email: `${slug('owner')}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
  const client = await db.cliente.create({ data: { id: id('client'), cervejariaId: company.id, nome: 'Synthetic client' } });
  const eventSession = await db.sessaoCaixaEvento.create({ data: { id: id('event-session-integrated'), eventoId: events[0].id, status: 'FECHADO', trocoInicial: '12.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-05T17:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-05T23:00:00.000Z'), contadoDinheiro: '20.00', contadoPix: '8.25', contadoDebito: '0.00', contadoCredito: '0.00' } });
  const cashSession = await db.sessaoCaixaOperacao.create({ data: { id: id('cash-session-integrated'), cervejariaId: company.id, pontoVendaId: point.id, trailerId: trailer.id, diaOperacional: new Date('2026-11-13T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '5.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-13T10:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-13T22:00:00.000Z'), contadoDinheiro: '5.00', contadoPix: '0.00', contadoCartaoDebito: '0.00', contadoCartaoCredito: '4.00' } });
  const sessionRunId = id('sessions');
  assert.equal((await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: sessionRunId })).status, 'COMPLETED');
  const command = async (name, event, status = 'ABERTA') => db.comanda.create({ data: { id: id(name), origem: event ? 'EVENTO' : 'CAIXA', eventoId: event?.id ?? null, pontoVendaId: event ? null : point.id, clienteId: client.id, status, total: '18.25', desconto: '0.50', numero: name.length } });
  const eventCommand1 = await command('event-command-1', events[0]);
  const eventCommand2 = await command('event-command-2', events[1], 'FECHADA');
  const cashCommand = await command('cash-command', null, 'CANCELADA');
  const item1 = await db.itemComanda.create({ data: { id: id('item-prepared-togo'), comandaId: eventCommand1.id, produtoId: product.id, volumeMl: 0, quantidade: 2, precoUnit: '4.25', nome: 'Snapshot item', observacao: 'private source observation', exigePreparo: true, paraViagem: true } });
  await db.itemComanda.create({ data: { id: id('item-cancelled'), comandaId: eventCommand2.id, produtoId: product.id, volumeMl: 500, quantidade: 1, precoUnit: '9.75', nome: 'Cancelled snapshot', canceladoEm: new Date('2026-11-12T19:00:00.000Z') } });
  const soldOptional = await db.itemComandaOpcional.create({ data: { id: id('sold-optional'), itemComandaId: item1.id, nome: 'Historical optional snapshot', precoAdicional: '0.75', quantidade: 1 } });
  const order = await db.pedidoOperacao.create({ data: { id: id('kitchen-order-togo'), cervejariaId: company.id, comandaId: eventCommand1.id, pontoVendaId: point.id, numero: 9, diaOperacional: new Date('2026-11-05T00:00:00.000Z'), status: 'ENTREGUE', paraViagem: true, criadoPorId: owner.id, statusDesde: new Date('2026-11-05T19:00:00.000Z'), entregueEm: new Date('2026-11-05T19:10:00.000Z') } });
  const localCancelledOrder = await db.pedidoOperacao.create({ data: { id: id('kitchen-order-local-cancelled'), cervejariaId: company.id, comandaId: eventCommand2.id, numero: 10, diaOperacional: new Date('2026-11-12T00:00:00.000Z'), status: 'CANCELADO', paraViagem: false, criadoPorId: owner.id, statusDesde: new Date('2026-11-12T19:00:00.000Z') } });
  await db.itemComanda.update({ where: { id: item1.id }, data: { pedidoCozinhaId: order.id } });
  const item2 = await db.itemComanda.update({ where: { id: id('item-cancelled') }, data: { pedidoCozinhaId: localCancelledOrder.id } });
  await db.pedidoOperacaoStatusHistorico.createMany({ data: [
    { id: id('history-received'), pedidoId: order.id, status: 'RECEBIDO', registradoEm: new Date('2026-11-05T18:01:00.000Z') },
    { id: id('history-preparing'), pedidoId: order.id, status: 'EM_PREPARO', registradoEm: new Date('2026-11-05T18:30:00.000Z') },
    { id: id('history-ready'), pedidoId: order.id, status: 'PRONTO', registradoEm: new Date('2026-11-05T19:00:00.000Z') },
    { id: id('history-delivered'), pedidoId: order.id, status: 'ENTREGUE', registradoEm: new Date('2026-11-05T19:10:00.000Z') },
    { id: id('history-local-received'), pedidoId: localCancelledOrder.id, status: 'RECEBIDO', registradoEm: new Date('2026-11-12T18:01:00.000Z') },
    { id: id('history-local-cancelled'), pedidoId: localCancelledOrder.id, status: 'CANCELADO', registradoEm: new Date('2026-11-12T18:10:00.000Z') },
  ] });
  const portal = await db.pedidoCliente.create({ data: { id: id('portal-order'), eventoId: events[0].id, comandaId: eventCommand1.id, clienteId: client.id, status: 'PENDENTE' } });
  await db.pedidoClienteItem.create({ data: { id: id('portal-line'), pedidoId: portal.id, produtoId: product.id, volumeMl: 0, quantidade: 1, precoUnit: '4.25' } });
  const debtCommand = await db.comanda.create({ data: { id: id('event-debt-command'), origem: 'EVENTO', eventoId: recurringOccurrences[1].id, clienteId: client.id, status: 'FECHADA', tipo: 'COMANDA', total: '6.00', fechadaEm: new Date('2026-11-26T22:00:00.000Z'), fechadoPorId: owner.id } });
  const debt = await db.contaReceber.create({ data: { id: id('event-debt'), comandaId: debtCommand.id, clienteId: client.id, valorOriginal: '6.00', criadoPorId: owner.id, createdAt: new Date('2026-11-12T20:00:00.000Z') } });
  await db.pagamento.createMany({ data: [
    { id: id('integrated-sale-payment'), comandaId: eventCommand1.id, sessaoCaixaEventoId: eventSession.id, forma: 'PIX', valor: '18.25', registradoPorId: owner.id, pagoEm: new Date('2026-11-05T20:00:00.000Z') },
    { id: id('integrated-debt-partial'), comandaId: debtCommand.id, contaReceberId: debt.id, sessaoCaixaEventoId: eventSession.id, forma: 'DINHEIRO', valor: '2.00', valorRecebido: '5.00', troco: '3.00', registradoPorId: owner.id, pagoEm: new Date('2026-11-05T21:00:00.000Z') },
    { id: id('integrated-debt-settlement'), comandaId: debtCommand.id, contaReceberId: debt.id, sessaoCaixaId: cashSession.id, forma: 'CARTAO_CREDITO', valor: '4.00', registradoPorId: owner.id, pagoEm: new Date('2026-11-13T15:00:00.000Z') },
  ] });
  const eventCashMovement = await db.movimentoCaixaEvento.create({ data: { id: id('integrated-event-supply'), sessaoId: eventSession.id, tipo: 'SUPRIMENTO', valor: '1.37', observacao: 'synthetic integrated movement', registradoPorId: owner.id, createdAt: new Date('2026-11-05T22:00:00.000Z') } });
  const financeRunId = id('finance');
  const financeResult = await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: financeRunId });
  assert.equal(financeResult.status, 'COMPLETED', JSON.stringify(financeResult));
  const integratedFinanceRows = {
    payments: await db.pagamento.findMany({ where: { id: { in: [id('integrated-sale-payment'), id('integrated-debt-partial'), id('integrated-debt-settlement')] } }, orderBy: { id: 'asc' } }),
    debt: await db.contaReceber.findUniqueOrThrow({ where: { id: debt.id } }),
    movement: await db.movimentoCaixaOperacao.findUniqueOrThrow({ where: { id: eventCashMovement.id } }),
  };
  assert.deepEqual(integratedFinanceRows.payments.map((row) => [row.id, row.valor.toFixed(2), row.sessaoCaixaId, row.sessaoCaixaEventoId]), [
    [id('integrated-debt-partial'), '2.00', eventSession.id, eventSession.id],
    [id('integrated-debt-settlement'), '4.00', cashSession.id, null],
    [id('integrated-sale-payment'), '18.25', eventSession.id, eventSession.id],
  ]);
  assert.equal(integratedFinanceRows.debt.valorOriginal.toFixed(2), '6.00');
  assert.equal(integratedFinanceRows.movement.valor.toFixed(2), '1.37');
  const balance = await db.inventoryBalance.create({ data: { id: id('stock-balance'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, quantidade: '3.125', estoqueMinimo: '0.500' } });
  const movement = await db.inventoryMovement.create({ data: { id: id('stock-movement'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, tipo: 'SAIDA_VENDA', quantidade: '0.875', registradoPorId: owner.id, pedidoId: order.id, createdAt: new Date('2026-11-05T19:05:00.000Z') } });
  const unattached = await db.comanda.create({ data: { id: id('unattached'), origem: 'EVENTO', eventoId: null, pontoVendaId: null, status: 'ABERTA', total: '0.00' } });
  const before = plain({
    commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, debtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }),
    items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }),
    optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }),
    orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }),
    portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }),
    balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }),
  });
  const photograph = await db.$transaction((tx) => readPdvCommerceSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=commerce-photograph-read');
  assert.deepEqual(photograph.coverage.unresolvedCommandIds, [unattached.id], 'unassignable records remain explicit in source coverage');
  assert.deepEqual([photograph.coverage.commandCount, photograph.coverage.itemCount, photograph.coverage.soldOptionalCount, photograph.coverage.kitchenOrderCount, photograph.coverage.kitchenStatusHistoryCount, photograph.coverage.inventoryBalanceCount, photograph.coverage.inventoryMovementCount], [4, 2, 1, 2, 6, 1, 1]);

  const commerceRunId = id('commerce-run');
  const paused = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId, maxBatches: 1 });
  assert.equal(paused.status, 'RUNNING', JSON.stringify(paused));
  const checkpoint = plain(paused.checkpoint);
  await assert.rejects(runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId, afterDestinationWrite: (row) => { if (row.type === 'COMANDA' && row.id === eventCommand1.id) throw new Error('QA_COMMERCE_ROLLBACK'); } }), /QA_COMMERCE_ROLLBACK/);
  assert.deepEqual(plain((await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: commerceRunId } })).checkpoint), checkpoint, 'failed batch retains last committed checkpoint');
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: eventCommand1.id } })).pontoVendaId, null, 'transaction rolled back link write');
  const completed = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId });
  console.log('QA_STAGE=commerce-run-completed');
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed));
  const linked1 = await db.comanda.findUniqueOrThrow({ where: { id: eventCommand1.id } });
  const linked2 = await db.comanda.findUniqueOrThrow({ where: { id: eventCommand2.id } });
  const linkedDebt = await db.comanda.findUniqueOrThrow({ where: { id: debtCommand.id } });
  assert.equal(linked1.pontoVendaId, point.id); assert.equal(linked1.ocorrenciaId, events[0].id);
  assert.equal(linked2.pontoVendaId, point.id); assert.equal(linked2.ocorrenciaId, events[1].id);
  assert.equal(linkedDebt.pontoVendaId, point.id); assert.equal(linkedDebt.ocorrenciaId, recurringOccurrences[1].id);
  assert.notEqual(linked1.ocorrenciaId, linked2.ocorrenciaId, 'same client retains distinct historical occurrences');
  assert.equal((await db.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id);
  assert.deepEqual(plain({ commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, debtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }), items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }), optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }), orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }), portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }), balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }) }), {
    ...before,
    commands: before.commands.map((row) => ({ ...row, pontoVendaId: point.id, ocorrenciaId: row.id === eventCommand1.id ? events[0].id : row.id === eventCommand2.id ? events[1].id : row.id === debtCommand.id ? recurringOccurrences[1].id : null })),
    orders: before.orders.map((row) => ({ ...row, ...(row.pontoVendaId === null ? { pontoVendaId: point.id } : {}) })),
  }, 'only additive PDV/occurrence links changed; commercial snapshots, item links, status history and stock values are exact');
  assert.equal((await db.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: { in: [order.id, localCancelledOrder.id] } } })), 6);
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.125');
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.875');
  assert.equal((await db.pdvMigrationMap.count({ where: { cervejariaId: company.id, sourceType: { in: ['COMANDA','ITEM_COMANDA','ITEM_COMANDA_OPCIONAL','PEDIDO_COZINHA','PEDIDO_COZINHA_STATUS','PEDIDO_CLIENTE','PEDIDO_CLIENTE_ITEM','ESTOQUE_SALDO','MOVIMENTO_ESTOQUE'] } } })), completed.checkpoint.totalRecords);
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'same run revalidates');
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('commerce-new-run') })).status, 'COMPLETED', 'new run reuses stable maps without duplicate rows');

  // Parent identity is historical payload. Reparenting between valid same-tenant parents
  // must invalidate the stable map even when the child's other fields and ID are unchanged.
  const historyForReparent = await db.pedidoOperacaoStatusHistorico.findFirstOrThrow({ where: { pedidoId: order.id } });
  const parentDriftCases = [
    { label: 'item-comanda-parent', mutate: () => db.itemComanda.update({ where: { id: item2.id }, data: { comandaId: eventCommand1.id } }), restore: () => db.itemComanda.update({ where: { id: item2.id }, data: { comandaId: eventCommand2.id } }), expected: 'COMMERCE_ORDER_ITEM_LINK_MISMATCH' },
    { label: 'sold-optional-parent', mutate: () => db.itemComandaOpcional.update({ where: { id: soldOptional.id }, data: { itemComandaId: item2.id } }), restore: () => db.itemComandaOpcional.update({ where: { id: soldOptional.id }, data: { itemComandaId: item1.id } }), expected: 'SOURCE_PAYLOAD_CHANGED' },
    { label: 'order-status-history-parent', mutate: () => db.pedidoOperacaoStatusHistorico.update({ where: { id: historyForReparent.id }, data: { pedidoId: localCancelledOrder.id } }), restore: () => db.pedidoOperacaoStatusHistorico.update({ where: { id: historyForReparent.id }, data: { pedidoId: order.id } }), expected: 'SOURCE_PAYLOAD_CHANGED' },
  ];
  for (const scenario of parentDriftCases) {
    await scenario.mutate();
    const result = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id(`parent-drift-${scenario.label}`) });
    assert.equal(result.status, 'BLOCKED', `${scenario.label} blocks re-certification`);
    assert.equal(result.code, scenario.expected, `${scenario.label} has a specific blocker`);
    await scenario.restore();
  }
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'restoring original parents preserves original certification');

  // A deterministic in-transaction mutation between source planning and receipt hashing
  // must roll back both the mutation and the pending batch/checkpoint advancement.
  const midBatchRunId = id('commerce-mid-batch-drift');
  const beforeDrift = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId, maxBatches: completed.checkpoint.totalRecords - 1 });
  assert.equal(beforeDrift.status, 'RUNNING');
  const beforeDriftCheckpoint = plain(beforeDrift.checkpoint);
  const driftAttempt = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId, afterDestinationWrite: async (row, tx) => {
    if (row.type === 'MOVIMENTO_ESTOQUE' && row.id === movement.id) await tx.inventoryMovement.update({ where: { id: movement.id }, data: { quantidade: '0.876' } });
  } });
  assert.equal(driftAttempt.status, 'BLOCKED');
  assert.equal(driftAttempt.code, 'MAPPED_DESTINATION_DIVERGED');
  assert.deepEqual(plain((await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: midBatchRunId } })).checkpoint), beforeDriftCheckpoint, 'mid-batch divergence retains last confirmed checkpoint');
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.875', 'mid-batch mutation rolls back');
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId })).status, 'COMPLETED', 'resumes after rollback without altering historic rows');

  const raceCompany = await db.cervejaria.create({ data: { nome: `QA commerce race ${runId}`, slug: slug('race') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: raceCompany.id, ativo: true, controlaEstoque: true, temCozinha: false, exclusivo: false, quantidadeMesas: 0, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  const raceTrailer = await db.trailer.create({ data: { id: id('race-trailer'), cervejariaId: raceCompany.id, nome: 'race trailer', identificador: 'RACE' } });
  await db.evento.create({ data: { id: id('race-event'), cervejariaId: raceCompany.id, trailerId: raceTrailer.id, nome: 'race', local: 'QA', data: new Date('2026-12-02T00:00:00.000Z'), horaInicio: '18:00', status: 'ABERTO', recorrencia: 'NENHUMA' } });
  const raceBusinessRunId = id('race-business');
  assert.equal((await runPdvBusinessMigration({ db, companyId: raceCompany.id, runId: raceBusinessRunId })).status, 'COMPLETED');
  const racePoint = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: raceCompany.id } });
  assert.equal(racePoint.id, raceTrailer.id, 'Event-only tenant maps its sole Trailer to a stable PDV identity');
  const raceProduct = await db.produto.create({ data: { id: id('race-product'), cervejariaId: raceCompany.id, nome: 'race product' } });
  const raceCatalogRunId = id('race-catalog');
  assert.equal((await runPdvCatalogMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCatalogRunId })).status, 'COMPLETED');
  const raceOperator = await db.usuario.create({ data: { id: id('race-operator'), nome: 'Synthetic race operator', email: `${slug('race-operator')}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: raceCompany.id } });
  const raceClient = await db.cliente.create({ data: { id: id('race-client'), cervejariaId: raceCompany.id, nome: 'Synthetic race customer' } });
  const raceEvent = await db.evento.findUniqueOrThrow({ where: { id: id('race-event') } });
  const raceSessionSource = await db.sessaoCaixaEvento.create({ data: { id: id('race-event-session'), eventoId: raceEvent.id, status: 'FECHADO', trocoInicial: '1.00', abertoPorId: raceOperator.id, abertoEm: new Date('2026-12-02T17:00:00.000Z'), fechadoPorId: raceOperator.id, fechadoEm: new Date('2026-12-02T22:00:00.000Z'), contadoDinheiro: '0.00', contadoPix: '1.25', contadoDebito: '0.00', contadoCredito: '0.00' } });
  const raceCommand = await db.comanda.create({ data: { id: id('race-command'), origem: 'EVENTO', eventoId: raceEvent.id, clienteId: raceClient.id, status: 'FECHADA', total: '2.50', fechadaEm: new Date('2026-12-02T21:00:00.000Z'), fechadoPorId: raceOperator.id } });
  const raceDebt = await db.contaReceber.create({ data: { id: id('race-debt'), comandaId: raceCommand.id, clienteId: raceClient.id, valorOriginal: '2.50', criadoPorId: raceOperator.id, createdAt: new Date('2026-12-02T21:00:00.000Z') } });
  const racePayment = await db.pagamento.create({ data: { id: id('race-payment'), comandaId: raceCommand.id, contaReceberId: raceDebt.id, sessaoCaixaEventoId: raceSessionSource.id, forma: 'PIX', valor: '1.25', registradoPorId: raceOperator.id, pagoEm: new Date('2026-12-02T21:30:00.000Z') } });
  const raceFinanceBefore = plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } }), debt: await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } }) });
  const raceSessionRunId = id('race-sessions');
  assert.equal((await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceSessionRunId })).status, 'COMPLETED');
  const raceFinanceRunId = id('race-finance');
  const raceFinanceResult = await runPdvFinanceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceFinanceRunId });
  assert.equal(raceFinanceResult.status, 'COMPLETED', JSON.stringify(raceFinanceResult));
  const racePaymentAfter = await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } });
  const raceDebtAfter = await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } });
  assert.deepEqual([racePaymentAfter.id, racePaymentAfter.valor.toFixed(2), racePaymentAfter.sessaoCaixaId, racePaymentAfter.sessaoCaixaEventoId], [racePayment.id, '1.25', raceSessionSource.id, raceSessionSource.id]);
  const raceDebtPayments = await db.pagamento.findMany({ where: { contaReceberId: raceDebt.id } });
  const raceReceivedCents = raceDebtPayments.reduce((total, row) => total + Math.round(Number(row.valor) * 100), 0);
  assert.deepEqual([raceDebtAfter.valorOriginal.toFixed(2), raceReceivedCents, Math.round((Number(raceDebtAfter.valorOriginal) * 100) - raceReceivedCents)], ['2.50', 125, 125], 'second tenant has a nonempty finance scope and exact debt reconciliation');
  const raceFinanceAfter = plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: racePaymentAfter, debt: raceDebtAfter });
  assert.deepEqual([raceFinanceBefore.session.id, raceFinanceAfter.session.id, raceFinanceBefore.payment.id, raceFinanceAfter.payment.id, raceFinanceBefore.payment.valor, raceFinanceAfter.payment.valor, raceFinanceBefore.payment.forma, raceFinanceAfter.payment.forma, Number(raceFinanceBefore.debt.valorOriginal).toFixed(2), Number(raceFinanceAfter.debt.valorOriginal).toFixed(2)], [raceSessionSource.id, raceSessionSource.id, racePayment.id, racePayment.id, '1.25', '1.25', 'PIX', 'PIX', '2.50', '2.50']);
  await db.itemComanda.create({ data: { id: id('race-item'), comandaId: raceCommand.id, produtoId: raceProduct.id, precoUnit: '2.50' } });
  const raceSecondCommand = await db.comanda.create({ data: { id: id('race-second-command'), origem: 'EVENTO', eventoId: raceEvent.id, clienteId: raceClient.id, status: 'ABERTA', total: '1.00' } });
  const reparentedItem = await db.itemComanda.create({ data: { id: id('race-reparented-item'), comandaId: raceSecondCommand.id, produtoId: raceProduct.id, precoUnit: '1.00', nome: 'No kitchen-order parent-change snapshot' } });
  const raceRunId = id('race-commerce-run');
  let release; let arrive;
  const arrived = new Promise((resolve) => { arrive = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId, afterDestinationWrite: async (row) => { if (row.type === 'COMANDA') { arrive(); await gate; } } });
  await arrived;
  const second = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId });
  let observedLockWait = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await db.$queryRaw`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
    if (waiting.length) { observedLockWait = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  release();
  assert.equal(observedLockWait, true, 'concurrent caller reached scope advisory lock');
  assert.deepEqual((await Promise.all([first, second])).map((row) => row.status), ['COMPLETED','COMPLETED']);
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'COMANDA', sourceId: raceCommand.id } }), 1);
  assert.equal(await db.pdvMigrationBatch.count({ where: { runId: raceRunId } }), (await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: raceRunId } })).checkpoint.totalRecords);
  await db.itemComanda.update({ where: { id: reparentedItem.id }, data: { comandaId: raceCommand.id } });
  const parentTamper = await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId });
  assert.equal(parentTamper.status, 'BLOCKED');
  assert.equal(parentTamper.code, 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH', 'item parent change is rejected by the certified source photograph even without a kitchen order link');
  await db.itemComanda.update({ where: { id: reparentedItem.id }, data: { comandaId: raceSecondCommand.id } });
  assert.equal((await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId })).status, 'COMPLETED', 'restoring original parent permits revalidation');

  // All earlier certifications are checked again after the commercial links have been written.
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: company.id, runId: businessRunId })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: catalogRunId })],
    ['sessions', await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: sessionRunId })],
    ['finance', await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: financeRunId })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })],
  ]) assert.equal(result.status, 'COMPLETED', `same-run integrated revalidation ${label}: ${JSON.stringify(result)}`);
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: company.id, runId: id('business-replay-new-run') })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: id('catalog-replay-new-run') })],
    ['sessions', await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id('sessions-replay-new-run') })],
    ['finance', await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: id('finance-replay-new-run') })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('commerce-replay-new-run') })],
  ]) assert.equal(result.status, 'COMPLETED', `new-run integrated replay ${label}: ${JSON.stringify(result)}`);

  const raceCommerceRunId = raceRunId;
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: raceCompany.id, runId: raceBusinessRunId })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCatalogRunId })],
    ['sessions', await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceSessionRunId })],
    ['finance', await runPdvFinanceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceFinanceRunId })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCommerceRunId })],
  ]) assert.equal(result.status, 'COMPLETED', `Por Caixa/Evento tenant revalidation ${label}: ${JSON.stringify(result)}`);
  assert.deepEqual(plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } }), debt: await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } }) }), raceFinanceAfter, 'second tenant nonempty financial rows remain stable after replay');

  // Downstream scopes must reject a previously certified occurrence when its
  // date, agenda, or business content changes, without moving their checkpoints.
  const certifiedOccurrence = await db.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: events[0].id } });
  const occurrenceTamperCases = [
    { label: 'date', migrate: () => runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-date-drift-session') }), update: { data: new Date('2026-11-06T00:00:00.000Z') }, restore: { data: certifiedOccurrence.data } },
    { label: 'agenda', migrate: () => runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-agenda-drift-finance') }), update: { agendaId: weeklyAgenda.id }, restore: { agendaId: null } },
    { label: 'content', migrate: () => runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-content-drift-commerce') }), update: { nome: 'tampered certified occurrence' }, restore: { nome: certifiedOccurrence.nome } },
  ];
  for (const scenario of occurrenceTamperCases) {
    await db.ocorrenciaOperacional.update({ where: { id: certifiedOccurrence.id }, data: scenario.update });
    const result = await scenario.migrate();
    assert.equal(result.status, 'BLOCKED', `downstream ${scenario.label} tampering refuses dependency: ${JSON.stringify(result)}`);
    assert.match(result.blocker?.code ?? result.code ?? '', /OCCURRENCE_|DEPENDENCY_/, `downstream ${scenario.label} has a specific occurrence blocker`);
    if (result.runId) {
      const blockedRun = await db.pdvMigrationRun.findUnique({ where: { id: result.runId } });
      assert.equal(blockedRun?.checkpoint?.completedSourceKeys?.length ?? 0, 0, `downstream ${scenario.label} does not advance checkpoint or create a run before dependency validation`);
    }
    await db.ocorrenciaOperacional.update({ where: { id: certifiedOccurrence.id }, data: scenario.restore });
  }

  const stockTamper = await db.inventoryBalance.update({ where: { id: balance.id }, data: { quantidade: '3.126' } });
  assert.equal(stockTamper.quantidade.toString(), '3.126');
  const invalidated = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId });
  assert.equal(invalidated.status, 'BLOCKED');
  const invalidRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: commerceRunId } });
  assert.equal(invalidRun.status, 'BLOCKED');
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.126', 'divergence blocks without automatic repair');

  const alternatePoint = await db.pontoVenda.create({ data: { id: id('alternate-point'), cervejariaId: company.id, nome: 'QA alternate' } });
  await assert.rejects(db.comanda.create({ data: { id: id('cross-point-occurrence'), origem: 'EVENTO', eventoId: events[0].id, pontoVendaId: alternatePoint.id, ocorrenciaId: events[0].id, total: '1.00' } }), (error) => error?.code === 'P2003', 'occurrence and command PDV mismatch is rejected by the composite FK');
  const wrongPointCommand = await db.comanda.create({ data: { id: id('wrong-point-command'), origem: 'CAIXA', pontoVendaId: alternatePoint.id, status: 'ABERTA', total: '1.00' } });
  const blockedWrongPoint = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('wrong-point-run') });
  assert.deepEqual([blockedWrongPoint.status, blockedWrongPoint.code], ['BLOCKED', 'OCCURRENCE_MULTIPLE_CANONICAL_PDVS'], 'adding a second canonical PDV invalidates upstream occurrence certification before downstream commerce mapping');
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: wrongPointCommand.id } })).pontoVendaId, alternatePoint.id, 'incompatible historical link is preserved');

  console.log(`PDV_COMMERCE_QA=PASS; migrations=${applied.length}; coverage=commands:4/items:2/sold-optionals:1/kitchen-orders:2/history:6/balances:1/movements:1/unattached:1; mapped=${completed.checkpoint.totalRecords}; rollback=atomic+mid-batch-divergence; parent-link-tamper=3-specific-blockers; same-db-scopes=business,catalog,sessions,finance,commerce; reexecution=same,new; concurrency=lock-observed; stock-tamper=BLOCKED; PROD_ACCESS_USED=NO`);
} finally {
  await db?.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
