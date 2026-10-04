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

// Fail closed before Prisma is generated, imported, or any SQL is executed.
const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL differs from the validated isolated QA target.');
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = process.env.PDV_QA_RUN_ID ?? `manual-${process.pid}`;
const suffix = `qa-${runId}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-sessions-${runId}-`));
const generatedClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-session-client-${runId}`);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const manifestPath = 'docs/testing/pdv-unico-session-qa-manifest.json';
const manifest = JSON.parse(await readFile(path.join(repoRoot, manifestPath), 'utf8'));
const { manifestSha256, ...manifestBody } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(manifestBody))), manifestSha256, 'session candidate manifest digest');
assert.equal(manifest.baseline.commit, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(), 'recorded baseline is exact current commit');
assert.equal(sha256(readPinnedBlob(manifest.baseline.commit, manifest.baseline.schemaPath)), manifest.baseline.schemaSha256, 'immutable baseline schema');
const stagedSchema = spawnSync('git', ['show', ':backend/prisma/schema.prisma'], { cwd: repoRoot, encoding: null });
assert.equal(stagedSchema.status, 0, stagedSchema.stderr);
assert.equal(sha256(stagedSchema.stdout), manifest.delivery.schemaSha256, 'task-only staged schema candidate');
const sessionSql = await readFile(path.join(repoRoot, manifest.delivery.migrationPath));
assert.equal(sha256(sessionSql), manifest.delivery.migrationSha256, 'session migration SQL candidate');
for (const entry of manifest.immutableManifests) assert.equal(sha256(await readFile(path.join(repoRoot, entry.path))), entry.sha256, `preserved manifest ${entry.path}`);
for (const candidate of manifest.codeCandidates) assert.equal(sha256(await readFile(path.join(repoRoot, candidate.path))), candidate.sha256, `candidate code ${candidate.path}`);

function runPrisma(args) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
  for (const key of Object.keys(env)) if (/^PROD/i.test(key) || (/_DATABASE_URL$/.test(key) && key !== 'DATABASE_URL')) delete env[key];
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
}
function gitBlob(commit, filePath) { return readPinnedBlob(commit, filePath); }
function runIdFor(name) { return `${name}-${suffix}`; }
function slug(name) { return `${name}-${suffix}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-'); }

