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
  const { history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, databaseUrl, runId } = args;
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
    const point = await legacyDb.pontoVenda.create({ data: { id: `preflight-point-${runId}`, cervejariaId: company.id, nome: 'Synthetic point' } });
    const product = await legacyDb.produto.create({ data: { id: `preflight-product-${runId}`, cervejariaId: company.id, nome: 'Synthetic legacy product' } });
    const operator = await legacyDb.usuario.create({ data: { id: `preflight-user-${runId}`, nome: 'Synthetic operator', email: `preflight-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
    const command = await legacyDb.comanda.create({ data: { id: `preflight-command-${runId}`, origem: 'CAIXA', status: 'ABERTA', total: '1.00' } });
    const order = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-${runId}`, cervejariaId: company.id, comandaId: command.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: operator.id } });
    const movement = await legacyDb.inventoryMovement.create({ data: { id: `preflight-movement-${runId}`, cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, pedidoId: order.id, tipo: 'SAIDA_VENDA', quantidade: '0.125', registradoPorId: operator.id } });
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
  await proveLegacyOrderContextPreflight({ history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, databaseUrl, runId });
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
  const raceSessionRunId = id('race-sessions');
  assert.equal((await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceSessionRunId })).status, 'COMPLETED');
  const raceFinanceRunId = id('race-finance');
  assert.equal((await runPdvFinanceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceFinanceRunId })).status, 'COMPLETED');
  const raceEvent = await db.evento.findUniqueOrThrow({ where: { id: id('race-event') } });
  const raceCommand = await db.comanda.create({ data: { id: id('race-command'), origem: 'EVENTO', eventoId: raceEvent.id, status: 'ABERTA', total: '2.00' } });
  await db.itemComanda.create({ data: { id: id('race-item'), comandaId: raceCommand.id, produtoId: raceProduct.id, precoUnit: '2.00' } });
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
