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
const manifestPath = path.join(repoRoot, 'docs/testing/pdv-unico-commerce-qa-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const { manifestSha256, ...body } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(body)), manifestSha256), manifestSha256, 'current QA manifest digest');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', manifest.baseline.commit, 'HEAD'], { cwd: repoRoot }).status, 0, 'baseline is immutable ancestor');
assert.equal(sha256(readPinnedBlob(manifest.baseline.commit, manifest.baseline.schemaPath)), manifest.baseline.schemaSha256, 'baseline schema blob hash');
const stagedSchema = spawnSync('git', ['show', ':backend/prisma/schema.prisma'], { cwd: repoRoot, encoding: null });
assert.equal(stagedSchema.status, 0, 'staged candidate schema required');
assert.equal(sha256(stagedSchema.stdout), manifest.delivery.schemaSha256, 'staged schema candidate hash');
const commerceSql = await readFile(path.join(repoRoot, manifest.delivery.migrationPath));
assert.equal(sha256(commerceSql), manifest.delivery.migrationSha256, 'candidate SQL hash');
for (const item of manifest.immutableManifests) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `immutable prior manifest ${item.path}`);
for (const item of manifest.codeCandidates) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `current code candidate ${item.path}`);

function runPrisma(args) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
  for (const name of Object.keys(env)) if (/^PROD/i.test(name) || (/_DATABASE_URL$/.test(name) && name !== 'DATABASE_URL')) delete env[name];
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed: ${(result.stderr || result.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1600)}`);
}
const id = (name) => `${name}-qa-${runId}`;
const slug = (name) => `${name}-${runId}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
const plain = (value) => JSON.parse(JSON.stringify(value));
let db;
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
  const candidateText = stagedSchema.stdout.toString('utf8');
  await writeFile(bundle.schemaPath, stagedSchema.stdout);
  const validatePath = path.join(tempRoot, 'commerce-schema.prisma');
  await writeFile(validatePath, stagedSchema.stdout);
  const generatePath = path.join(tempRoot, 'generate-commerce-schema.prisma');
  const normalizedClientDir = generatedClientDir.replaceAll('\\', '/');
  await writeFile(generatePath, candidateText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${normalizedClientDir}"`));
  runPrisma(['validate', '--schema', validatePath]);
  runPrisma(['generate', '--schema', generatePath]);
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl }, encoding: 'utf8', windowsHide: true });
  if (deploy.status !== 0) throw new Error(`QA-only migration deploy failed: ${(deploy.stderr || deploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const regressionEnv = { ...process.env };
  for (const name of Object.keys(regressionEnv)) if (name === 'DATABASE_URL' || name === 'DIRECT_URL' || /_DATABASE_URL$/.test(name) || /^PROD/i.test(name)) delete regressionEnv[name];
  Object.assign(regressionEnv, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  const deletionRegression = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'scripts/event-deletion.isolated.test.ts'], { cwd: backendRoot, env: regressionEnv, stdio: 'inherit', windowsHide: true });
  if (deletionRegression.status !== 0) throw new Error(`Commercial-chain event deletion regression failed with exit code ${deletionRegression.status ?? 'unknown'}.`);
  const { PrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
  const applied = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(applied.length, history.migrations.length + 5, 'full historical + operational core/catalog/session/finance + commerce chain');
  const constraints = await db.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('Comanda_pontoVendaId_ocorrenciaId_fkey','EstoqueSaldoQuiosque_pontoVendaId_cervejariaId_fkey','EstoqueSaldoQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pontoVendaId_cervejariaId_fkey','MovimentoEstoqueQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey') ORDER BY conname`;
  assert.equal(constraints.length, 6);
  assert(constraints.every((row) => row.confdeltype === 'r' && row.convalidated), 'tenant/context/history constraints are validated and restrictive');

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration, runPdvCommerceMigration } = await import('./pdv-unico-catalog-migrator.ts');
  const { readPdvCommerceSourceSnapshot } = await import('./pdv-unico-commerce-source.ts');
  const company = await db.cervejaria.create({ data: { nome: `QA commerce ${runId}`, slug: slug('commerce') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 4, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  console.log('QA_STAGE=synthetic-unit-and-event-fixtures-created');
  const trailer = await db.trailer.create({ data: { id: id('trailer'), cervejariaId: company.id, nome: 'synthetic trailer', identificador: 'QA-COMMERCE' } });
  const existingPoint = await db.pontoVenda.create({ data: { id: id('existing-point'), cervejariaId: company.id, nome: 'canonical synthetic PDV' } });
  const events = [];
  for (const [name, date, status] of [['first-occurrence', '2026-11-05T00:00:00.000Z', 'FECHADO'], ['second-occurrence', '2026-11-12T00:00:00.000Z', 'ABERTO']]) events.push(await db.evento.create({ data: { id: id(name), cervejariaId: company.id, trailerId: trailer.id, nome: name, local: 'QA', data: new Date(date), horaInicio: '18:00', horaFim: '22:00', status, recorrencia: 'NENHUMA' } }));
  const { readPdvPlanningSourceSnapshot } = await import('./pdv-unico-source-graph.ts');
  await db.$transaction((tx) => readPdvPlanningSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=shared-source-graph-read');
  const business = await runPdvBusinessMigration({ db, companyId: company.id, runId: id('business') });
  assert.equal(business.status, 'COMPLETED', JSON.stringify(business));
  console.log('QA_STAGE=business-maps-confirmed');
  const point = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: company.id } });
  assert.equal(point.id, existingPoint.id, 'existing canonical PDV is preserved');
  const product = await db.produto.create({ data: { id: id('product'), cervejariaId: company.id, nome: 'Synthetic product', controlaEstoque: true } });
  const catalogRun = await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: id('catalog') });
  assert.equal(catalogRun.status, 'COMPLETED', JSON.stringify(catalogRun));
  assert.equal((await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id('sessions') })).status, 'COMPLETED');
  console.log('QA_STAGE=catalog-and-session-dependencies-confirmed');
  const owner = await db.usuario.create({ data: { nome: 'Synthetic operator', email: `${slug('owner')}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
  const client = await db.cliente.create({ data: { id: id('client'), cervejariaId: company.id, nome: 'Synthetic client' } });
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
  const balance = await db.inventoryBalance.create({ data: { id: id('stock-balance'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, quantidade: '3.125', estoqueMinimo: '0.500' } });
  const movement = await db.inventoryMovement.create({ data: { id: id('stock-movement'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, tipo: 'SAIDA_VENDA', quantidade: '0.875', registradoPorId: owner.id, pedidoId: order.id, createdAt: new Date('2026-11-05T19:05:00.000Z') } });
  const unattached = await db.comanda.create({ data: { id: id('unattached'), origem: 'EVENTO', eventoId: null, pontoVendaId: null, status: 'ABERTA', total: '0.00' } });
  const before = plain({
    commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, cashCommand.id] } }, orderBy: { id: 'asc' } }),
    items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }),
    optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }),
    orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }),
    portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }),
    balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }),
  });
  const photograph = await db.$transaction((tx) => readPdvCommerceSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=commerce-photograph-read');
  assert.deepEqual(photograph.coverage.unresolvedCommandIds, [unattached.id], 'unassignable records remain explicit in source coverage');
  assert.deepEqual([photograph.coverage.commandCount, photograph.coverage.itemCount, photograph.coverage.soldOptionalCount, photograph.coverage.kitchenOrderCount, photograph.coverage.kitchenStatusHistoryCount, photograph.coverage.inventoryBalanceCount, photograph.coverage.inventoryMovementCount], [3, 2, 1, 2, 6, 1, 1]);

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
  assert.equal(linked1.pontoVendaId, point.id); assert.equal(linked1.ocorrenciaId, events[0].id);
  assert.equal(linked2.pontoVendaId, point.id); assert.equal(linked2.ocorrenciaId, events[1].id);
  assert.notEqual(linked1.ocorrenciaId, linked2.ocorrenciaId, 'same client retains distinct historical occurrences');
  assert.equal((await db.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id);
  assert.deepEqual(plain({ commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, cashCommand.id] } }, orderBy: { id: 'asc' } }), items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }), optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }), orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }), portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }), balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }) }), {
    ...before,
    commands: before.commands.map((row) => ({ ...row, pontoVendaId: point.id, ocorrenciaId: row.id === eventCommand1.id ? events[0].id : row.id === eventCommand2.id ? events[1].id : null })),
    orders: before.orders.map((row) => ({ ...row, ...(row.pontoVendaId === null ? { pontoVendaId: point.id } : {}) })),
  }, 'only additive PDV/occurrence links changed; commercial snapshots, item links, status history and stock values are exact');
  assert.equal((await db.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: { in: [order.id, localCancelledOrder.id] } } })), 6);
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.125');
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.875');
  assert.equal((await db.pdvMigrationMap.count({ where: { cervejariaId: company.id, sourceType: { in: ['COMANDA','ITEM_COMANDA','ITEM_COMANDA_OPCIONAL','PEDIDO_COZINHA','PEDIDO_COZINHA_STATUS','PEDIDO_CLIENTE','PEDIDO_CLIENTE_ITEM','ESTOQUE_SALDO','MOVIMENTO_ESTOQUE'] } } })), completed.checkpoint.totalRecords);
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'same run revalidates');
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('commerce-new-run') })).status, 'COMPLETED', 'new run reuses stable maps without duplicate rows');

  const alternatePoint = await db.pontoVenda.create({ data: { id: id('alternate-point'), cervejariaId: company.id, nome: 'QA alternate' } });
  await assert.rejects(db.comanda.create({ data: { id: id('cross-point-occurrence'), origem: 'EVENTO', eventoId: events[0].id, pontoVendaId: alternatePoint.id, ocorrenciaId: events[0].id, total: '1.00' } }), (error) => error?.code === 'P2003', 'occurrence and command PDV mismatch is rejected by the composite FK');
  const wrongPointCommand = await db.comanda.create({ data: { id: id('wrong-point-command'), origem: 'CAIXA', pontoVendaId: alternatePoint.id, status: 'ABERTA', total: '1.00' } });
  const blockedWrongPoint = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('wrong-point-run') });
  assert.deepEqual([blockedWrongPoint.status, blockedWrongPoint.code], ['BLOCKED', 'COMMERCE_COMMAND_PDV_MISMATCH']);
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: wrongPointCommand.id } })).pontoVendaId, alternatePoint.id, 'incompatible historical link is preserved');

  const raceCompany = await db.cervejaria.create({ data: { nome: `QA commerce race ${runId}`, slug: slug('race') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: raceCompany.id, ativo: true, controlaEstoque: true, temCozinha: false, exclusivo: false, quantidadeMesas: 0, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  const raceTrailer = await db.trailer.create({ data: { id: id('race-trailer'), cervejariaId: raceCompany.id, nome: 'race trailer', identificador: 'RACE' } });
  await db.evento.create({ data: { id: id('race-event'), cervejariaId: raceCompany.id, trailerId: raceTrailer.id, nome: 'race', local: 'QA', data: new Date('2026-12-02T00:00:00.000Z'), horaInicio: '18:00', status: 'ABERTO', recorrencia: 'NENHUMA' } });
  assert.equal((await runPdvBusinessMigration({ db, companyId: raceCompany.id, runId: id('race-business') })).status, 'COMPLETED');
  const racePoint = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: raceCompany.id } });
  const raceProduct = await db.produto.create({ data: { id: id('race-product'), cervejariaId: raceCompany.id, nome: 'race product' } });
  assert.equal((await runPdvCatalogMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: id('race-catalog') })).status, 'COMPLETED');
  assert.equal((await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: id('race-sessions') })).status, 'COMPLETED');
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

  const stockTamper = await db.inventoryBalance.update({ where: { id: balance.id }, data: { quantidade: '3.126' } });
  assert.equal(stockTamper.quantidade.toString(), '3.126');
  const invalidated = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId });
  assert.equal(invalidated.status, 'BLOCKED');
  const invalidRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: commerceRunId } });
  assert.equal(invalidRun.status, 'BLOCKED');
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.126', 'divergence blocks without automatic repair');

  console.log(`PDV_COMMERCE_QA=PASS; migrations=${applied.length}; coverage=commands:3/items:2/sold-optionals:1/kitchen-orders:2/history:6/balances:1/movements:1/unattached:1; mapped=${completed.checkpoint.totalRecords}; rollback=atomic; reexecution=same,new; concurrency=lock-observed; stock-tamper=BLOCKED; PROD_ACCESS_USED=NO`);
} finally {
  await db?.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
