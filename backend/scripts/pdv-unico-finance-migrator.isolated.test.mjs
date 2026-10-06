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

// The allowlist is checked before client generation, import or any connection.
const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL differs from the validated QA target.');
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = process.env.PDV_QA_RUN_ID ?? `manual-${process.pid}`;
const suffix = `qa-${runId}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-finance-${runId}-`));
const generatedClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-finance-client-${runId}`);
const graphClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-finance-graph-client-${runId}`);
const normalizedText = (value) => Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'));
const sha256 = (value) => createHash('sha256').update(normalizedText(value)).digest('hex');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-finance-qa-manifest.json'), 'utf8'));
const { manifestSha256, ...manifestBody } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(manifestBody))), manifestSha256, 'finance manifest digest');
const baselineAncestor = spawnSync('git', ['merge-base', '--is-ancestor', manifest.baseline.commit, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(baselineAncestor.status, 0, 'immutable baseline must be an ancestor of the current checkout');
assert.equal(sha256(readPinnedBlob(manifest.baseline.commit, manifest.baseline.schemaPath)), manifest.baseline.schemaSha256, 'immutable baseline schema');
const currentManifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json'), 'utf8'));
const financeSchemaBytes = readPinnedBlob(currentManifest.preCommerceSchema.commit, currentManifest.preCommerceSchema.path);
assert.equal(sha256(financeSchemaBytes), currentManifest.preCommerceSchema.sha256, 'pinned pre-commerce schema');
assert.equal(sha256(financeSchemaBytes), manifest.delivery.schemaSha256, 'finance schema from the immutable pre-commerce baseline');
const stagedSchema = { status: 0, stdout: financeSchemaBytes };
const financeSql = normalizedText(await readFile(path.join(repoRoot, manifest.delivery.migrationPath)));
assert.equal(sha256(financeSql), manifest.delivery.migrationSha256, 'candidate SQL');
const historicalProvenanceSql = normalizedText(await readFile(path.join(repoRoot, manifest.historicalProvenanceMigration.path)));
assert.equal(sha256(historicalProvenanceSql), manifest.historicalProvenanceMigration.sha256, 'historical provenance SQL');
for (const entry of manifest.immutableManifests) assert.equal(sha256(await readFile(path.join(repoRoot, entry.path))), entry.sha256, `immutable manifest ${entry.path}`);
const { manifestSha256: currentManifestSha, ...currentManifestBody } = currentManifest;
assert.equal(sha256(Buffer.from(JSON.stringify(currentManifestBody))), currentManifestSha, 'current commerce manifest digest');
const currentCode = new Map(currentManifest.codeCandidates.map((entry) => [entry.path, entry.sha256]));
for (const entry of manifest.codeCandidates) {
  if (currentCode.has(entry.path)) continue;
  assert.equal(sha256(await readFile(path.join(repoRoot, entry.path))), entry.sha256, `historical finance candidate code ${entry.path}`);
}
for (const [file, digest] of currentCode) assert.equal(sha256(await readFile(path.join(repoRoot, file))), digest, `current candidate code ${file}`);

function runPrisma(args) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
  for (const key of Object.keys(env)) if (/^PROD/i.test(key) || (/_DATABASE_URL$/.test(key) && key !== 'DATABASE_URL')) delete env[key];
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
}
const id = (name) => `${name}-${suffix}`;
const slug = (name) => `${name}-${suffix}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
const plain = (value) => JSON.parse(JSON.stringify(value));
let db;
try {
  const history = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[0].path), 'utf8'));
  await verifyPinnedManifest(history);
  const core = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[1].path), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(repoRoot, manifest.immutableManifests[3].path), 'utf8'));
  const coreSql = readPinnedBlob(core.confirmedBaseline.commit, core.confirmedBaseline.migration.path);
  const catalogSql = normalizedText(await readFile(path.join(repoRoot, catalog.delivery.migrationPath)));
  const sessionSql = normalizedText(await readFile(path.join(repoRoot, manifest.priorSessionMigration.path)));
  assert.equal(sha256(coreSql), core.confirmedBaseline.migration.sha256, 'core baseline SQL');
  assert.equal(sha256(catalogSql), catalog.delivery.migrationSha256, 'catalog candidate SQL');
  assert.equal(sha256(sessionSql), manifest.priorSessionMigration.sha256, 'session baseline SQL');
  const bundle = await materializePinnedMigrationBundle(history, tempRoot);
  for (const [name, bytes] of [
    [core.confirmedBaseline.migration.name, coreSql],
    [catalog.delivery.migrationName, catalogSql],
    [manifest.priorSessionMigration.name, sessionSql],
  ]) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), bytes);
  }
  const candidateText = stagedSchema.stdout.toString('utf8')
    .replace('model Pagamento {', 'enum PaymentHistoricalProvenance {\n  CAIXA_NAO_COMPROVADA\n\n  @@schema("public")\n}\n\nmodel Pagamento {')
    .replace('  sessaoCaixaEventoId String?\n  forma', '  sessaoCaixaEventoId String?\n  provenienciaHistorica PaymentHistoricalProvenance?\n  forma');
  assert.notEqual(candidateText, stagedSchema.stdout.toString('utf8'), 'QA schema carries the candidate historical provenance field');
  await writeFile(bundle.schemaPath, candidateText);
  const validationSchemaPath = path.join(tempRoot, 'finance-schema.prisma');
  await writeFile(validationSchemaPath, candidateText);
  const generateSchemaPath = path.join(tempRoot, 'generate-finance-schema.prisma');
  await writeFile(generateSchemaPath, candidateText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`));
  runPrisma(['validate', '--schema', validationSchemaPath]);
  runPrisma(['generate', '--schema', generateSchemaPath]);
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], {
    cwd: backendRoot, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
  });
  if (deploy.status !== 0) throw new Error(`QA-only migrate deploy failed: ${(deploy.stderr || deploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const { PrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // This fixture deliberately writes a missing session reference, so it runs
  // with the compatible pre-finance client, before either finance migration.
  const graphSchemaPath = path.join(tempRoot, 'generate-graph-schema.prisma');
  await writeFile(graphSchemaPath, financeSchemaBytes.toString('utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${graphClientDir.replaceAll('\\', '/')}"`));
  runPrisma(['generate', '--schema', graphSchemaPath]);
  const graph = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'scripts/pdv-unico-planner.isolated.test.ts'], {
    cwd: backendRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PDV_QA_PRISMA_CLIENT: graphClientDir }, encoding: 'utf8', windowsHide: true,
  });
  if (graph.status !== 0) throw new Error(`Graph regression at its declared 89-migration baseline failed: ${(graph.stderr || graph.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  assert.match(graph.stdout, /PDV-GRAPH-QA-01/);
  const financeMigrationDir = path.join(bundle.migrationsDir, manifest.delivery.migrationName);
  await mkdir(financeMigrationDir, { recursive: true });
  await writeFile(path.join(financeMigrationDir, 'migration.sql'), financeSql);
  const historicalProvenanceMigrationDir = path.join(bundle.migrationsDir, manifest.historicalProvenanceMigration.name);
  await mkdir(historicalProvenanceMigrationDir, { recursive: true });
  await writeFile(path.join(historicalProvenanceMigrationDir, 'migration.sql'), historicalProvenanceSql);
  const financeDeploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], {
    cwd: backendRoot, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
  });
  if (financeDeploy.status !== 0) throw new Error(`QA-only finance migrate deploy failed: ${(financeDeploy.stderr || financeDeploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const count = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(count[0].count, history.migrations.length + 5, 'historical + core + catalog + session + finance + historical provenance migrations');
  const applied = await db.$queryRaw`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = ${manifest.delivery.migrationName} AND finished_at IS NOT NULL`;
  assert.deepEqual(applied.map((row) => row.checksum), [sha256(financeSql)]);
  const appliedProvenance = await db.$queryRaw`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = ${manifest.historicalProvenanceMigration.name} AND finished_at IS NOT NULL`;
  assert.deepEqual(appliedProvenance.map((row) => row.checksum), [sha256(historicalProvenanceSql)]);
  const historicalProvenanceEnum = await db.$queryRaw`SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'PaymentHistoricalProvenance' ORDER BY e.enumsortorder`;
  assert.deepEqual(historicalProvenanceEnum.map((row) => row.enumlabel), ['CAIXA_NAO_COMPROVADA']);
  const historicalProvenanceCheck = await db.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conname = 'Pagamento_provenienciaHistorica_sem_sessao_check'`;
  assert.deepEqual(historicalProvenanceCheck, [{ convalidated: true }], 'the durable C marker forbids session and receivable links');
  const fk = await db.$queryRaw`SELECT confdeltype, convalidated FROM pg_constraint WHERE conname = 'Pagamento_sessaoCaixaId_fkey'`;
  assert.deepEqual(fk, [{ confdeltype: 'r', convalidated: true }], 'common payment session FK is effective and restrictive');
  const movementFks = await db.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('MovimentoCaixaEvento_sessaoId_fkey', 'MovimentoCaixaQuiosque_sessaoId_fkey') ORDER BY conname`;
  assert.deepEqual(movementFks.map((row) => [row.conname, row.confdeltype, row.convalidated]), [
    ['MovimentoCaixaEvento_sessaoId_fkey', 'r', true], ['MovimentoCaixaQuiosque_sessaoId_fkey', 'r', true],
  ]);

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration, runPdvFinanceMigration } = await import('./pdv-unico-catalog-migrator.ts');
  const { reconcilePdvFinance } = await import('./pdv-unico-finance-reconcile.ts');
  const { buildPdvFinanceMigrationItems } = await import('./pdv-unico-finance-transform.ts');
  const historicalApproval = JSON.parse(await readFile(path.join(here, 'pdv-unico-historical-no-session-approval.json'), 'utf8'));
  const centsText = (cents) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;
  const syntheticHistoricalRows = historicalApproval.entries.map((entry) => ({
    id: entry.id, comandaId: entry.commandId, contaReceberId: entry.receivableId,
    sessaoCaixaId: entry.operationalSessionId, sessaoCaixaEventoId: entry.eventSessionId,
    provenienciaHistorica: null, forma: entry.form, valor: centsText(entry.cents),
    valorRecebido: entry.receivedCents == null ? null : centsText(entry.receivedCents),
    troco: entry.changeCents == null ? null : centsText(entry.changeCents),
    registradoPorId: entry.registeredById, pagoEm: new Date(entry.paidAt),
    comanda: {
      id: entry.commandId, origem: entry.origin, eventoId: entry.eventId, pontoVendaId: entry.pointId,
      diaOperacional: null, total: centsText(entry.commandTotalCents), fechadaEm: entry.commandClosedAt ? new Date(entry.commandClosedAt) : null,
      evento: entry.eventId ? { cervejariaId: entry.tenantId } : null,
      pontoVenda: entry.pointId ? { cervejariaId: entry.tenantId } : null,
    },
    contaReceber: null, sessaoCaixaEvento: null, sessaoCaixaOperacao: null,
  }));
  const syntheticFinanceInput = (tenantId, payments = syntheticHistoricalRows, approval = historicalApproval) => {
    const pointId = approval.entries.find((entry) => entry.tenantId === tenantId && entry.pointId)?.pointId ?? `target-${tenantId}`;
    const tenantEvents = Object.fromEntries(approval.entries.filter((entry) => entry.tenantId === tenantId && entry.eventId).map((entry) => [entry.eventId, { id: entry.eventId, companyId: tenantId, pointId }]));
    return { companyId: tenantId, pointId, confirmedPdvSourceKey: 'PDV:historical-qa',
      snapshot: { payments, debts: [], operationalMovements: [], eventMovements: [] }, confirmedSessions: {}, confirmedEvents: tenantEvents,
      mappedPaymentIds: new Set(), historicalNoSessionApproval: approval };
  };
  for (const tenantId of [...new Set(historicalApproval.entries.map((entry) => entry.tenantId))]) {
    const expected = historicalApproval.entries.filter((entry) => entry.tenantId === tenantId);
    const payments = syntheticHistoricalRows.filter((payment) => historicalApproval.entries.find((entry) => entry.id === payment.id)?.tenantId === tenantId);
    const items = buildPdvFinanceMigrationItems(syntheticFinanceInput(tenantId, payments));
    assert.equal(items.length, expected.length, `approved C record set for tenant ${tenantId}`);
    assert.ok(items.every((item) => item.destinationData.sessaoCaixaId === null && item.destinationData.sessaoCaixaEventoId === null
      && item.destinationData.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA'), 'C remains explicitly unproven and has no session');
    assert.equal(items.reduce((sum, item) => sum + BigInt(item.destinationData.valor.replace('.', '')), 0n), expected.reduce((sum, entry) => sum + BigInt(entry.cents), 0n), 'C exact cents conserved');
    const byForm = new Map();
    for (const item of items) byForm.set(item.destinationData.forma, (byForm.get(item.destinationData.forma) ?? 0n) + BigInt(item.destinationData.valor.replace('.', '')));
    const expectedByForm = new Map();
    for (const entry of expected) expectedByForm.set(entry.form, (expectedByForm.get(entry.form) ?? 0n) + BigInt(entry.cents));
    assert.deepEqual([...byForm].map(([form, amount]) => [form, amount.toString()]).sort(([a], [b]) => a.localeCompare(b)),
      [...expectedByForm].map(([form, amount]) => [form, amount.toString()]).sort(([a], [b]) => a.localeCompare(b)),
      'C cent totals reconcile by tenant and payment form');
  }
  const cTenant = historicalApproval.entries.find((entry) => entry.origin === 'EVENTO').tenantId;
  const baseRows = syntheticHistoricalRows.filter((payment) => historicalApproval.entries.find((entry) => entry.id === payment.id)?.tenantId === cTenant);
  const changedRow = structuredClone(baseRows); changedRow[0].valor = centsText(BigInt(historicalApproval.entries.find((entry) => entry.id === changedRow[0].id).cents) + 1n);
  assert.throws(() => buildPdvFinanceMigrationItems(syntheticFinanceInput(cTenant, changedRow)), (error) => error.code === 'FINANCE_HISTORICAL_APPROVAL_PAYLOAD_DIVERGED', 'changed approved payload is blocked');
  const migratedCommandRows = structuredClone(baseRows);
  const migratedEntry = historicalApproval.entries.find((entry) => entry.id === migratedCommandRows[0].id);
  const migratedCommand = migratedCommandRows[0].comanda;
  migratedCommand.pontoVendaId = `target-${cTenant}`;
  assert.throws(() => buildPdvFinanceMigrationItems(syntheticFinanceInput(cTenant, migratedCommandRows)), (error) => error.code === 'FINANCE_HISTORICAL_APPROVAL_PAYLOAD_DIVERGED', 'a manually linked command without commercial receipt proof stays blocked');
  const migratedInput = syntheticFinanceInput(cTenant, migratedCommandRows);
  migratedInput.confirmedHistoricalCommerceCommands = {
    [migratedEntry.commandId]: { commandId: migratedEntry.commandId, companyId: cTenant, pointId: migratedInput.pointId, eventId: migratedEntry.eventId, originalPointId: null, originalOccurrenceId: null, runId: 'confirmed-commerce-run', batchId: 'confirmed-commerce-batch', payloadHash: 'verified-map-payload', destinationHash: 'verified-destination' },
  };
  const replayedAfterCommerce = buildPdvFinanceMigrationItems(migratedInput);
  assert.equal(replayedAfterCommerce[0].destinationData.sessaoCaixaId, null, 'finance replay after verified commercial migration creates no session');
  const changedAfterCommerce = structuredClone(migratedCommandRows);
  changedAfterCommerce[0].troco = '0.01';
  assert.throws(() => buildPdvFinanceMigrationItems({ ...migratedInput, snapshot: { ...migratedInput.snapshot, payments: changedAfterCommerce } }), (error) => error.code === 'FINANCE_HISTORICAL_APPROVAL_PAYLOAD_DIVERGED', 'commerce proof does not relax the approved financial fields');
  const unauthorizedRow = structuredClone(baseRows[0]); unauthorizedRow.id = 'new-immediate-without-session'; unauthorizedRow.comandaId = 'new-immediate-command'; unauthorizedRow.comanda.id = 'new-immediate-command';
  assert.throws(() => buildPdvFinanceMigrationItems(syntheticFinanceInput(cTenant, [...baseRows, unauthorizedRow])), (error) => error.code === 'FINANCE_PAYMENT_SESSION_MISSING', 'record outside the approved set is blocked');
  const foreignRow = structuredClone(baseRows[0]); foreignRow.comanda.evento.cervejariaId = 'foreign-tenant';
  assert.throws(() => buildPdvFinanceMigrationItems(syntheticFinanceInput(cTenant, [...baseRows.slice(1), foreignRow])), (error) => error.code === 'FINANCE_COMMAND_EVENT_MISMATCH', 'tenant-incompatible evidence is blocked');

  async function fixture(name) {
    const company = await db.cervejaria.create({ data: { nome: `QA ${name}`, slug: slug(name) } });
    const trailer = await db.trailer.create({ data: { id: id(`${name}-trailer`), cervejariaId: company.id, nome: 'QA trailer', identificador: `${name}-T` } });
    await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: 2 } });
    await db.configuracaoOperacional.create({ data: { cervejariaId: company.id, directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true, kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true, whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: false } });
    const event = await db.evento.create({ data: { id: id(`${name}-event`), cervejariaId: company.id, trailerId: trailer.id, nome: 'QA event', local: 'QA place', data: new Date('2026-11-02T00:00:00.000Z'), horaInicio: '18:00', horaFim: '23:00', status: 'FECHADO', recorrencia: 'NENHUMA' } });
    assert.equal((await runPdvBusinessMigration({ db, companyId: company.id, runId: id(`${name}-business`), batchSize: 20 })).status, 'COMPLETED');
    const point = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: company.id } });
    const product = await db.produto.create({ data: { id: id(`${name}-product`), cervejariaId: company.id, nome: 'QA catalog and stock product', controlaEstoque: true } });
    assert.equal((await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: id(`${name}-catalog`) })).status, 'COMPLETED');
    const owner = await db.usuario.create({ data: { nome: 'QA owner', email: `${slug(name)}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
    const customer = await db.cliente.create({ data: { id: id(`${name}-customer`), cervejariaId: company.id, nome: 'QA customer' } });
    const eventSession = await db.sessaoCaixaEvento.create({ data: { id: id(`${name}-event-session`), eventoId: event.id, status: 'FECHADO', trocoInicial: '10.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-02T18:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-02T23:00:00.000Z'), contadoDinheiro: '42.00', contadoPix: '35.00', contadoDebito: '5.00', contadoCredito: '0.00', contadoCartao: null } });
    const cashSession = await db.sessaoCaixaOperacao.create({ data: { id: id(`${name}-cash-session`), cervejariaId: company.id, pontoVendaId: point.id, trailerId: trailer.id, diaOperacional: new Date('2026-11-03T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '25.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-03T10:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-03T22:00:00.000Z'), contadoDinheiro: '25.00', contadoPix: '0.00', contadoCartaoDebito: '0.00', contadoCartaoCredito: '47.00' } });
    assert.equal((await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id(`${name}-sessions`) })).status, 'COMPLETED');
    return { company, point, product, event, eventSession, cashSession, owner, customer };
  }

  const main = await fixture('finance-main');
  async function command(name, { event = true, total, customer = false } = {}) {
    return db.comanda.create({ data: {
      id: id(name), origem: event ? 'EVENTO' : 'CAIXA', eventoId: event ? main.event.id : null,
      pontoVendaId: event ? null : main.point.id, diaOperacional: event ? null : new Date('2026-11-03T00:00:00.000Z'),
      clienteId: customer ? main.customer.id : null, status: 'FECHADA', tipo: 'COMANDA', total,
      fechadaEm: new Date('2026-11-02T22:00:00.000Z'), fechadoPorId: main.owner.id,
    } });
  }
  const paidCommand = await command('paid-sale', { total: '30.00' });
  const closedDebtCommand = await command('closed-debt-sale', { total: '50.00', customer: true });
  const openDebtCommand = await command('open-debt-sale', { total: '23.00', customer: true });
  const cashCommand = await command('cash-sale', { event: false, total: '12.00' });
  const stockProduct = main.product;
  const stockBalance = await db.inventoryBalance.create({ data: { id: id('stock-balance'), cervejariaId: main.company.id, pontoVendaId: main.point.id, produtoId: stockProduct.id, quantidade: '12.375', estoqueMinimo: '1.250' } });
  const stockMovement = await db.inventoryMovement.create({ data: { id: id('stock-movement'), cervejariaId: main.company.id, pontoVendaId: main.point.id, produtoId: stockProduct.id, tipo: 'ENTRADA', quantidade: '1.250', registradoPorId: main.owner.id, observacao: 'untouched stock' } });
  const snapshotItem = await db.itemComanda.create({ data: { id: id('snapshot'), comandaId: paidCommand.id, produtoId: stockProduct.id, volumeMl: 0, quantidade: 1, precoUnit: '30.00', nome: 'Historical sale snapshot', observacao: 'unchanged' } });
  const closedDebt = await db.contaReceber.create({ data: { id: id('closed-debt'), comandaId: closedDebtCommand.id, clienteId: main.customer.id, valorOriginal: '50.00', criadoPorId: main.owner.id, createdAt: new Date('2026-11-02T21:00:00.000Z') } });
  const openDebt = await db.contaReceber.create({ data: { id: id('open-debt'), comandaId: openDebtCommand.id, clienteId: main.customer.id, valorOriginal: '23.00', criadoPorId: main.owner.id, createdAt: new Date('2026-11-02T21:01:00.000Z') } });
  const paymentRows = [
    { name: 'cash-change', comandaId: paidCommand.id, sessaoCaixaEventoId: main.eventSession.id, forma: 'DINHEIRO', valor: '10.00', valorRecebido: '20.00', troco: '10.00' },
    { name: 'split-pix', comandaId: paidCommand.id, sessaoCaixaEventoId: main.eventSession.id, forma: 'PIX', valor: '20.00', valorRecebido: null, troco: null },
    { name: 'debt-partial', comandaId: closedDebtCommand.id, contaReceberId: closedDebt.id, sessaoCaixaEventoId: main.eventSession.id, forma: 'PIX', valor: '15.00', valorRecebido: '0.00', troco: null },
    { name: 'debt-later', comandaId: closedDebtCommand.id, contaReceberId: closedDebt.id, sessaoCaixaId: main.cashSession.id, forma: 'CARTAO_CREDITO', valor: '35.00', valorRecebido: null, troco: null },
    { name: 'debt-open', comandaId: openDebtCommand.id, contaReceberId: openDebt.id, sessaoCaixaEventoId: main.eventSession.id, forma: 'CARTAO_DEBITO', valor: '5.00', valorRecebido: null, troco: null },
    { name: 'cash-credit', comandaId: cashCommand.id, sessaoCaixaId: main.cashSession.id, forma: 'CARTAO_CREDITO', valor: '12.00', valorRecebido: null, troco: null },
  ];
  for (const row of paymentRows) await db.pagamento.create({ data: { id: id(row.name), comandaId: row.comandaId, contaReceberId: row.contaReceberId ?? null,
    sessaoCaixaId: row.sessaoCaixaId ?? null, sessaoCaixaEventoId: row.sessaoCaixaEventoId ?? null,
    forma: row.forma, valor: row.valor, valorRecebido: row.valorRecebido, troco: row.troco,
    registradoPorId: main.owner.id, pagoEm: new Date('2026-11-03T12:34:56.000Z') } });
  const eventSupply = await db.movimentoCaixaEvento.create({ data: { id: id('event-supply'), sessaoId: main.eventSession.id, tipo: 'SUPRIMENTO', valor: '5.25', observacao: 'source supply', registradoPorId: main.owner.id, createdAt: new Date('2026-11-02T20:00:00.000Z') } });
  const eventWithdrawal = await db.movimentoCaixaEvento.create({ data: { id: id('event-withdrawal'), sessaoId: main.eventSession.id, tipo: 'SANGRIA', valor: '1.10', observacao: null, registradoPorId: main.owner.id, createdAt: new Date('2026-11-02T21:00:00.000Z') } });
  const originalMovement = await db.movimentoCaixaOperacao.create({ data: { id: id('cash-movement'), sessaoId: main.cashSession.id, tipo: 'SUPRIMENTO', valor: '4.00', observacao: 'original', registradoPorId: main.owner.id, createdAt: new Date('2026-11-03T14:00:00.000Z'), corrigidoEm: new Date('2026-11-03T15:00:00.000Z'), motivoCorrecao: 'QA correction', autorizadoPorId: main.owner.id, solicitadoPorId: main.owner.id } });
  await db.movimentoCaixaOperacao.create({ data: { id: id('cash-estorno'), sessaoId: main.cashSession.id, tipo: 'SANGRIA', valor: '4.00', observacao: 'reversal', registradoPorId: main.owner.id, correcaoDeId: originalMovement.id, naturezaCorrecao: 'ESTORNO', motivoCorrecao: 'QA correction', autorizadoPorId: main.owner.id, solicitadoPorId: main.owner.id, createdAt: new Date('2026-11-03T15:00:00.000Z') } });
  await db.movimentoCaixaOperacao.create({ data: { id: id('cash-replacement'), sessaoId: main.cashSession.id, tipo: 'SUPRIMENTO', valor: '3.50', observacao: 'replacement', registradoPorId: main.owner.id, correcaoDeId: originalMovement.id, naturezaCorrecao: 'SUBSTITUICAO', motivoCorrecao: 'QA correction', autorizadoPorId: main.owner.id, solicitadoPorId: main.owner.id, createdAt: new Date('2026-11-03T15:01:00.000Z') } });
  const before = plain({
    commands: await db.comanda.findMany({ where: { id: { in: [paidCommand.id, closedDebtCommand.id, openDebtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }),
    payments: await db.pagamento.findMany({ where: { id: { in: paymentRows.map((row) => id(row.name)) } }, orderBy: { id: 'asc' } }),
    debts: await db.contaReceber.findMany({ where: { id: { in: [closedDebt.id, openDebt.id] } }, orderBy: { id: 'asc' } }),
    eventMovements: await db.movimentoCaixaEvento.findMany({ where: { id: { in: [eventSupply.id, eventWithdrawal.id] } }, orderBy: { id: 'asc' } }),
    cashMovements: await db.movimentoCaixaOperacao.findMany({ where: { sessaoId: main.cashSession.id }, orderBy: { id: 'asc' } }),
    item: await db.itemComanda.findUniqueOrThrow({ where: { id: snapshotItem.id } }),
    stockBalance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } }),
    stockMovement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: stockMovement.id } }),
  });
  const financeRunId = id('finance-main-run');
  const result = await runPdvFinanceMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: financeRunId });
  assert.equal(result.status, 'COMPLETED', `finance migration: ${JSON.stringify(result)}`);
  const after = plain({
    commands: await db.comanda.findMany({ where: { id: { in: [paidCommand.id, closedDebtCommand.id, openDebtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }),
    payments: await db.pagamento.findMany({ where: { id: { in: paymentRows.map((row) => id(row.name)) } }, orderBy: { id: 'asc' } }),
    debts: await db.contaReceber.findMany({ where: { id: { in: [closedDebt.id, openDebt.id] } }, orderBy: { id: 'asc' } }),
    eventMovements: await db.movimentoCaixaEvento.findMany({ where: { id: { in: [eventSupply.id, eventWithdrawal.id] } }, orderBy: { id: 'asc' } }),
    cashMovements: await db.movimentoCaixaOperacao.findMany({ where: { sessaoId: main.cashSession.id }, orderBy: { id: 'asc' } }),
    item: await db.itemComanda.findUniqueOrThrow({ where: { id: snapshotItem.id } }),
    stockBalance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: stockBalance.id } }),
    stockMovement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: stockMovement.id } }),
  });
  assert.deepEqual(after.debts, before.debts, 'debt rows retain principal, client, command, author and timestamp');
  assert.deepEqual(after.commands, before.commands, 'sale totals, origins and command identity stay intact');
  assert.equal(after.commands.reduce((sum, row) => {
    const [whole, fraction = ''] = row.total.split('.');
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }, 0n), 11500n, 'sold total is separate from payments and debt principal');
  assert.deepEqual(after.eventMovements, before.eventMovements, 'legacy event movement rows stay intact');
  assert.deepEqual(after.cashMovements, before.cashMovements, 'cash correction chain stays intact');
  assert.deepEqual(after.item, before.item, 'sale snapshot stays intact');
  assert.deepEqual(after.stockBalance, before.stockBalance, 'nonempty stock balance and minimum remain unchanged');
  assert.deepEqual(after.stockMovement, before.stockMovement, 'stock ledger row and exact quantity remain unchanged');
  assert.deepEqual(after.payments.map((row) => ({ ...row, sessaoCaixaId: null })), before.payments.map((row) => ({ ...row, sessaoCaixaId: null })), 'every original payment scalar is unchanged except the additive event target link');
  assert.equal(after.payments.find((row) => row.id === id('debt-partial')).valorRecebido, '0', 'explicit zero remains distinct from null');
  assert.equal(after.payments.find((row) => row.id === id('split-pix')).valorRecebido, null);
  for (const row of after.payments) assert.equal(row.sessaoCaixaId, row.sessaoCaixaEventoId ? main.eventSession.id : main.cashSession.id, 'receipt session is mapped independently of sale session');
  const transferred = await db.movimentoCaixaOperacao.findMany({ where: { id: { in: [eventSupply.id, eventWithdrawal.id] } }, orderBy: { id: 'asc' } });
  assert.deepEqual(transferred.map((row) => ({ id: row.id, session: row.sessaoId, type: row.tipo, cents: row.valor.toFixed(2), createdAt: row.createdAt.toISOString() })), [eventSupply, eventWithdrawal].sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({ id: row.id, session: main.eventSession.id, type: row.tipo, cents: row.valor.toFixed(2), createdAt: row.createdAt.toISOString() })));
  assert.equal(await db.movimentoCaixaOperacao.count({ where: { sessaoId: main.cashSession.id } }), 3);
  assert.equal(await db.movimentoCaixaEvento.count({ where: { sessaoId: main.eventSession.id } }), 2);
  await assert.rejects(db.sessaoCaixaEvento.delete({ where: { id: main.eventSession.id } }), (error) => error.code === 'P2003', 'legacy financial movement prevents source session deletion');
  await assert.rejects(db.sessaoCaixaOperacao.delete({ where: { id: main.cashSession.id } }), (error) => error.code === 'P2003', 'common movement/payment prevents target session deletion');
  const { readPdvFinanceSourceSnapshot } = await import('./pdv-unico-finance-source.ts');
  const expectedItems = await db.$transaction(async (tx) => {
    const snapshot = await readPdvFinanceSourceSnapshot(tx, main.company.id);
    return snapshot;
  });
  assert.equal(expectedItems.payments.length, 6);
  assert.equal(expectedItems.debts.length, 2);
  assert.equal(expectedItems.eventMovements.length, 2);
  assert.equal(expectedItems.operationalMovements.length, 3);
  const afterCounts = {
    payments: await db.pagamento.count({ where: { id: { in: paymentRows.map((row) => id(row.name)) } } }),
    debts: await db.contaReceber.count({ where: { id: { in: [closedDebt.id, openDebt.id] } } }),
    movements: await db.movimentoCaixaOperacao.count({ where: { id: { in: [eventSupply.id, eventWithdrawal.id, id('cash-movement'), id('cash-estorno'), id('cash-replacement')] } } }),
    maps: await db.pdvMigrationMap.count({ where: { cervejariaId: main.company.id, sourceType: { in: ['PAGAMENTO', 'CONTA_RECEBER', 'MOVIMENTO_CAIXA_EVENTO', 'MOVIMENTO_CAIXA_OPERACAO'] } } }),
  };
  assert.deepEqual(afterCounts, { payments: 6, debts: 2, movements: 5, maps: 13 });
  assert.equal((await runPdvFinanceMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: financeRunId })).status, 'COMPLETED', 'same run revalidates all receipts and balances');
  assert.equal((await runPdvFinanceMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: id('finance-main-new-run') })).status, 'COMPLETED', 'new run reuses stable maps and destinations');
  assert.equal(await db.movimentoCaixaOperacao.count({ where: { id: { in: [eventSupply.id, eventWithdrawal.id] } } }), 2, 'new run does not duplicate movements');

  const reconciliationItems = [
    ...after.payments.map((row) => ({ type: 'PAGAMENTO', id: row.id, destinationData: row })),
    ...after.debts.map((row) => ({ type: 'CONTA_RECEBER', id: row.id, destinationData: row })),
    ...after.cashMovements.map((row) => ({ type: 'MOVIMENTO_CAIXA_OPERACAO', id: row.id, destinationData: row })),
    ...plain(transferred).map((row) => ({ type: 'MOVIMENTO_CAIXA_EVENTO', id: row.id, destinationData: row })),
  ];
  const reconciled = await reconcilePdvFinance(db, reconciliationItems);
  assert.deepEqual(reconciled.byForm, [['CARTAO_CREDITO', '4700'], ['CARTAO_DEBITO', '500'], ['DINHEIRO', '1000'], ['PIX', '3500']]);
  assert.deepEqual(reconciled.bySession, [[main.cashSession.id, '4700'], [main.eventSession.id, '5000']].sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(reconciled.debts.map((row) => [row.principalCentavos, row.recebidoCentavos, row.saldoCentavos]).sort((a, b) => a[0].localeCompare(b[0])), [['2300', '500', '1800'], ['5000', '5000', '0']]);
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.pagamento.update({ where: { id: id('split-pix') }, data: { valor: '20.01' } });
    await reconcilePdvFinance(tx, reconciliationItems);
  }), (error) => error.code === 'FINANCE_RECONCILIATION_DIVERGED', 'one cent of deliberate drift must block reconciliation');
  assert.equal((await db.pagamento.findUniqueOrThrow({ where: { id: id('split-pix') } })).valor.toFixed(2), '20.00', 'deliberate drift rolled back');
  assert.deepEqual(plain(await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: main.eventSession.id } })).contadoCartao, null, 'closure count is not split into payment methods');

  // A second tenant and independent fixtures prove exact typed blockers.
  const foreign = await fixture('finance-foreign');
  const dual = await fixture('finance-dual');
  const dualCommand = await db.comanda.create({ data: { id: id('dual-command'), origem: 'EVENTO', eventoId: dual.event.id, status: 'FECHADA', total: '1.00' } });
  const dualPayment = await db.pagamento.create({ data: { id: id('dual-payment'), comandaId: dualCommand.id, sessaoCaixaEventoId: dual.eventSession.id, sessaoCaixaId: dual.cashSession.id, forma: 'PIX', valor: '1.00' } });
  const dualResult = await runPdvFinanceMigration({ db, companyId: dual.company.id, pointId: dual.point.id, runId: id('dual-run') });
  assert.deepEqual([dualResult.status, dualResult.code], ['BLOCKED', 'FINANCE_PAYMENT_DOUBLE_SESSION']);
  assert.equal((await db.pagamento.findUniqueOrThrow({ where: { id: dualPayment.id } })).sessaoCaixaId, dual.cashSession.id);
  const missing = await fixture('finance-missing');
  const missingCommand = await db.comanda.create({ data: { id: id('missing-command'), origem: 'EVENTO', eventoId: missing.event.id, status: 'FECHADA', total: '2.00' } });
  await db.pagamento.create({ data: { id: id('missing-payment'), comandaId: missingCommand.id, forma: 'PIX', valor: '2.00' } });
  const missingResult = await runPdvFinanceMigration({ db, companyId: missing.company.id, pointId: missing.point.id, runId: id('missing-run') });
  assert.deepEqual([missingResult.status, missingResult.code], ['BLOCKED', 'FINANCE_PAYMENT_SESSION_MISSING']);
  const wrong = await fixture('finance-wrong-tenant');
  const wrongCommand = await db.comanda.create({ data: { id: id('wrong-command'), origem: 'EVENTO', eventoId: wrong.event.id, clienteId: foreign.customer.id, status: 'FECHADA', total: '3.00' } });
  await db.contaReceber.create({ data: { id: id('wrong-debt'), comandaId: wrongCommand.id, clienteId: foreign.customer.id, valorOriginal: '3.00', criadoPorId: wrong.owner.id } });
  const wrongResult = await runPdvFinanceMigration({ db, companyId: wrong.company.id, pointId: wrong.point.id, runId: id('wrong-run') });
  assert.deepEqual([wrongResult.status, wrongResult.code], ['BLOCKED', 'FINANCE_DEBT_CLIENT_MISMATCH']);

  const retry = await fixture('finance-retry');
  const retryCommand = await db.comanda.create({ data: { id: id('retry-command'), origem: 'EVENTO', eventoId: retry.event.id, status: 'FECHADA', total: '7.00' } });
  const retryPayment = await db.pagamento.create({ data: { id: id('retry-payment'), comandaId: retryCommand.id, sessaoCaixaEventoId: retry.eventSession.id, forma: 'PIX', valor: '7.00' } });
  const retryMovement = await db.movimentoCaixaEvento.create({ data: { id: id('retry-movement'), sessaoId: retry.eventSession.id, tipo: 'SANGRIA', valor: '2.00', registradoPorId: retry.owner.id } });
  const retryRunId = id('retry-run');
  const paused = await runPdvFinanceMigration({ db, companyId: retry.company.id, pointId: retry.point.id, runId: retryRunId, maxBatches: 1 });
  assert.equal(paused.status, 'RUNNING');
  assert.equal(paused.checkpoint.completedSourceKeys.length, 1);
  await assert.rejects(runPdvFinanceMigration({ db, companyId: retry.company.id, pointId: retry.point.id, runId: retryRunId, afterDestinationWrite: (item) => {
    if (item.type === 'MOVIMENTO_CAIXA_EVENTO') throw new Error('QA_ROLLBACK_AFTER_DESTINATION');
  } }), /QA_ROLLBACK_AFTER_DESTINATION/);
  assert.equal(await db.movimentoCaixaOperacao.count({ where: { id: retryMovement.id } }), 0, 'movement destination rolled back');
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'MOVIMENTO_CAIXA_EVENTO', sourceId: retryMovement.id } }), 0, 'map rolled back');
  assert.equal((await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: retryRunId } })).checkpoint.completedSourceKeys.length, 1, 'checkpoint retains last confirmed batch');
  assert.equal((await runPdvFinanceMigration({ db, companyId: retry.company.id, pointId: retry.point.id, runId: retryRunId })).status, 'COMPLETED');
  assert.equal((await db.pagamento.findUniqueOrThrow({ where: { id: retryPayment.id } })).sessaoCaixaId, retry.eventSession.id);

  // Both callers use the same run. The second is observed waiting on the advisory lock.
  const concurrent = await fixture('finance-concurrent');
  const concurrentCommand = await db.comanda.create({ data: { id: id('concurrent-command'), origem: 'EVENTO', eventoId: concurrent.event.id, status: 'FECHADA', total: '9.00' } });
  await db.pagamento.create({ data: { id: id('concurrent-payment'), comandaId: concurrentCommand.id, sessaoCaixaEventoId: concurrent.eventSession.id, forma: 'DINHEIRO', valor: '9.00', valorRecebido: '10.00', troco: '1.00' } });
  const concurrentRunId = id('concurrent-run');
  let releaseFirst;
  let arrivedFirst;
  const firstArrived = new Promise((resolve) => { arrivedFirst = resolve; });
  const barrier = new Promise((resolve) => { releaseFirst = resolve; });
  const first = runPdvFinanceMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: concurrentRunId, afterDestinationWrite: async () => { arrivedFirst(); await barrier; } });
  await firstArrived;
  const second = runPdvFinanceMigration({ db, companyId: concurrent.company.id, pointId: concurrent.point.id, runId: concurrentRunId });
  let waiting = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const sessions = await db.$queryRaw`SELECT wait_event_type, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
    if (sessions.length > 0) { waiting = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  releaseFirst();
  assert.equal(waiting, true, 'second caller reached and waited at the advisory lock');
  assert.deepEqual((await Promise.all([first, second])).map((row) => row.status), ['COMPLETED', 'COMPLETED']);
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'PAGAMENTO', sourceId: id('concurrent-payment') } }), 1);
  assert.equal(await db.pdvMigrationBatch.count({ where: { runId: concurrentRunId } }), 1);

  // Completed certificates are invalidated without changing the last checkpoint.
  const priorRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: financeRunId } });
  await db.pagamento.update({ where: { id: id('split-pix') }, data: { sessaoCaixaId: null } });
  const invalidated = await runPdvFinanceMigration({ db, companyId: main.company.id, pointId: main.point.id, runId: financeRunId });
  assert.equal(invalidated.status, 'BLOCKED');
  assert.equal(invalidated.code, 'MAPPED_DESTINATION_DIVERGED');
  const invalidatedRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: financeRunId } });
  assert.equal(invalidatedRun.status, 'BLOCKED');
  assert.deepEqual(invalidatedRun.checkpoint, priorRun.checkpoint, 'certification invalidation retains confirmed checkpoint');
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'PAGAMENTO', sourceId: id('split-pix') } }), 1, 'invalidation never repairs the map');
  const retryPrior = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: retryRunId } });
  await db.pagamento.update({ where: { id: retryPayment.id }, data: { valor: '7.01' } });
  const changedPayload = await runPdvFinanceMigration({ db, companyId: retry.company.id, pointId: retry.point.id, runId: retryRunId });
  assert.deepEqual([changedPayload.status, changedPayload.code], ['BLOCKED', 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH']);
  const retryInvalidated = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: retryRunId } });
  assert.equal(retryInvalidated.status, 'BLOCKED');
  assert.deepEqual(retryInvalidated.checkpoint, retryPrior.checkpoint);
  const mapGone = await fixture('finance-map-gone');
  const mapCommand = await db.comanda.create({ data: { id: id('map-gone-command'), origem: 'CAIXA', pontoVendaId: mapGone.point.id, status: 'FECHADA', total: '2.00' } });
  const mapPayment = await db.pagamento.create({ data: { id: id('map-gone-payment'), comandaId: mapCommand.id, sessaoCaixaId: mapGone.cashSession.id, forma: 'PIX', valor: '2.00' } });
  const mapRunId = id('map-gone-run');
  assert.equal((await runPdvFinanceMigration({ db, companyId: mapGone.company.id, pointId: mapGone.point.id, runId: mapRunId })).status, 'COMPLETED');
  const mapPrior = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: mapRunId } });
  await db.pdvMigrationMap.delete({ where: { sourceType_sourceId: { sourceType: 'PAGAMENTO', sourceId: mapPayment.id } } });
  const missingMap = await runPdvFinanceMigration({ db, companyId: mapGone.company.id, pointId: mapGone.point.id, runId: mapRunId });
  assert.deepEqual([missingMap.status, missingMap.code], ['BLOCKED', 'CHECKPOINT_MAP_MISSING']);
  const mapInvalidated = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: mapRunId } });
  assert.equal(mapInvalidated.status, 'BLOCKED');
  assert.deepEqual(mapInvalidated.checkpoint, mapPrior.checkpoint);

  console.log('PDV_FINANCE_QA=PASS; migrations=90; payments=6; debts=2; target_movements=5; source_event_movements=2; maps=13; by_form=DINHEIRO:1000,PIX:3500,CARTAO_DEBITO:500,CARTAO_CREDITO:4700; debts=5000:5000:0,2300:500:1800; rollback=atomic; concurrency=advisory_lock_observed; reconciliation_drift=blocked; graph=current_bundle_pass; PROD_ACCESS_USED=NO');
} finally {
  await db?.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
