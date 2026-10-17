import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeProductionCutover, PRODUCTION_PDV_TENANT_ALLOWLIST, validateProductionCutoverContext } from './pdv-unico-production-cutover.mjs';
import { runPdvPrecommercePreparation } from './pdv-unico-precommerce-preparation.mjs';
import { runLiveTransformations } from './pdv-unico-live-transformations.mjs';
import { applyPersistentTenantActivation } from './pdv-unico-dev-activation-config.mjs';
import { assertTenantActivationReady } from './pdv-unico-dev-cutover-core.mjs';
import { scopeCategorySql } from './pdv-unico-dev-cutover-core.mjs';

const sessions = Object.freeze(['cmsxnry380001hvq4mr19uwnr', 'cmuyhu2nm00akhvekroi8onoz', 'cmv575i7c07bmhv74pf6gvbz6']);
const names = PRODUCTION_PDV_TENANT_ALLOWLIST.map(({ id }) => id);
// The approved tenant is keyed by immutable ID. Its retained database name is
// ASCII “CIA Maritima”; keep that exact persisted spelling explicit instead
// of rewriting data or relying on a fuzzy name match.
const expectedTenantNames = new Map([['cmsry9xrn0000hvlgopjxy0oo', 'Churrasquinho do Thiago'], ['cmr9yis3c0000hvu00q9fe7y1', 'CIA Maritima']]);
const runId = process.env.PDV_CUTOVER_RUN_ID;
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
const appRoot = path.resolve(process.env.PDV_CUTOVER_APP_ROOT ?? '');
const backendRoot = path.join(appRoot, 'backend');
const toolsBackendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFile = path.resolve(process.env.PDV_CUTOVER_SCHEMA_FILE ?? path.join(backendRoot, 'prisma/schema.prisma'));
const migrationsRoot = path.resolve(process.env.PDV_CUTOVER_MIGRATIONS_ROOT ?? path.join(backendRoot, 'prisma/migrations'));
const clientRoot = path.resolve(process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const precommerceClientRoot = path.resolve(process.env.PDV_CUTOVER_PRECOMMERCE_PRISMA_CLIENT ?? '');
const receiptRoot = path.resolve(process.env.PDV_CUTOVER_RECEIPTS_DIR ?? '');
const activationFile = path.resolve(process.env.PDV_CUTOVER_ACTIVATION_CONFIG ?? '');
const apiBaseUrl = process.env.PDV_CUTOVER_LOCAL_API_URL;
const apiToken = process.env.PDV_CUTOVER_OPERATOR_TOKEN;
const reason = process.env.PDV_CUTOVER_ADMIN_REASON;

function requiredAbsolute(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path.`);
  return value;
}
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: toolsBackendRoot, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited ${result.status}: ${(result.stderr || result.stdout).slice(-5000)}`);
  return result.stdout;
}
function parseLastJson(text, label) {
  const line = text.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line); } catch { throw new Error(`${label} did not return its JSON receipt.`); }
}
function prismaEnv(context) {
  return { ...process.env, DATABASE_URL: process.env.DATABASE_URL, PDV_CUTOVER_PROFILE: 'production', PDV_CUTOVER_TENANTS: names.join(','), PDV_CUTOVER_RUN_ID: runId,
    PDV_CUTOVER_PRISMA_CLIENT: clientRoot, PDV_CUTOVER_CHECKPOINT_FILE: process.env.PDV_CUTOVER_CHECKPOINT_FILE,
    PDV_CUTOVER_CHECKPOINT_SHA256: context.checkpointSha256 };
}
function centsString(value) {
  if (value == null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error(`Unsupported persisted currency precision: ${String(value)}`);
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return `${match[1] === '-' ? '-' : ''}${amount}`;
}
async function financialFacts(db) {
  const rows = await db.pagamento.findMany({ where: { comanda: { OR: [
    { evento: { cervejariaId: { in: names } } }, { pontoVenda: { cervejariaId: { in: names } } },
  ] } }, orderBy: { id: 'asc' },
    select: { id: true, comandaId: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true,
      forma: true, valor: true, valorRecebido: true, troco: true, registradoPorId: true, pagoEm: true,
      comanda: { select: { origem: true, eventoId: true, total: true, fechadaEm: true,
        evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } } } } } });
  const facts = rows.map((row) => {
    const tenantId = row.comanda.evento?.cervejariaId ?? row.comanda.pontoVenda?.cervejariaId;
    if (!names.includes(tenantId)) throw new Error(`Payment ${row.id} has an ambiguous or out-of-scope tenant edge.`);
    return { id: row.id, tenantId, comandaId: row.comandaId, origin: row.comanda.origem, eventId: row.comanda.eventoId,
      commandTotalCents: centsString(row.comanda.total), commandClosedAt: row.comanda.fechadaEm?.toISOString?.() ?? null,
      form: row.forma, cents: centsString(row.valor), receivedCents: centsString(row.valorRecebido), changeCents: centsString(row.troco),
      paidAt: row.pagoEm.toISOString(), registeredById: row.registradoPorId, receivableId: row.contaReceberId,
      operationalSessionId: row.sessaoCaixaId, eventSessionId: row.sessaoCaixaEventoId };
  });
  const payloadSha256 = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  return { rows: facts.length, payloadSha256, facts };
}
function financialBaselineFile(context) {
  return path.join(receiptRoot, `${runId}.${context.checkpointSha256.slice(0, 16)}.financial-baseline.json`);
}
async function prisma(context) {
  const { PrismaClient } = await import(pathToFileURL(path.join(clientRoot, 'index.js')).href);
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
}