let db;
try {
  const history = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[0].path), 'utf8'));
  await verifyPinnedManifest(history);
  const coreQa = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[1].path), 'utf8'));
  const coreSql = gitBlob(coreQa.confirmedBaseline.commit, coreQa.confirmedBaseline.migration.path);
  assert.equal(sha256(coreSql), coreQa.confirmedBaseline.migration.sha256);
  const catalogQa = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[3].path), 'utf8'));
  const catalogSql = await readFile(path.join(repoRoot, catalogQa.delivery.migrationPath));
  assert.equal(sha256(catalogSql), catalogQa.delivery.migrationSha256, 'previous catalog candidate SQL');
  const bundle = await materializePinnedMigrationBundle(history, tempRoot);
  for (const [name, bytes] of [
    [coreQa.confirmedBaseline.migration.name, coreSql],
    [catalogQa.delivery.migrationName, catalogSql],
    [manifest.delivery.migrationName, sessionSql],
  ]) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), bytes);
  }
  const candidateText = stagedSchema.stdout.toString('utf8');
  await writeFile(bundle.schemaPath, stagedSchema.stdout);
  const baseSchemaPath = path.join(tempRoot, 'session-schema.prisma');
  await writeFile(baseSchemaPath, stagedSchema.stdout);
  const generateSchemaPath = path.join(tempRoot, 'generate-session-schema.prisma');
  await writeFile(generateSchemaPath, candidateText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`));
  runPrisma(['validate', '--schema', baseSchemaPath]);
  runPrisma(['generate', '--schema', generateSchemaPath]);

  // Migrations are applied only to this labeled container with tmpfs storage.
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], {
    cwd: backendRoot, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
  });
  if (deploy.status !== 0) throw new Error(`QA-only migrate deploy failed: ${(deploy.stderr || deploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const { PrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const migrationCount = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(migrationCount[0].count, history.migrations.length + 3, 'historical + core + catalog + session candidate migration count');
  const applied = await db.$queryRaw`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = ${manifest.delivery.migrationName} AND finished_at IS NOT NULL`;
  assert.equal(applied.length, 1);
  assert.equal(applied[0].checksum, sha256(sessionSql));
  const sessionIndexes = await db.$queryRaw`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE (schemaname = 'public' AND tablename = 'SessaoCaixaEvento') OR (schemaname = 'quiosque' AND tablename IN ('SessaoCaixaQuiosque', 'SessaoCaixaProdutoQuiosque')) ORDER BY schemaname, tablename, indexname`;
  assert.ok(sessionIndexes.some((row) => row.schemaname === 'public' && row.tablename === 'SessaoCaixaEvento' && row.indexname === 'SessaoCaixaEvento_one_open_per_event_idx' && row.indexdef.includes('UNIQUE') && row.indexdef.includes('status')) , 'existing one-open-source-session index is present before transfer');
  assert.ok(sessionIndexes.some((row) => row.schemaname === 'quiosque' && row.tablename === 'SessaoCaixaProdutoQuiosque' && row.indexdef.includes('UNIQUE') && row.indexdef.includes('sessaoCaixaId') && row.indexdef.includes('produtoId') && row.indexdef.includes('volumeMl')), 'existing target session-item uniqueness is present before transfer');
  assert.equal(sessionIndexes.filter((row) => row.schemaname === 'quiosque' && row.tablename === 'SessaoCaixaQuiosque' && row.indexdef.includes('UNIQUE') && row.indexdef.includes('diaOperacional')).length, 0, 'there is no database-level one-open-session-per-point/day index to remove');
  const eventSessionFk = await db.$queryRaw`SELECT confdeltype FROM pg_constraint WHERE conname = 'SessaoCaixaEvento_eventoId_fkey'`;
  assert.deepEqual(eventSessionFk.map((row) => row.confdeltype), ['r'], 'legacy event session FK is restrictive');

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration } = await import('./pdv-unico-catalog-migrator.ts');

  async function companyFixture(name, { events = [], existingPoint = false } = {}) {
    const company = await db.cervejaria.create({ data: { nome: `${name} ${suffix}`, slug: slug(name) } });
    const trailer = await db.trailer.create({ data: { id: runIdFor(`${name}-trailer`), cervejariaId: company.id, nome: 'Synthetic trailer', identificador: `${name}-T`, createdAt: new Date('2026-01-02T03:04:05.000Z'), updatedAt: new Date('2026-01-03T04:05:06.000Z') } });
    const point = existingPoint ? await db.pontoVenda.create({ data: { id: runIdFor(`${name}-point`), cervejariaId: company.id, nome: 'Preexisting PDV', ativo: true, createdAt: new Date('2025-01-01T00:00:00.000Z'), updatedAt: new Date('2025-01-02T00:00:00.000Z') } }) : null;
    await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: 12 } });
    await db.configuracaoOperacional.create({ data: { cervejariaId: company.id, directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true, kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true, whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: false } });
    const eventRows = [];
    for (const input of events) eventRows.push(await db.evento.create({ data: {
      id: input.id ?? runIdFor(`${name}-${input.key}`), cervejariaId: company.id, trailerId: input.foreignTrailerId ?? trailer.id,
      nome: input.name ?? input.key, local: 'QA local', data: input.date === null ? null : new Date(`${input.date ?? '2026-11-01'}T00:00:00.000Z`),
      horaInicio: '18:45', horaFim: '22:15', status: input.status ?? 'ABERTO', recorrencia: 'NENHUMA',
      createdAt: new Date('2026-02-03T04:05:06.000Z'), updatedAt: new Date('2026-02-04T05:06:07.000Z'),
    } }));
    const business = await runPdvBusinessMigration({ db, companyId: company.id, runId: runIdFor(`${name}-business`), batchSize: 20 });
    assert.equal(business.status, 'COMPLETED', `business prerequisite ${name}: ${JSON.stringify(business)}`);
    return { company, trailer, point: point ?? await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: company.id } }), events: eventRows };
  }

  async function seedCatalog(fixture, { withMenu = false } = {}) {
    const companyId = fixture.company.id;
    const product = await db.produto.create({ data: {
      id: runIdFor(`${fixture.company.slug}-product`), cervejariaId: companyId, nome: 'QA Session Product', categoria: 'Bebidas', tipo: 'BEBIDA', formato: 'CHOPE', ativo: true, exigePreparo: true, controlaEstoque: true,
      precos: { create: [{ id: runIdFor(`${fixture.company.slug}-price500`), volumeMl: 500, preco: '7.25' }, { id: runIdFor(`${fixture.company.slug}-price1000`), volumeMl: 1000, preco: '13.50' }, { id: runIdFor(`${fixture.company.slug}-price1500`), volumeMl: 1500, preco: '17.25' }] },
    } });
    const menus = [];
    if (withMenu) {
      for (const [idx, amount] of ['8.75', '9.25'].entries()) menus.push(await db.cardapio.create({ data: {
        id: runIdFor(`${fixture.company.slug}-menu-${idx}`), cervejariaId: companyId, nome: `Menu ${idx}`, ativo: idx === 0,
        produtos: { create: [{ id: runIdFor(`${fixture.company.slug}-menuitem-${idx}`), produtoId: product.id, volumeMl: 500, precoUnit: amount }, { id: runIdFor(`${fixture.company.slug}-menuitem-${idx}-unit`), produtoId: product.id, volumeMl: 1000, precoUnit: idx === 0 ? '14.25' : '15.00' }, { id: runIdFor(`${fixture.company.slug}-menuitem-${idx}-1500`), produtoId: product.id, volumeMl: 1500, precoUnit: idx === 0 ? '19.00' : '20.00' }] },
      } }));
    }
    for (const event of fixture.events) {
      if (withMenu) await db.evento.update({ where: { id: event.id }, data: { cardapioId: menus[0].id } });
      await db.eventoProduto.create({ data: { id: runIdFor(`${event.id}-selected`), eventoId: event.id, produtoId: product.id, createdAt: new Date('2026-04-05T06:07:08.000Z') } });
    }
    const catalog = await runPdvCatalogMigration({ db, companyId, pointId: fixture.point.id, runId: runIdFor(`${fixture.company.slug}-catalog`) });
    assert.equal(catalog.status, 'COMPLETED', `catalog prerequisite: ${JSON.stringify(catalog)}`);
    return { product, menus };
  }

  // Completed catalog certifications are durably invalidated for each integrity failure.
  for (const kind of ['destination', 'map', 'checkpoint']) {
    const fixture = await companyFixture(`invalidate-${kind}`);
    await seedCatalog(fixture);
    const runId = runIdFor(`invalidate-${kind}-run`);
    assert.equal((await runPdvCatalogMigration({ db, companyId: fixture.company.id, pointId: fixture.point.id, runId })).status, 'COMPLETED');
    const before = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
    const checkpoint = before.checkpoint;
    if (kind === 'destination') await db.configuracaoPontoVenda.update({ where: { pontoVendaId: fixture.point.id }, data: { kitchenEnabled: false } });
    if (kind === 'map') {
      const [sourceType, sourceId] = checkpoint.completedSourceKeys[0].split(':');
      await db.pdvMigrationMap.delete({ where: { sourceType_sourceId: { sourceType, sourceId } } });
    }
    if (kind === 'checkpoint') await db.pdvMigrationRun.update({ where: { id: runId }, data: { checkpoint: { ...checkpoint, completedSourceKeys: [] } } });
    const corrupted = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
    const result = await runPdvCatalogMigration({ db, companyId: fixture.company.id, pointId: fixture.point.id, runId });
    assert.equal(result.status, 'BLOCKED', `${kind} integrity loss blocks completed run`);
    assert.equal(result.invalidatedCompletedRun, true);
    const afterRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(afterRun.status, 'BLOCKED', `${kind} state persisted`);
    assert.deepEqual(afterRun.checkpoint, corrupted.checkpoint, `${kind} checkpoint/evidence retained exactly`);
  }

  const main = await companyFixture('session-main', { events: [
    { key: 'event-open', date: '2026-11-01', status: 'ABERTO' },
    { key: 'event-closed', date: '2026-11-02', status: 'FECHADO' },
  ] });
  const { product, menus } = await seedCatalog(main, { withMenu: true });
  const owner = await db.usuario.create({ data: { nome: 'QA Owner', email: `${suffix}@example.invalid`, senhaHash: 'synthetic-hash', papel: 'DONO', cervejariaId: main.company.id } });
  const closer = await db.usuario.create({ data: { nome: 'QA Closer', email: `closer-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', papel: 'ATENDENTE', cervejariaId: main.company.id } });

  // Por Caixa session keeps its explicit menu, selected volumes and nullable/zero overrides.
  const cashSession = await db.sessaoCaixaOperacao.create({ data: {
    id: runIdFor('cash-session'), cervejariaId: main.company.id, pontoVendaId: main.point.id, trailerId: main.trailer.id,
    diaOperacional: new Date('2026-10-31T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '45.67', abertoPorId: owner.id,
    abertoEm: new Date('2026-10-31T11:12:13.000Z'), fechadoPorId: closer.id, fechadoEm: new Date('2026-10-31T22:23:24.000Z'),
    contadoDinheiro: '100.01', contadoPix: '20.02', contadoCartaoDebito: '30.03', contadoCartaoCredito: '40.04', observacaoFechamento: 'cash session note',
    cardapioId: menus[1].id, origemHistorica: 'CAIXA',
    produtos: { create: [
      { id: runIdFor('cash-override-zero'), produtoId: product.id, volumeMl: 500, precoUnit: '0.00', createdAt: new Date('2026-10-31T12:00:00.000Z') },
      { id: runIdFor('cash-override-null'), produtoId: product.id, volumeMl: 1000, precoUnit: null, createdAt: new Date('2026-10-31T12:01:00.000Z') },
      { id: runIdFor('cash-override-explicit'), produtoId: product.id, volumeMl: 1500, precoUnit: '16.60', createdAt: new Date('2026-10-31T12:02:00.000Z') },
    ] },
  } });
  const [openEvent, closedEvent] = main.events;
  const eventOpenSessionId = runIdFor('event-open-session');
  const eventClosedSessionId = runIdFor('event-closed-session');
  const openedAt = new Date('2026-11-01T18:00:01.000Z');
  const closedAt = new Date('2026-11-02T23:59:59.000Z');
  await db.sessaoCaixaEvento.create({ data: { id: eventOpenSessionId, eventoId: openEvent.id, status: 'ABERTO', trocoInicial: '11.12', abertoPorId: owner.id, abertoEm: openedAt } });
  await db.sessaoCaixaEvento.create({ data: {
    id: eventClosedSessionId, eventoId: closedEvent.id, status: 'FECHADO', trocoInicial: '22.23', abertoPorId: owner.id,
    abertoEm: new Date('2026-11-02T17:00:00.000Z'), fechadoPorId: closer.id, fechadoEm: closedAt,
    contadoDinheiro: '123.45', contadoPix: '234.56', contadoDebito: '345.67', contadoCredito: '456.78', contadoCartao: '802.45', observacaoFechamento: 'event close note',
  } });

  const command = await db.comanda.create({ data: { id: runIdFor('event-command'), origem: 'EVENTO', eventoId: closedEvent.id, status: 'FECHADA', tipo: 'COMANDA', total: '8.50', fechadaEm: closedAt, fechadoPorId: closer.id } });
  const snapshotItem = await db.itemComanda.create({ data: { id: runIdFor('historical-item'), comandaId: command.id, produtoId: product.id, volumeMl: 500, quantidade: 1, precoUnit: '8.50', nome: 'Original Snapshot Product', observacao: 'original snapshot', exigePreparo: true } });
  const payment = await db.pagamento.create({ data: { id: runIdFor('event-payment'), comandaId: command.id, sessaoCaixaEventoId: eventClosedSessionId, forma: 'PIX', valor: '8.50', pagoEm: new Date('2026-11-02T22:30:00.000Z'), registradoPorId: closer.id } });
  const movement = await db.movimentoCaixaEvento.create({ data: { id: runIdFor('event-movement'), sessaoId: eventClosedSessionId, tipo: 'SUPRIMENTO', valor: '17.35', observacao: 'untouched movement', registradoPorId: owner.id, createdAt: new Date('2026-11-02T21:30:00.000Z') } });
  const client = await db.cliente.create({ data: { id: runIdFor('synthetic-customer'), cervejariaId: main.company.id, nome: 'Synthetic debt client' } });
  const debtCommand = await db.comanda.create({ data: { id: runIdFor('event-debt-command'), origem: 'EVENTO', eventoId: closedEvent.id, clienteId: client.id, status: 'FECHADA', tipo: 'COMANDA', total: '19.25', fechadaEm: closedAt, fechadoPorId: closer.id } });
  const debt = await db.contaReceber.create({ data: { id: runIdFor('event-debt'), comandaId: debtCommand.id, clienteId: client.id, valorOriginal: '19.25', criadoPorId: closer.id, createdAt: new Date('2026-11-02T20:30:00.000Z') } });

  async function financeAndSnapshot() {
    const [sessionRows, movements, payments, debts, item] = await Promise.all([
      db.sessaoCaixaEvento.findMany({ where: { id: { in: [eventOpenSessionId, eventClosedSessionId] } }, orderBy: { id: 'asc' } }),
      db.movimentoCaixaEvento.findMany({ where: { id: movement.id } }), db.pagamento.findMany({ where: { id: payment.id } }),
      db.contaReceber.findMany({ where: { id: debt.id } }), db.itemComanda.findUniqueOrThrow({ where: { id: snapshotItem.id } }),
    ]);
    return JSON.parse(JSON.stringify({ sessionRows, movements, payments, debts, item }));
  }
  const financeBefore = await financeAndSnapshot();
  const sourceOperationalBefore = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, include: { produtos: { orderBy: { id: 'asc' } } } });
  const sessionRunId = runIdFor('session-main-run');
  const sessionResult = await runPdvSessionMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: sessionRunId });
  assert.equal(sessionResult.status, 'COMPLETED', `session migration: ${JSON.stringify(sessionResult)}`);
  const [cashAfter, eventOpenAfter, eventClosedAfter, eventTurnItems] = await Promise.all([
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id }, include: { produtos: { orderBy: { id: 'asc' } } } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: eventOpenSessionId } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: eventClosedSessionId } }),
    db.sessaoCaixaProdutoOperacao.findMany({ where: { sessaoCaixaId: { in: [eventOpenSessionId, eventClosedSessionId] } }, orderBy: [{ sessaoCaixaId: 'asc' }, { id: 'asc' }] }),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(cashAfter)), JSON.parse(JSON.stringify(sourceOperationalBefore)), 'existing Por Caixa session and all its menu/override rows unchanged');
  assert.deepEqual({ id: eventOpenAfter.id, dia: eventOpenAfter.diaOperacional.toISOString().slice(0, 10), status: eventOpenAfter.status, troco: eventOpenAfter.trocoInicial.toFixed(2), abertoPorId: eventOpenAfter.abertoPorId, abertoEm: eventOpenAfter.abertoEm.toISOString(), trailerId: eventOpenAfter.trailerId, cardapioId: eventOpenAfter.cardapioId, ocorrenciaId: eventOpenAfter.ocorrenciaId, origem: eventOpenAfter.origemHistorica }, { id: eventOpenSessionId, dia: '2026-11-01', status: 'ABERTO', troco: '11.12', abertoPorId: owner.id, abertoEm: openedAt.toISOString(), trailerId: main.trailer.id, cardapioId: menus[0].id, ocorrenciaId: openEvent.id, origem: 'EVENTO' });
  assert.deepEqual({ id: eventClosedAfter.id, dia: eventClosedAfter.diaOperacional.toISOString().slice(0, 10), status: eventClosedAfter.status, troco: eventClosedAfter.trocoInicial.toFixed(2), fechadoPorId: eventClosedAfter.fechadoPorId, fechadoEm: eventClosedAfter.fechadoEm.toISOString(), dinheiro: eventClosedAfter.contadoDinheiro.toFixed(2), pix: eventClosedAfter.contadoPix.toFixed(2), debito: eventClosedAfter.contadoCartaoDebito.toFixed(2), credito: eventClosedAfter.contadoCartaoCredito.toFixed(2), cartaoAgregado: eventClosedAfter.contadoCartao.toFixed(2), nota: eventClosedAfter.observacaoFechamento, cardapioId: eventClosedAfter.cardapioId, ocorrenciaId: eventClosedAfter.ocorrenciaId, origem: eventClosedAfter.origemHistorica }, { id: eventClosedSessionId, dia: '2026-11-02', status: 'FECHADO', troco: '22.23', fechadoPorId: closer.id, fechadoEm: closedAt.toISOString(), dinheiro: '123.45', pix: '234.56', debito: '345.67', credito: '456.78', cartaoAgregado: '802.45', nota: 'event close note', cardapioId: menus[0].id, ocorrenciaId: closedEvent.id, origem: 'EVENTO' });
  assert.equal(eventTurnItems.length, 2, 'Evento selected product membership copied per occurrence/session');
  assert.ok(eventTurnItems.every((item) => item.produtoId === product.id && item.volumeMl === 0 && item.precoUnit === null), 'Event-only product selection carries no invented volume or turn override');
  assert.deepEqual(await financeAndSnapshot(), financeBefore, 'payments, movements, debt and sales snapshots remain unchanged');
  assert.equal((await db.sessaoCaixaEvento.count({ where: { id: { in: [eventOpenSessionId, eventClosedSessionId] } } })), 2, 'legacy source sessions remain intact');

  // Consumer-level result uses the real sessao-cardapio database path and price precedence.
  const { getCardapioTurno, mapPrecosTurno } = await import('../src/lib/operacao/sessao-cardapio.ts');
  const realMenuResult = await getCardapioTurno(cashSession.id, main.company.id);
  assert.equal(realMenuResult.cardapioId, menus[1].id);
  const visibleRows = realMenuResult.produtos.filter((row) => row.id === product.id).map((row) => ({ volumeMl: row.volumeMl, price: row.precoEfetivo })).sort((a, b) => a.volumeMl - b.volumeMl);
  assert.deepEqual(visibleRows, [{ volumeMl: 500, price: 0 }, { volumeMl: 1000, price: 15 }, { volumeMl: 1500, price: 16.6 }], 'real consumer applies zero and explicit turn overrides, while null falls back to selected menu');
  assert.equal((await mapPrecosTurno(cashSession.id)).get(`${product.id}:500`), 0);

  const afterFirstCounts = {
    operational: await db.sessaoCaixaOperacao.count({ where: { cervejariaId: main.company.id } }),
    eventSource: await db.sessaoCaixaEvento.count({ where: { evento: { is: { cervejariaId: main.company.id } } } }),
    maps: await db.pdvMigrationMap.count({ where: { cervejariaId: main.company.id, sourceType: { in: ['SESSAO_CAIXA_OPERACAO', 'SESSAO_CAIXA_EVENTO', 'SESSAO_CAIXA_OPERACAO_ITEM', 'EVENTO_PRODUTO_SESSAO'] } } }),
    batches: await db.pdvMigrationBatch.count({ where: { runId: sessionRunId } }),
  };
  assert.equal((await runPdvSessionMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: sessionRunId })).status, 'COMPLETED', 'same run revalidation');
  assert.equal((await runPdvSessionMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: runIdFor('session-main-new-run') })).status, 'COMPLETED', 'new run reuses stable identities');
  assert.deepEqual({ operational: await db.sessaoCaixaOperacao.count({ where: { cervejariaId: main.company.id } }), eventSource: await db.sessaoCaixaEvento.count({ where: { evento: { is: { cervejariaId: main.company.id } } } }) }, { operational: afterFirstCounts.operational, eventSource: 2 });
  assert.equal(await db.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId: { in: [eventOpenSessionId, eventClosedSessionId] } } }), 2, 'new-run retry does not duplicate event selection items');
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: main.company.id, sourceType: { in: ['SESSAO_CAIXA_OPERACAO', 'SESSAO_CAIXA_EVENTO', 'SESSAO_CAIXA_OPERACAO_ITEM', 'EVENTO_PRODUTO_SESSAO'] } } }), afterFirstCounts.maps, 'new run does not duplicate stable session/override maps');

  // An explicit checkpoint survives an interruption after a later destination write rolls back.
  const resumeFixture = await companyFixture('session-resume', { events: [{ key: 'resume-event', date: '2026-12-10' }] });
  const resumeCatalog = await seedCatalog(resumeFixture);
  const resumeUser = await db.usuario.create({ data: { nome: 'Resume user', email: `resume-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: resumeFixture.company.id } });
  const resumeCash = await db.sessaoCaixaOperacao.create({ data: { id: runIdFor('resume-cash'), cervejariaId: resumeFixture.company.id, pontoVendaId: resumeFixture.point.id, diaOperacional: new Date('2026-12-09T00:00:00Z'), abertoPorId: resumeUser.id, trocoInicial: '1.00' } });
  const resumeEventSessionId = runIdFor('resume-event-session');
  await db.sessaoCaixaEvento.create({ data: { id: resumeEventSessionId, eventoId: resumeFixture.events[0].id, abertoPorId: resumeUser.id, trocoInicial: '2.00' } });
  const resumeRun = runIdFor('session-resume-run');
  const paused = await runPdvSessionMigration({ db, companyId: resumeFixture.company.id, pointId: resumeFixture.point.id, runId: resumeRun, maxBatches: 1 });
  assert.equal(paused.status, 'RUNNING');
  const checkpointBeforeFailure = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: resumeRun } });
  await assert.rejects(() => runPdvSessionMigration({ db, companyId: resumeFixture.company.id, pointId: resumeFixture.point.id, runId: resumeRun, afterDestinationWrite: () => { throw new Error('QA_SESSION_ROLLBACK_AFTER_WRITE'); } }), /QA_SESSION_ROLLBACK_AFTER_WRITE/);
  const checkpointAfterFailure = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: resumeRun } });
  assert.deepEqual(checkpointAfterFailure.checkpoint, checkpointBeforeFailure.checkpoint, 'confirmed checkpoint retained after rollback');
  assert.equal(await db.sessaoCaixaOperacao.count({ where: { id: resumeEventSessionId } }), 0, 'new destination session was rolled back');
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'SESSAO_CAIXA_EVENTO', sourceId: resumeEventSessionId } }), 0, 'failed batch did not leave a map');
  assert.equal((await runPdvSessionMigration({ db, companyId: resumeFixture.company.id, pointId: resumeFixture.point.id, runId: resumeRun })).status, 'COMPLETED', 'resume from last confirmed batch');

  // Same-scope concurrent calls are coordinated by the transaction advisory lock, observed in PostgreSQL.
  const concurrent = await companyFixture('session-concurrent', { events: [{ key: 'concurrent-event', date: '2026-12-20' }] });
  await seedCatalog(concurrent);
  const concurrentUser = await db.usuario.create({ data: { nome: 'Concurrent user', email: `concurrent-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: concurrent.company.id } });
  const concurrentEventSessionId = runIdFor('concurrent-event-session');
  await db.sessaoCaixaEvento.create({ data: { id: concurrentEventSessionId, eventoId: concurrent.events[0].id, abertoPorId: concurrentUser.id, trocoInicial: '3.00' } });
  let enteredResolve; let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let pausedAtWrite = false;
  const sameRun = runIdFor('session-concurrent-run');
  const firstCall = runPdvSessionMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sameRun, afterDestinationWrite: async () => { if (!pausedAtWrite) { pausedAtWrite = true; enteredResolve(); await release; } } });
  await entered;
  const secondCall = runPdvSessionMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sameRun });
  let observedLockWait = false;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND query ILIKE '%pg_advisory_xact_lock%'`;
    if (rows[0].count > 0) { observedLockWait = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(observedLockWait, true, 'second same-run request observed waiting on PostgreSQL advisory lock');
  releaseResolve();
  const concurrentResults = await Promise.all([firstCall, secondCall]);
  assert.ok(concurrentResults.every((result) => result.status === 'COMPLETED'));
  assert.equal(await db.sessaoCaixaOperacao.count({ where: { id: concurrentEventSessionId } }), 1);
  const concurrentRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sameRun } });
  assert.equal(concurrentRun.status, 'COMPLETED');
  assert.equal(concurrentRun.checkpoint.lastConfirmedBatch, concurrentRun.checkpoint.completedSourceKeys.length);

  // A corrupted completed session destination invalidates the old certification and is never repaired.
  await db.sessaoCaixaOperacao.update({ where: { id: concurrentEventSessionId }, data: { observacaoFechamento: 'tampered' } });
  const beforeTamperCheck = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sameRun } });
  const tamperResult = await runPdvSessionMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sameRun });
  assert.equal(tamperResult.status, 'BLOCKED');
  assert.equal(tamperResult.code, 'MAPPED_DESTINATION_DIVERGED');
  const afterTamperCheck = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sameRun } });
  assert.equal(afterTamperCheck.status, 'BLOCKED');
  assert.deepEqual(afterTamperCheck.checkpoint, beforeTamperCheck.checkpoint);
  assert.equal((await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: concurrentEventSessionId } })).observacaoFechamento, 'tampered', 'tampered destination is not overwritten');

  // Explicit blockers: unproven operational day, cross-tenant PDV, open-session overlap and session ID collision.
  const noDate = await companyFixture('session-no-date');
  await seedCatalog(noDate);
  const noDateUser = await db.usuario.create({ data: { nome: 'No date user', email: `nodate-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: noDate.company.id } });
  const noDateEvent = await db.evento.create({ data: { id: runIdFor('no-date-event'), cervejariaId: noDate.company.id, trailerId: noDate.trailer.id, nome: 'No persisted operational day', local: 'QA', data: null, horaInicio: '18:00', status: 'ABERTO' } });
  await db.sessaoCaixaEvento.create({ data: { id: runIdFor('no-date-session'), eventoId: noDateEvent.id, abertoPorId: noDateUser.id, trocoInicial: '1.00' } });
  const noDateResult = await runPdvSessionMigration({ db, companyId: noDate.company.id, pointId: noDate.point.id, runId: runIdFor('no-date-session-run') });
  assert.deepEqual([noDateResult.status, noDateResult.code], ['BLOCKED', 'SESSION_OPERATIONAL_DAY_UNPROVEN']);

  const openConflict = await companyFixture('session-open-conflict', { events: [{ key: 'open-conflict', date: '2026-12-21' }] });
  await seedCatalog(openConflict);
  const conflictUser = await db.usuario.create({ data: { nome: 'Conflict user', email: `conflict-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: openConflict.company.id } });
  await db.sessaoCaixaOperacao.create({ data: { id: runIdFor('conflicting-open-session'), cervejariaId: openConflict.company.id, pontoVendaId: openConflict.point.id, diaOperacional: new Date('2026-12-21T00:00:00Z'), abertoPorId: conflictUser.id, trocoInicial: '1.00' } });
  await db.sessaoCaixaEvento.create({ data: { id: runIdFor('conflicting-event-session'), eventoId: openConflict.events[0].id, abertoPorId: conflictUser.id, trocoInicial: '1.00' } });
  const openConflictResult = await runPdvSessionMigration({ db, companyId: openConflict.company.id, pointId: openConflict.point.id, runId: runIdFor('open-conflict-run') });
  assert.deepEqual([openConflictResult.status, openConflictResult.code], ['BLOCKED', 'OPEN_SESSION_CONFLICT']);

  const collision = await companyFixture('session-id-collision', { events: [{ key: 'collision', date: '2026-12-22', status: 'FECHADO' }] });
  await seedCatalog(collision);
  const collisionUser = await db.usuario.create({ data: { nome: 'Collision user', email: `collision-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: collision.company.id } });
  const collisionId = runIdFor('colliding-session-id');
  await db.sessaoCaixaEvento.create({ data: { id: collisionId, eventoId: collision.events[0].id, status: 'FECHADO', abertoPorId: collisionUser.id, trocoInicial: '1.00', fechadoPorId: collisionUser.id, fechadoEm: new Date('2026-12-22T23:00:00Z') } });
  await db.sessaoCaixaOperacao.create({ data: { id: collisionId, cervejariaId: collision.company.id, pontoVendaId: collision.point.id, diaOperacional: new Date('2026-12-22T00:00:00Z'), status: 'FECHADO', abertoPorId: collisionUser.id, trocoInicial: '2.00', fechadoPorId: collisionUser.id, fechadoEm: new Date('2026-12-22T23:01:00Z') } });
  const collisionResult = await runPdvSessionMigration({ db, companyId: collision.company.id, pointId: collision.point.id, runId: runIdFor('collision-run') });
  assert.deepEqual([collisionResult.status, collisionResult.code], ['BLOCKED', 'SESSION_ID_COLLISION']);

  const foreign = await companyFixture('session-foreign', { events: [{ key: 'foreign-point', date: '2026-12-23' }] });
  await seedCatalog(foreign);
  const other = await companyFixture('session-other-company');
  const foreignUser = await db.usuario.create({ data: { nome: 'Foreign user', email: `foreign-${suffix}@example.invalid`, senhaHash: 'synthetic-hash', cervejariaId: foreign.company.id } });
  await db.sessaoCaixaOperacao.create({ data: { id: runIdFor('foreign-pdv-session'), cervejariaId: foreign.company.id, pontoVendaId: other.point.id, diaOperacional: new Date('2026-12-23T00:00:00Z'), abertoPorId: foreignUser.id, trocoInicial: '1.00' } });
  const foreignResult = await runPdvSessionMigration({ db, companyId: foreign.company.id, pointId: foreign.point.id, runId: runIdFor('foreign-pdv-run') });
  assert.deepEqual([foreignResult.status, foreignResult.code], ['BLOCKED', 'SESSION_TENANT_OR_PDV_MISMATCH']);

  // Parent scope reuse must never alter an unrelated completed run.
  const protectedRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sameRun } });
  const otherScopeReuse = await runPdvCatalogMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: sameRun });
  assert.deepEqual([otherScopeReuse.status, otherScopeReuse.code], ['BLOCKED', 'RUN_ID_SCOPE_MISMATCH']);
  assert.deepEqual(await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: sameRun } }), protectedRun, 'wrong scope reuse did not invalidate or mutate the run');

  const graphRegression = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'scripts/pdv-unico-planner.isolated.test.ts'], {
    cwd: backendRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, QA_DATABASE_URL: databaseUrl, PDV_ISOLATED_QA: '1' },
    encoding: 'utf8', windowsHide: true,
  });
  if (graphRegression.status !== 0) throw new Error(`Existing real-source graph regression failed: ${(graphRegression.stderr || graphRegression.stdout).slice(-1800)}`);
  console.log(graphRegression.stdout.trim());

  console.log(`PDV_SESSION_QA=PASS; migrations=${migrationCount[0].count}; constraints=event_restrict,one_open_event,session_item_unique,no_point_day_unique; target_sessions=${afterFirstCounts.operational}; source_event_sessions=${afterFirstCounts.eventSource}; turn_items=${await db.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId: { in: [cashSession.id, eventOpenSessionId, eventClosedSessionId] } } })}; stable_maps=${afterFirstCounts.maps}; run_batches=${afterFirstCounts.batches}; event_selected_items=2; close_values=123.45,234.56,345.67,456.78,802.45; overrides=zero,null,16.60; consumer=sessao-cardapio(500=0,1000=15,1500=16.60); reexec=same,new-run; resume=1-confirmed-batch; rollback=atomic; advisory_lock=observed; invalidations=destination,map,checkpoint; blockers=no-date,open-conflict,id-collision,foreign-pdv; finance_rows_unchanged=payment,movement,debt,snapshot; PROD_ACCESS_USED=NO`);
} finally {
  if (db) await db.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