async function runMigrationsThrough(context, through) {
  const all = (await readdir(migrationsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  const ledgerDb = await prisma(context);
  let pending;
  try {
    const ledger = await ledgerDb.$queryRawUnsafe('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name');
    const completed = new Set(ledger.filter((row) => row.finished && !row.rolled_back).map((row) => row.migration_name));
    pending = all.filter((name) => name <= through && !completed.has(name));
    const unknown = ledger.filter((row) => row.finished && !row.rolled_back && !all.includes(row.migration_name));
    if (unknown.length) throw new Error('Database migration ledger contains completed migrations absent from the retained application package.');
  } finally { await ledgerDb.$disconnect(); }
  const stageRoot = path.join(tempRoot, `pdv-cutover-migrations-${runId}`);
  const stagedMigrations = path.join(stageRoot, 'migrations');
  await mkdir(stagedMigrations, { recursive: true });
  for (const name of all.filter((item) => item <= through)) {
    const source = path.join(migrationsRoot, name);
    const destination = path.join(stagedMigrations, name);
    await mkdir(destination, { recursive: true });
    await copyFile(path.join(source, 'migration.sql'), path.join(destination, 'migration.sql'));
  }
  await copyFile(path.join(migrationsRoot, 'migration_lock.toml'), path.join(stagedMigrations, 'migration_lock.toml'));
  const schemaPath = await makeGeneratedSchema(schemaFile, clientRoot, path.join(stageRoot, 'schema.prisma'));
  const cli = path.join(toolsBackendRoot, 'node_modules/prisma/build/index.js');
  const output = run(process.execPath, [cli, 'migrate', 'deploy', '--schema', schemaPath], { ...process.env, DATABASE_URL: process.env.DATABASE_URL, PRISMA_MIGRATIONS_PATH: stagedMigrations });
  return { status: 'PASS', boundary: through, pendingBeforeApply: pending, appliedByDeploy: output.trim().split(/\r?\n/).slice(-24), migrationCount: pending.length };
}

async function makeGeneratedSchema(sourcePath, outputDir, destinationPath) {
  let schema = await readFile(sourcePath, 'utf8');
  const generator = /generator\s+client\s*\{([\s\S]*?)\}/m;
  const match = generator.exec(schema);
  if (!match) throw new Error(`Prisma schema has no client generator: ${sourcePath}`);
  const body = match[1].replace(/^\s*output\s*=\s*"[^"]*"\s*$/m, '').trimEnd();
  schema = schema.replace(generator, `generator client {${body}\n  output = "${outputDir.replaceAll('\\', '/')}"\n}`);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, schema, 'utf8');
  return destinationPath;
}

async function transformCategories(context) {
  const source = await readFile(path.join(appRoot, 'backend/prisma/transformations/pdv-gamified-categories-v1.sql'), 'utf8');
  const sql = scopeCategorySql(source, names);
  const sqlFile = path.join(tempRoot, `pdv-categories-${runId}.sql`);
  await writeFile(sqlFile, sql, { encoding: 'utf8', flag: 'wx' });
  const cli = path.join(toolsBackendRoot, 'node_modules/prisma/build/index.js');
  const schema = await makeGeneratedSchema(schemaFile, clientRoot, path.join(tempRoot, `pdv-target-${runId}.prisma`));
  const output = run(process.execPath, [cli, 'db', 'execute', '--schema', schema, '--file', sqlFile], process.env);
  return { status: 'PASS', scope: names, output: output.trim().split(/\r?\n/).slice(-12) };
}

async function globalPreflight(context) {
  const db = await prisma(context);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tenants = await tx.cervejaria.findMany({ select: { id: true } });
      const constraints = await tx.$queryRawUnsafe("SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace IN ('public'::regnamespace,'quiosque'::regnamespace) ORDER BY conname");
      const ledger = await tx.$queryRawUnsafe('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name');
      const crossTenant = await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM quiosque."MovimentoEstoqueQuiosque" m JOIN quiosque."PedidoQuiosque" p ON p.id=m."pedidoId" WHERE p."cervejariaId" IS DISTINCT FROM m."cervejariaId" OR p."pontoVendaId" IS DISTINCT FROM m."pontoVendaId"');
      const duplicateEventMounts = await tx.$queryRawUnsafe('SELECT "eventoId", "tapId" FROM public."TapMontagem" WHERE "eventoId" IS NOT NULL AND "encerradoEm" IS NULL GROUP BY "eventoId", "tapId" HAVING count(*) > 1');
      const duplicateSessionMounts = await tx.$queryRawUnsafe('SELECT "sessaoCaixaId", "tapId" FROM public."TapMontagem" WHERE "sessaoCaixaId" IS NOT NULL AND "encerradoEm" IS NULL GROUP BY "sessaoCaixaId", "tapId" HAVING count(*) > 1');
      const tapProductDivergence = await tx.$queryRawUnsafe('SELECT t."id" FROM public."Tap" t JOIN public."Produto" p ON p.id=t."produtoId" WHERE t."cervejariaId" IS DISTINCT FROM p."cervejariaId" LIMIT 50');
      const stockParentDivergence = [];
      for (const table of ['EstoqueSaldoQuiosque', 'MovimentoEstoqueQuiosque']) {
        const rows = await tx.$queryRawUnsafe(`SELECT m."id" FROM quiosque."${table}" m JOIN public."Produto" p ON p.id=m."produtoId" JOIN quiosque."PontoVenda" v ON v.id=m."pontoVendaId" WHERE m."cervejariaId" IS DISTINCT FROM p."cervejariaId" OR m."cervejariaId" IS DISTINCT FROM v."cervejariaId" LIMIT 50`);
        stockParentDivergence.push(...rows.map((row) => ({ table, id: row.id })));
      }
      const dirs = (await readdir(migrationsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name);
      const completed = ledger.filter((row) => row.finished && !row.rolled_back);
      const tenantIdentity = [];
      const coverage = [];
      for (const tenant of tenants) {
        const actual = await tx.cervejaria.findUnique({ where: { id: tenant.id }, select: { id: true, nome: true } });
        const points = await tx.pontoVenda.findMany({ where: { cervejariaId: tenant.id }, select: { id: true } });
        const trailers = await tx.trailer.findMany({ where: { cervejariaId: tenant.id }, select: { id: true } });
        const expectedName = expectedTenantNames.get(tenant.id);
        if (expectedName) tenantIdentity.push({ id: tenant.id, expectedName, actualName: actual?.nome ?? null });
        if (expectedName && actual?.nome !== expectedName) throw new Error(`Approved tenant identity differs from the checkpoint source: ${tenant.id}`);
        if (expectedName && (points.length > 1 || trailers.length > 1)) throw new Error(`Selected tenant has ambiguous canonical point/trailer evidence: ${tenant.id}`);
        coverage.push({ tenantId: tenant.id, selected: Boolean(expectedName), pointCount: points.length, trailerCount: trailers.length });
      }
      if (!tenants.length || names.some((id) => !tenants.some((tenant) => tenant.id === id)) || constraints.length
        || ledger.some((row) => !row.finished && !row.rolled_back) || Number(crossTenant[0]?.count ?? 0)
        || duplicateEventMounts.length || duplicateSessionMounts.length || tapProductDivergence.length || stockParentDivergence.length) {
        throw new Error('Global read-only preflight found a constraint, unfinished migration, tenant-edge, duplicate mount, TAP product, or stock-parent divergence.');
      }
      for (const row of completed) {
        if (!dirs.includes(row.migration_name)) throw new Error(`Completed migration is absent from the retained application package: ${row.migration_name}`);
        const sql = await readFile(path.join(migrationsRoot, row.migration_name, 'migration.sql'));
        if (createHash('sha256').update(sql).digest('hex') !== row.checksum) throw new Error(`Completed migration checksum differs from the retained package: ${row.migration_name}`);
      }
      const pending = dirs.filter((name) => !completed.some((row) => row.migration_name === name));
      const finance = await financialFacts(tx);
      const baselineFile = financialBaselineFile(context);
      const baselineBody = { format: 'tap-quiver-cutover-financial-baseline/v1', runId, checkpointId: context.checkpoint.checkpointId,
        checkpointSha256: context.checkpointSha256, tenantIds: names, ...finance };
      const baselineSha = createHash('sha256').update(JSON.stringify(baselineBody)).digest('hex');
      const baseline = { ...baselineBody, sha256: baselineSha };
      try {
        const existing = JSON.parse(await readFile(baselineFile, 'utf8'));
        const { sha256, ...body } = existing;
        if (sha256 !== createHash('sha256').update(JSON.stringify(body)).digest('hex') || sha256 !== baselineSha) throw new Error('Checkpoint-bound financial baseline changed on replay.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      }
      return { status: 'PASS', transaction: 'RepeatableRead READ ONLY', tenantCoverage: tenants.length, coverage, tenantIdentity, selectedTenantIds: names, incompleteConstraints: 0, unfinishedMigrations: 0, crossTenantEdges: 0,
        migrationBaseline: { candidate: dirs.length, completed: completed.length, rolledBackAttempts: ledger.filter((row) => row.rolled_back).length, pending: pending.length, pendingNames: pending },
        financialBaseline: { count: finance.rows, payloadSha256: finance.payloadSha256, checkpointBound: true },
        authorizationCheckpointSha256: context.checkpointSha256, financialSourceValidation: 'PASS: exact approved origin facts validated by production context' };
    }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
  } finally { await db.$disconnect(); }
}

async function commercialPreflight(context) {
  const db = await prisma(context);
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tenants = await tx.cervejaria.findMany({ select: { id: true } });
      const incomplete = await tx.$queryRawUnsafe('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
      const badConstraints = await tx.$queryRawUnsafe("SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace IN ('public'::regnamespace,'quiosque'::regnamespace)");
      const kitchen = await tx.$queryRawUnsafe('SELECT movement."pedidoId" FROM quiosque."MovimentoEstoqueQuiosque" movement JOIN quiosque."PedidoQuiosque" order_row ON order_row."id"=movement."pedidoId" WHERE movement."pedidoId" IS NOT NULL AND (order_row."cervejariaId" IS DISTINCT FROM movement."cervejariaId" OR order_row."pontoVendaId" IS DISTINCT FROM movement."pontoVendaId") LIMIT 50');
      if (incomplete.length || badConstraints.length || kitchen.length) throw new Error('Commercial preflight detected incomplete migrations, constraints, or kitchen tenant/PDV divergence.');
      return { status: 'PASS', coveredTenants: tenants.length, incompleteMigrations: 0, invalidConstraints: 0, kitchenContextDivergence: 0 };
    }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
    return result;
  } finally { await db.$disconnect(); }
}

async function closeAdministrativeSessions() {
  requiredAbsolute(receiptRoot, 'PDV_CUTOVER_RECEIPTS_DIR');
  if (!reason || reason.trim().length < 8) throw new Error('Administrative closures require an explicit reason.');
  const results = [];
  if (process.env.PDV_CUTOVER_PRODUCTION_REHEARSAL === '1') {
    const isolatedDist = path.join(tempRoot, `pdv-a415-api-${runId}`);
    await cp(path.join(appRoot, 'backend/dist'), isolatedDist, { recursive: true, errorOnExist: true });
    const isolatedNodeModules = path.join(isolatedDist, 'node_modules');
    const toolNodeModules = path.join(toolsBackendRoot, 'node_modules');
    await mkdir(isolatedNodeModules, { recursive: true });
    for (const entry of await readdir(toolNodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const source = path.join(toolNodeModules, entry.name);
      const destination = path.join(isolatedNodeModules, entry.name);
      if (entry.name !== '@prisma') {
        await symlink(source, destination, 'junction');
        continue;
      }
      await mkdir(destination, { recursive: true });
      for (const prismaEntry of await readdir(source, { withFileTypes: true })) {
        if (!prismaEntry.isDirectory() && !prismaEntry.isSymbolicLink()) continue;
        const prismaDestination = path.join(destination, prismaEntry.name);
        const prismaSource = prismaEntry.name === 'client' ? clientRoot : path.join(source, prismaEntry.name);
        await symlink(prismaSource, prismaDestination, 'junction');
      }
    }
    process.env.QUIVER_WRITE_FREEZE_FILE = process.env.PDV_CUTOVER_WRITE_FREEZE_FILE;
    process.env.UPLOADS_DIR = path.join(tempRoot, `pdv-a415-uploads-${runId}`);
    const appModule = await import(pathToFileURL(path.join(isolatedDist, 'app.js')).href);
    const dbModule = await import(pathToFileURL(path.join(isolatedDist, 'lib/prisma.js')).href);
    const app = await appModule.buildApp();
    const prismaApi = dbModule.prisma;
    const ownerId = `qa-cutover-owner-${randomBytes(8).toString('hex')}`;
    const passwordChangedAt = new Date();
    try {
      await prismaApi.usuario.create({ data: { id: ownerId, cervejariaId: names[0], nome: 'QA Cutover Owner', email: `${ownerId}@example.invalid`, senhaHash: 'unused', papel: 'DONO', passwordChangedAt } });
      const token = app.jwt.sign({ sub: ownerId, email: `${ownerId}@example.invalid`, nome: 'QA Cutover Owner', papel: 'DONO', cervejariaId: names[0], pwdAt: passwordChangedAt.getTime() });
      for (const id of sessions) {
        const response = await app.inject({ method: 'POST', url: `/api/operacao/caixa/sessoes/${id}/encerramento-administrativo`,
          headers: { authorization: `Bearer ${token}` }, payload: { motivo: reason } });
        const body = response.json();
        if (response.statusCode !== 200 || body.sessaoId !== id) throw new Error(`Administrative closure blocked for approved session ${id}: HTTP ${response.statusCode}.`);
        results.push({ sessionId: id, status: 'PASS', idempotent: body.idempotente === true, api: 'retained a415 Fastify route via inject' });
      }
    } finally {
      await app.close();
      await prismaApi.usuario.deleteMany({ where: { id: ownerId } }).catch(() => {});
      await prismaApi.$disconnect();
    }
  } else {
    if (!apiBaseUrl || !apiToken) throw new Error('Production administrative closures require the local API and a real operator bearer token.');
    const api = new URL(apiBaseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(api.hostname)) throw new Error('Administrative closures are restricted to the local API listener.');
    for (const id of sessions) {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/operacao/caixa/sessoes/${id}/encerramento-administrativo`, {
        method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ motivo: reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.sessaoId !== id) throw new Error(`Administrative closure blocked for approved session ${id}: HTTP ${response.status}.`);
      results.push({ sessionId: id, status: 'PASS', idempotent: body.idempotente === true, api: 'local authenticated HTTP' });
    }
  }
  return { status: 'PASS', sessions: results, financialClosure: false, financialConference: 'PENDING', paymentsChanged: false, movementsGenerated: false };
}

async function reconciliation(context) {
  const db = await prisma(context);
  try {
    const baseline = JSON.parse(await readFile(financialBaselineFile(context), 'utf8'));
    const { sha256: baselineSha, ...baselineBody } = baseline;
    if (baseline.format !== 'tap-quiver-cutover-financial-baseline/v1' || baseline.runId !== runId
      || baseline.checkpointId !== context.checkpoint.checkpointId || baseline.checkpointSha256 !== context.checkpointSha256
      || baselineSha !== createHash('sha256').update(JSON.stringify(baselineBody)).digest('hex')) throw new Error('Checkpoint-bound financial baseline is missing or invalid.');
    const afterFinancial = await financialFacts(db);
    assert.equal(afterFinancial.rows, baseline.rows, 'payment count differs from the frozen checkpoint baseline');
    const expectedFinancialById = new Map(baseline.facts.map((row) => [row.id, row]));
    const actualFinancialById = new Map(afterFinancial.facts.map((row) => [row.id, row]));
    assert.deepEqual([...actualFinancialById.keys()].sort(), [...expectedFinancialById.keys()].sort(), 'payment IDs differ from the frozen checkpoint baseline');
    const approvedSessionMappings = [];
    for (const [id, expected] of expectedFinancialById) {
      const actual = actualFinancialById.get(id);
      const expectedAfter = structuredClone(expected);
      if (expected.operationalSessionId === null && expected.eventSessionId !== null
        && actual.operationalSessionId !== null && actual.eventSessionId === expected.eventSessionId) {
        const mapping = await db.pdvMigrationMap.findFirst({ where: { sourceType: 'SESSAO_CAIXA_EVENTO', sourceId: expected.eventSessionId },
          select: { destinationType: true, destinationId: true, cervejariaId: true, pontoVendaId: true, lastBatchId: true } });
        assert.ok(mapping && mapping.destinationType === 'SESSAO_CAIXA_OPERACAO' && mapping.destinationId === actual.operationalSessionId
          && mapping.cervejariaId === expected.tenantId && mapping.lastBatchId,
        `payment ${id} session conversion lacks its exact confirmed event-session map`);
        const destination = await db.sessaoCaixaOperacao.findUnique({ where: { id: mapping.destinationId },
          select: { id: true, cervejariaId: true, pontoVendaId: true, origemHistorica: true } });
        assert.deepEqual(destination, { id: mapping.destinationId, cervejariaId: expected.tenantId,
          pontoVendaId: mapping.pontoVendaId, origemHistorica: 'EVENTO' }, `payment ${id} session map destination is not canonical`);
        expectedAfter.operationalSessionId = mapping.destinationId;
        approvedSessionMappings.push({ paymentId: id, sourceEventSessionId: expected.eventSessionId, destinationSessionId: mapping.destinationId,
          tenantId: mapping.cervejariaId, pointId: mapping.pontoVendaId });
      }
      assert.deepEqual(actual, expectedAfter, `financial facts or persisted links changed outside exact confirmed session maps for ${id}`);
    }
    const entries = context.approval.entries;
    const ids = entries.map(({ id }) => id).sort();
    const paymentRows = await db.pagamento.findMany({ where: { id: { in: ids } }, select: {
      id: true, comandaId: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true, provenienciaHistorica: true,
      forma: true, valor: true, valorRecebido: true, troco: true, registradoPorId: true, pagoEm: true,
      comanda: { select: { id: true, origem: true, pontoVendaId: true, eventoId: true, total: true, fechadaEm: true,
        evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } } } },
    } });
    if (paymentRows.length !== ids.length) throw new Error('Class-C reconciliation does not contain the exact authorized 579 payment IDs.');
    const actualIds = paymentRows.map(({ id }) => id).sort();
    assert.deepEqual(actualIds, ids, 'class-C persisted ID set differs from the exact approved set');
    const cents = (value) => {
      if (value == null) return null;
      const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
      if (!match) throw new Error(`Unsupported persisted currency precision for payment reconciliation: ${String(value)}`);
      const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
      return `${match[1] === '-' ? '-' : ''}${amount}`;
    };
    const rowsById = new Map(paymentRows.map((row) => [row.id, row]));
    const pointAudit = [];
    const canonicalPoints = new Map();
    for (const expected of entries) {
      const row = rowsById.get(expected.id);
      assert.ok(row, `approved payment ${expected.id} is missing`);
      let expectedPointId = expected.pointId;
      if (names.includes(expected.tenantId)) {
        if (!canonicalPoints.has(expected.tenantId)) {
          const points = await db.pontoVenda.findMany({ where: { cervejariaId: expected.tenantId }, select: { id: true } });
          assert.equal(points.length, 1, `selected tenant ${expected.tenantId} must have one canonical PDV`);
          canonicalPoints.set(expected.tenantId, points[0].id);
        }
        if (expectedPointId !== null) {
          assert.equal(expectedPointId, canonicalPoints.get(expected.tenantId), `approved source point differs from selected canonical point for ${expected.id}`);
          pointAudit.push({ paymentId: expected.id, sourceEventId: expected.eventId, mapDestinationId: null, sourcePointId: expected.pointId, mappedPointId: expectedPointId });
        } else {
          assert.ok(expected.eventId, `payment ${expected.id} has no source point and no exact event map key`);
          const mapping = await db.pdvMigrationMap.findFirst({ where: { sourceType: 'EVENTO', sourceId: expected.eventId },
            select: { destinationType: true, destinationId: true, cervejariaId: true, pontoVendaId: true } });
          assert.ok(mapping, `approved event ${expected.eventId} has no canonical migration map`);
          assert.equal(mapping.destinationType, 'OCORRENCIA_OPERACIONAL');
          assert.equal(mapping.cervejariaId, expected.tenantId);
          assert.equal(mapping.pontoVendaId, canonicalPoints.get(expected.tenantId), `event ${expected.eventId} map does not resolve to its tenant’s canonical PDV`);
          const occurrence = await db.ocorrenciaOperacional.findUnique({ where: { id: mapping.destinationId }, select: { id: true, cervejariaId: true, pontoVendaId: true } });
          assert.deepEqual(occurrence, { id: mapping.destinationId, cervejariaId: expected.tenantId, pontoVendaId: mapping.pontoVendaId }, `event ${expected.eventId} occurrence map destination diverges`);
          expectedPointId = mapping.pontoVendaId;
          pointAudit.push({ paymentId: expected.id, sourceEventId: expected.eventId, mapDestinationId: mapping.destinationId, sourcePointId: null, mappedPointId: expectedPointId });
        }
      } else {
        assert.equal(expected.pointId, null, `out-of-scope payment ${expected.id} must not receive a PDV`);
        pointAudit.push({ paymentId: expected.id, sourceEventId: expected.eventId, mapDestinationId: null, sourcePointId: null, mappedPointId: null });
      }
      const actual = {
        tenantId: row.comanda.evento?.cervejariaId ?? row.comanda.pontoVenda?.cervejariaId,
        id: row.id, commandId: row.comandaId, origin: row.comanda.origem,
        pointId: row.comanda.pontoVendaId, eventId: row.comanda.eventoId,
        commandTotalCents: cents(row.comanda.total), commandClosedAt: row.comanda.fechadaEm?.toISOString?.() ?? null,
        form: row.forma, cents: cents(row.valor), receivedCents: cents(row.valorRecebido), changeCents: cents(row.troco),
        paidAt: row.pagoEm.toISOString(), registeredById: row.registradoPorId, receivableId: row.contaReceberId,
        operationalSessionId: row.sessaoCaixaId, eventSessionId: row.sessaoCaixaEventoId,
      };
      const expectedOutput = Object.fromEntries(['tenantId','id','commandId','origin','eventId','commandTotalCents','commandClosedAt','form','cents','receivedCents','changeCents','paidAt','registeredById','receivableId','operationalSessionId','eventSessionId'].map((key) => [key, expected[key]]));
      expectedOutput.pointId = expectedPointId;
      assert.deepEqual(actual, expectedOutput, `financial facts or exact canonical point-map output changed for ${expected.id}`);
      assert.equal(row.provenienciaHistorica, 'CAIXA_NAO_COMPROVADA', `approved disposition missing for ${expected.id}`);
    }
    const readiness = [];
    for (const tenantId of names) {
      const [points, configs, users, products] = await Promise.all([
        db.pontoVenda.findMany({ where: { cervejariaId: tenantId }, select: { id: true } }),
        db.configuracaoPontoVenda.findMany({ where: { cervejariaId: tenantId } }),
        db.usuario.findMany({ where: { cervejariaId: tenantId }, select: { permissoesOperacao: true } }),
        db.produto.findMany({ where: { cervejariaId: tenantId }, select: { categoria: true, categoriaPdvId: true, categoriaPdv: { select: { cervejariaId: true, gamificada: true } } } }),
      ]);
      const categoryReadiness = products.filter((p) => p.categoria?.trim() && (!p.categoriaPdvId || p.categoriaPdv?.cervejariaId !== tenantId || p.categoriaPdv?.gamificada !== false)).length;
      const ownerGrants = users.reduce((sum, u) => sum + u.permissoesOperacao.filter((p) => ['command.cancel', 'kitchen.cancel', 'sale.refund', 'catalog.manage', 'agenda.manage'].includes(p)).length, 0);
      readiness.push(assertTenantActivationReady({ tenantId, pointIds: points.map(({ id }) => id), configuration: configs.length === 1 ? configs[0] : null,
        permissionReadiness: { status: 'PASS', ownerExclusiveGrantCount: ownerGrants }, categoryReadiness: { status: categoryReadiness ? 'BLOCKED' : 'PASS', unlinkedProducts: categoryReadiness } }));
    }
    const thirdTenantDisposition = reconcileThirdTenantClassC(entries, names, paymentRows);
    return { status: 'PASS', paymentFinancialBaseline: { count: afterFinancial.rows, frozenPayloadSha256: baseline.payloadSha256,
      persistedPayloadSha256: afterFinancial.payloadSha256, matchesFrozenCheckpointExceptExactSessionMaps: true,
      exactEventSessionMaps: { count: approvedSessionMappings.length,
        sha256: createHash('sha256').update(JSON.stringify(approvedSessionMappings)).digest('hex') } },
      classCPayments: { count: paymentRows.length, idsSha256: createHash('sha256').update(JSON.stringify(ids)).digest('hex'), payloadSha256: context.approval.approvedSnapshotSha256, sourceFactsPreserved: true, provenance: 'CAIXA_NAO_COMPROVADA',
        canonicalPointAudit: { count: pointAudit.length, mappedEvents: pointAudit.filter(({ mapDestinationId }) => mapDestinationId !== null).length, sha256: createHash('sha256').update(JSON.stringify(pointAudit)).digest('hex'), includesPointId: true } },
      thirdTenantDispositionOnly: thirdTenantDisposition, readiness };
  } finally { await db.$disconnect(); }
}

export function reconcileThirdTenantClassC(entries, selectedTenantIds, paymentRows) {
  const selected = new Set(selectedTenantIds);
  const thirdTenantEntries = entries.filter(({ tenantId }) => !selected.has(tenantId));
  const thirdTenantIds = new Set(thirdTenantEntries.map(({ id }) => id));
  const thirdTenantRows = paymentRows.filter(({ id }) => thirdTenantIds.has(id));
  assert.equal(thirdTenantRows.length, thirdTenantEntries.length, 'third-tenant class-C source set differs from persisted rows');
  const operationalLinks = thirdTenantRows.filter((row) => row.sessaoCaixaId != null || row.sessaoCaixaEventoId != null);
  assert.equal(operationalLinks.length, 0, 'third-tenant historical disposition must not create operational session links');
  const dispositionPersisted = thirdTenantRows.filter((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA').length;
  assert.equal(dispositionPersisted, thirdTenantEntries.length, 'third-tenant historical disposition is not fully persisted');
  return {
    count: thirdTenantEntries.length,
    idsSha256: createHash('sha256').update(JSON.stringify([...thirdTenantIds].sort())).digest('hex'),
    dispositionPersisted,
    operationalLinksCreated: operationalLinks.length,
    activation: false,
  };
}

export async function executeProductivePdvWorker({ env = process.env } = {}) {
  const context = await validateProductionCutoverContext({ env });
  requiredAbsolute(appRoot, 'PDV_CUTOVER_APP_ROOT'); requiredAbsolute(schemaFile, 'PDV_CUTOVER_SCHEMA_FILE');
  requiredAbsolute(migrationsRoot, 'PDV_CUTOVER_MIGRATIONS_ROOT'); requiredAbsolute(clientRoot, 'PDV_CUTOVER_PRISMA_CLIENT');
  requiredAbsolute(precommerceClientRoot, 'PDV_CUTOVER_PRECOMMERCE_PRISMA_CLIENT');
  if (!clientRoot.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Generated Prisma Client must remain within this run temporary directory.');
  if (!precommerceClientRoot.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Pre-commerce Prisma Client must remain within this run temporary directory.');
  if (!runId || !/^[A-Za-z0-9_-]{8,80}$/.test(runId)) throw new Error('A stable production cutover run ID is required.');
  const expectedApp = env.PDV_CUTOVER_APPLICATION_SHA;
  if (expectedApp !== 'a415a08a4c410c5c0db1ce57be9b19ce763706ad') throw new Error('Retained application SHA differs from the explicitly approved package.');
  const manifestFile = requiredAbsolute(env.PDV_CUTOVER_PACKAGE_MANIFEST_FILE, 'PDV_CUTOVER_PACKAGE_MANIFEST_FILE');
  if (env.PDV_CUTOVER_MANIFEST_SHA256 !== '8e6cfdb410e430ae85e3efdc3857b6df7375f28154d8d500b0545d35a6c73238') throw new Error('External retained package manifest digest is missing or differs from the approved digest.');
  const manifestBytes = await readFile(manifestFile);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== env.PDV_CUTOVER_MANIFEST_SHA256) throw new Error('Retained package manifest does not match the approved external digest.');
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (manifest.releaseSha !== expectedApp || manifest.sourceSnapshot?.commit !== expectedApp) throw new Error('Retained package manifest identifies a different application revision.');
  const inventoryPath = path.resolve(path.dirname(manifestFile), manifest.sourceSnapshot.inventoryPath);
  const inventory = await readFile(inventoryPath);
  if (createHash('sha256').update(inventory).digest('hex') !== manifest.sourceSnapshot.inventorySha256) throw new Error('Retained package source inventory does not match its manifest.');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Retained package manifest has no artifact file inventory.');
  for (const item of manifest.files) {
    if (!item.path || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('Retained package manifest contains an invalid file record.');
    const file = path.resolve(path.dirname(manifestFile), item.path);
    const relative = path.relative(path.dirname(manifestFile), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Retained package manifest contains a path outside its package root.');
    let bytes;
    try { bytes = await readFile(file); } catch { throw new Error(`Retained package artifact is missing: ${item.path}`); }
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Retained package artifact hash differs from its manifest: ${item.path}`);
  }
  const precommerceSchema = requiredAbsolute(env.PDV_CUTOVER_PRECOMMERCE_SCHEMA_FILE, 'PDV_CUTOVER_PRECOMMERCE_SCHEMA_FILE');
  const cli = path.join(toolsBackendRoot, 'node_modules/prisma/build/index.js');
  const targetSchema = await makeGeneratedSchema(schemaFile, clientRoot, path.join(tempRoot, `pdv-target-${runId}.prisma`));
  const precommerceSchemaPath = await makeGeneratedSchema(precommerceSchema, precommerceClientRoot, path.join(tempRoot, `pdv-precommerce-${runId}.prisma`));
  run(process.execPath, [cli, 'generate', '--schema', targetSchema]);
  run(process.execPath, [cli, 'generate', '--schema', precommerceSchemaPath]);
  const contextEnv = { ...env, PDV_CUTOVER_TENANTS: names.join(','), PDV_CUTOVER_RUN_ID: runId,
    PDV_CUTOVER_PRISMA_CLIENT: clientRoot, PDV_CUTOVER_PRECOMMERCE_PRISMA_CLIENT: precommerceClientRoot };
  const operations = {
    'global-preflight': async ({ productionContext }) => globalPreflight(productionContext),
    'minimal-prerequisite-migrations': async ({ productionContext }) => ({ status: 'PASS', ...(await runMigrationsThrough(productionContext, '20261004150000_pdv_finance_session_link')) }),
    'business-catalog-transformations': async () => {
      const result = await runPdvPrecommercePreparation({ env: { ...contextEnv, PDV_CUTOVER_PRISMA_CLIENT: precommerceClientRoot }, args: ['--business-catalog'] });
      return { status: 'PASS', ...result };
    },
    'kitchen-context-preparation': async () => {
      const result = await runPdvPrecommercePreparation({ env: { ...contextEnv, PDV_CUTOVER_PRISMA_CLIENT: precommerceClientRoot }, args: ['--kitchen'] });
      return { status: 'PASS', ...result };
    },
    'dependent-migrations-with-original-preflight': async ({ productionContext }) => {
      const commercial = await commercialPreflight(productionContext);
      const migrations = await runMigrationsThrough(productionContext, '99999999999999');
      return { status: 'PASS', commercialPreflight: commercial, ...migrations };
    },
    'remaining-tenant-transformations-and-replays': async () => {
      const transformed = await runLiveTransformations({ env: contextEnv });
      const categories = await transformCategories(context);
      return { status: 'PASS', transformations: transformed, categories };
    },
    'approved-administrative-session-closure': async () => ({ status: 'PASS', ...(await closeAdministrativeSessions()) }),
    'diagnostics-and-integrated-reconciliation': async ({ productionContext }) => reconciliation(productionContext),
    'per-tenant-activation': async () => {
      requiredAbsolute(activationFile, 'PDV_CUTOVER_ACTIVATION_CONFIG');
      const results = await reconciliation(context);
      if (results.status !== 'PASS') throw new Error('Tenant readiness did not pass.');
      const backup = path.join(receiptRoot, `${runId}.activation-rollback.json`);
      const activation = await applyPersistentTenantActivation({ configPath: activationFile, tenants: names, backupPath: backup, profile: 'production' });
      return { status: 'PASS', readiness: results.readiness, activation, otherTenants: 'LEGACY' };
    },
  };
  const verifyPdvMigratorRuns = async (expectedRuns, productionContext) => {
    if (!Array.isArray(expectedRuns) || expectedRuns.length === 0) return { status: 'BLOCKED', reason: 'phase receipt has no migrator run identities' };
    const ids = expectedRuns.map(({ runId }) => runId);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return { status: 'BLOCKED', reason: 'phase receipt has invalid or duplicate run identities' };
    const db = await prisma(productionContext);
    try {
      const pointsByTenant = new Map();
      for (const tenantId of names) {
        const points = await db.pontoVenda.findMany({ where: { cervejariaId: tenantId }, select: { id: true } });
        if (points.length !== 1) return { status: 'BLOCKED', reason: `tenant ${tenantId} does not have one canonical PDV` };
        pointsByTenant.set(tenantId, points[0].id);
      }
      const runs = await db.pdvMigrationRun.findMany({ where: { id: { in: ids } }, select: {
        id: true, status: true, finishedAt: true, cervejariaId: true, pontoVendaId: true,
      } });
      const byId = new Map(runs.map((row) => [row.id, row]));
      for (const expected of expectedRuns) {
        const run = byId.get(expected.runId);
        if (!run || run.status !== 'COMPLETED' || !run.finishedAt
          || (run.cervejariaId && run.cervejariaId !== expected.tenantId)
          || (run.pontoVendaId && run.pontoVendaId !== pointsByTenant.get(expected.tenantId))) {
          return { status: 'BLOCKED', reason: `durable migrator run ${expected.runId} is missing, incomplete, or out of scope` };
        }
      }
      const batches = await db.pdvMigrationBatch.findMany({ where: { runId: { in: ids } }, select: { runId: true, status: true } });
      if (batches.some(({ status }) => status !== 'CONFIRMED')) return { status: 'BLOCKED', reason: 'a persisted migrator batch is not confirmed' };
      return { status: 'PASS', verifiedRuns: runs.length, confirmedBatches: batches.length,
        runIdsSha256: createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex') };
    } finally { await db.$disconnect(); }
  };
  const verifyCompletedPhase = async (phase, receipt, productionContext) => {
    if (phase === 'global-preflight') {
      const baseline = JSON.parse(await readFile(financialBaselineFile(productionContext), 'utf8'));
      const { sha256: baselineSha, ...baselineBody } = baseline;
      const factsSha256 = createHash('sha256').update(JSON.stringify(baseline.facts)).digest('hex');
      if (baseline.format !== 'tap-quiver-cutover-financial-baseline/v1' || baseline.runId !== runId
        || baseline.checkpointId !== productionContext.checkpoint.checkpointId || baseline.checkpointSha256 !== productionContext.checkpointSha256
        || JSON.stringify(baseline.tenantIds) !== JSON.stringify(names) || baseline.rows !== baseline.facts?.length
        || factsSha256 !== baseline.payloadSha256
        || baselineSha !== createHash('sha256').update(JSON.stringify(baselineBody)).digest('hex')) {
        return { status: 'BLOCKED', reason: 'checkpoint-bound source financial baseline is missing or invalid' };
      }
      // On resume, the live database may already contain authorized mappings
      // and dispositions. Verify the immutable source baseline; later
      // reconciliation compares current facts against it with exact map rules.
      return { status: 'PASS', sourceBaseline: { count: baseline.rows, payloadSha256: baseline.payloadSha256, checkpointBound: true } };
    }
    if (phase === 'minimal-prerequisite-migrations' || phase === 'dependent-migrations-with-original-preflight') {
      const db = await prisma(productionContext);
      try {
        const ledger = await db.$queryRawUnsafe('SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations');
        const folders = (await readdir(migrationsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name);
        const boundary = phase === 'minimal-prerequisite-migrations' ? '20261004150000_pdv_finance_session_link' : '99999999999999';
        const expected = folders.filter((name) => name <= boundary);
        const done = new Set(ledger.filter((row) => row.finished && !row.rolled_back).map((row) => row.migration_name));
        const missing = expected.filter((name) => !done.has(name));
        return missing.length ? { status: 'BLOCKED', missingMigrations: missing } : { status: 'PASS', boundary, completed: expected.length };
      } finally { await db.$disconnect(); }
    }
    if (phase === 'business-catalog-transformations' || phase === 'kitchen-context-preparation') {
      const report = receipt.result?.report;
      const selected = phase === 'business-catalog-transformations' ? ['business', 'catalog'] : ['kitchen-preparation'];
      const expectedRuns = (Array.isArray(report) ? report : []).filter((row) => selected.includes(row.phase))
        .map((row) => ({ tenantId: row.tenantId, runId: row.runId, status: row.status }));
      if (expectedRuns.length !== names.length * selected.length || expectedRuns.some((row) => !names.includes(row.tenantId) || row.status !== 'COMPLETED')) return { status: 'BLOCKED', reason: 'phase receipt does not contain the full selected tenant/run matrix' };
      return verifyPdvMigratorRuns(expectedRuns, productionContext);
    }
    if (phase === 'remaining-tenant-transformations-and-replays') {
      const tenants = receipt.result?.transformations?.tenants;
      if (!Array.isArray(tenants) || tenants.length !== names.length || tenants.some((row) => !names.includes(row.tenantId) || row.status !== 'PASS')) return { status: 'BLOCKED', reason: 'transformation receipt does not contain the exact tenant allowlist' };
      const expectedRuns = tenants.flatMap((tenant) => (tenant.phases ?? []).map((row) => ({ tenantId: tenant.tenantId, runId: row.runId, status: row.status })));
      if (expectedRuns.some((row) => row.status !== 'COMPLETED')) return { status: 'BLOCKED', reason: 'a transformation receipt phase was not completed' };
      return verifyPdvMigratorRuns(expectedRuns, productionContext);
    }
    if (phase === 'approved-administrative-session-closure') {
      const db = await prisma(productionContext);
      try {
        const rows = await db.sessaoCaixaOperacao.findMany({ where: { id: { in: sessions } }, select: {
          id: true, status: true, tipoEncerramento: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true,
          contadoCartaoDebito: true, contadoCartaoCredito: true, contadoCartao: true,
        } });
        if (rows.length !== sessions.length || rows.some((row) => row.status === 'ABERTO' || row.tipoEncerramento !== 'ADMINISTRATIVO'
          || !row.fechadoEm || row.contadoDinheiro !== null || row.contadoPix !== null || row.contadoCartaoDebito !== null
          || row.contadoCartaoCredito !== null || row.contadoCartao !== null)) return { status: 'BLOCKED', reason: 'administrative closure state or unknown counts diverged' };
        return { status: 'PASS', sessions: rows.map(({ id }) => id), conference: 'PENDING', financialValuesChanged: false };
      } finally { await db.$disconnect(); }
    }
    if (phase === 'per-tenant-activation') {
      const contents = await readFile(activationFile, 'utf8');
      const selected = contents.split(/\r?\n/).filter((line) => line.trimStart().startsWith('PDV_CANONICAL_TENANTS='));
      if (selected.length !== 1 || selected[0].split('=').slice(1).join('=').trim() !== names.join(',')) return { status: 'BLOCKED' };
      return { status: 'PASS', verification: 'persistent production allowlist exact' };
    }
    if (phase === 'diagnostics-and-integrated-reconciliation') return reconciliation(productionContext);
    return { status: 'BLOCKED', reason: `no durable verifier is defined for completed phase ${phase}` };
  };
  return executeProductionCutover({ env: contextEnv, operations, verifyCompletedPhase,
    receiptFile: requiredAbsolute(env.PDV_CUTOVER_PHASE_RECEIPTS, 'PDV_CUTOVER_PHASE_RECEIPTS') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await executeProductivePdvWorker();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
