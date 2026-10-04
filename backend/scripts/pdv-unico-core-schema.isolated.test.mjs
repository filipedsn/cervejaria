import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest } from './pdv-unico-qa-migration-manifest.mjs';
import { verifyMigratorQaManifest } from './pdv-unico-migrator-qa-manifest.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const migrationName = '20261003210000_additive_pdv_operational_core';
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pdv-core-schema-qa-'));
const migrationEnv = { ...process.env };
delete migrationEnv.QA_DATABASE_URL;
delete migrationEnv.PDV_ISOLATED_QA;
const generatedClientDir = path.join(root, 'node_modules', '.prisma', `pdv-core-client-${process.env.PDV_QA_RUN_ID ?? process.pid}`);

function runPrisma(args, env = migrationEnv) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Prisma failed (${args.join(' ')}): ${result.stderr || result.stdout}`);
}

function cuidLike(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }

const historicalManifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-qa-migration-manifest.json'), 'utf8'));
const baselineManifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-migrator-qa-manifest.json'), 'utf8'));
const currentManifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-commerce-qa-manifest.json'), 'utf8'));
const digest = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const { manifestSha256, ...currentManifestBody } = currentManifest;
assert.equal(digest(Buffer.from(JSON.stringify(currentManifestBody))), manifestSha256, 'current candidate manifest digest');
const currentCodeHashes = new Map(currentManifest.codeCandidates.map((candidate) => [candidate.path, candidate.sha256]));
for (const candidate of currentManifest.codeCandidates) assert.equal(digest(await readFile(path.join(repoRoot, candidate.path))), candidate.sha256, `explicit current code candidate ${candidate.path}`);
await verifyPinnedManifest(historicalManifest);
const { migration, schema } = await verifyMigratorQaManifest(baselineManifest, currentCodeHashes);
assert.equal(baselineManifest.confirmedBaseline.migration.name, migrationName);

const bundle = await materializePinnedMigrationBundle(historicalManifest, tempRoot);
await writeFile(bundle.schemaPath, schema);
const candidateDir = path.join(bundle.migrationsDir, migrationName);
await mkdir(candidateDir, { recursive: true });
await writeFile(path.join(candidateDir, 'migration.sql'), migration);

const schemaPath = path.join(tempRoot, 'candidate-schema.prisma');
await writeFile(schemaPath, schema);
runPrisma(['validate', '--schema', schemaPath]);
await mkdir(generatedClientDir, { recursive: true });
const generateSchemaPath = path.join(tempRoot, 'generate-candidate.prisma');
await writeFile(generateSchemaPath, schema.toString('utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`));
let generatedClient;
try {
  runPrisma(['generate', '--schema', generateSchemaPath]);
  generatedClient = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  await rm(generatedClientDir, { recursive: true, force: true });
  throw error;
}

const { PrismaClient } = generatedClient;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const migrationRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(migrationRows[0].count, historicalManifest.migrations.length, 'QA must first have the exact historical FK chain applied');

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.cervejaria.create({ data: { nome: `Synthetic core ${suffix}`, slug: `pdv-core-${suffix}` } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `Synthetic foreign core ${suffix}`, slug: `pdv-core-x-${suffix}` } });
  const user = await prisma.usuario.create({ data: { nome: 'Synthetic QA operator', email: `pdv-core-${suffix}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Synthetic canonical point' } });
  const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Synthetic foreign point' } });
  const legacySessionId = cuidLike('legacy_cash');
  await prisma.$executeRaw`INSERT INTO "quiosque"."SessaoCaixaQuiosque" ("id", "cervejariaId", "pontoVendaId", "diaOperacional", "status", "trocoInicial", "abertoPorId") VALUES (${legacySessionId}, ${company.id}, ${point.id}, DATE '2026-10-03', 'ABERTO', 23.47, ${user.id})`;
  const legacyMovement = await prisma.movimentoCaixaOperacao.create({ data: { sessaoId: legacySessionId, tipo: 'SUPRIMENTO', valor: '17.82', registradoPorId: user.id } });
  await prisma.$disconnect();

  runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath]);
  const migrationCount = await (async () => {
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try { return await client.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`; }
    finally { await client.$disconnect(); }
  })();
  assert.equal(migrationCount[0].count, historicalManifest.migrations.length + 1);

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const legacy = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: legacySessionId } });
    assert.deepEqual({ id: legacy.id, cervejariaId: legacy.cervejariaId, pontoVendaId: legacy.pontoVendaId, trocoInicial: legacy.trocoInicial.toFixed(2), status: legacy.status, ocorrenciaId: legacy.ocorrenciaId, origemHistorica: legacy.origemHistorica }, { id: legacySessionId, cervejariaId: company.id, pontoVendaId: point.id, trocoInicial: '23.47', status: 'ABERTO', ocorrenciaId: null, origemHistorica: null });
    const preservedMovement = await db.movimentoCaixaOperacao.findUniqueOrThrow({ where: { id: legacyMovement.id } });
    assert.deepEqual({ id: preservedMovement.id, sessaoId: preservedMovement.sessaoId, tipo: preservedMovement.tipo, valor: preservedMovement.valor.toFixed(2) }, { id: legacyMovement.id, sessaoId: legacySessionId, tipo: 'SUPRIMENTO', valor: '17.82' });

    const agenda = await db.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Synthetic weekly schedule', diaSemana: 6 } });
    const oneOff = await db.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Synthetic one-off', data: new Date('2026-10-10T00:00:00.000Z') } });
    const recurring = await db.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agenda.id, nome: 'Synthetic recurring date', data: new Date('2026-10-17T00:00:00.000Z') } });
    assert.equal(oneOff.agendaId, null);
    assert.equal(recurring.agendaId, agenda.id);

    const foreignAgenda = await db.agendaOperacional.create({ data: { cervejariaId: foreignCompany.id, pontoVendaId: foreignPoint.id, nome: 'Synthetic foreign schedule', diaSemana: 1 } });
    await assert.rejects(() => db.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: foreignPoint.id, nome: 'Invalid cross-tenant schedule', diaSemana: 1 } }));
    await assert.rejects(() => db.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: foreignAgenda.id, nome: 'Invalid agenda link', data: new Date('2026-10-11T00:00:00.000Z') } }));
    await assert.rejects(() => db.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Invalid weekday', diaSemana: 8 } }));
    await assert.rejects(() => db.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agenda.id, nome: 'Duplicate recurring date', data: new Date('2026-10-17T00:00:00.000Z') } }));

    const historySession = await db.sessaoCaixaOperacao.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: new Date('2026-10-17T00:00:00.000Z'), trocoInicial: '4.56', abertoPorId: user.id, ocorrenciaId: recurring.id, origemHistorica: 'EVENTO' } });
    await assert.rejects(() => db.ocorrenciaOperacional.delete({ where: { id: recurring.id } }));
    await assert.rejects(() => db.agendaOperacional.delete({ where: { id: agenda.id } }));
    const preservedSession = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: historySession.id } });
    assert.equal(preservedSession.ocorrenciaId, recurring.id);
    assert.equal(preservedSession.trocoInicial.toFixed(2), '4.56');

    const run1 = await db.pdvMigrationRun.create({ data: { transformVersion: 1, sourceSnapshotHash: `snapshot-${suffix}`, checkpoint: { sourceType: 'EVENTO', sourceId: recurring.id } } });
    const batch1 = await db.pdvMigrationBatch.create({ data: { runId: run1.id, sequence: 1, status: 'CONFIRMED', payloadHash: `batch-${suffix}`, checkpoint: { after: recurring.id }, confirmedAt: new Date() } });
    const sourceId = `source-event-${suffix}`;
    const firstMap = await db.pdvMigrationMap.create({ data: { sourceType: 'EVENTO', sourceId, destinationType: 'OCORRENCIA_OPERACIONAL', destinationId: recurring.id, cervejariaId: company.id, pontoVendaId: point.id, transformVersion: 1, payloadHash: `payload-${suffix}`, lastRunId: run1.id, lastBatchId: batch1.id } });
    const run2 = await db.pdvMigrationRun.create({ data: { transformVersion: 1, sourceSnapshotHash: `snapshot-retry-${suffix}`, checkpoint: { sourceType: 'EVENTO', sourceId } } });
    const batch2 = await db.pdvMigrationBatch.create({ data: { runId: run2.id, sequence: 1, status: 'CONFIRMED', payloadHash: `batch-retry-${suffix}`, checkpoint: { after: sourceId }, confirmedAt: new Date() } });
    const resumedMap = await db.pdvMigrationMap.upsert({ where: { sourceType_sourceId: { sourceType: 'EVENTO', sourceId } }, create: { sourceType: 'EVENTO', sourceId, destinationType: 'OCORRENCIA_OPERACIONAL', destinationId: recurring.id, cervejariaId: company.id, pontoVendaId: point.id, transformVersion: 1, payloadHash: `payload-${suffix}`, lastRunId: run2.id, lastBatchId: batch2.id }, update: { lastRunId: run2.id, lastBatchId: batch2.id } });
    assert.equal(resumedMap.id, firstMap.id);
    assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'EVENTO', sourceId } }), 1);
    assert.equal(resumedMap.destinationId, recurring.id);
    await assert.rejects(() => db.pdvMigrationMap.create({ data: { sourceType: 'EVENTO', sourceId, destinationType: 'OCORRENCIA_OPERACIONAL', destinationId: recurring.id, cervejariaId: company.id, pontoVendaId: point.id, transformVersion: 1, payloadHash: `payload-${suffix}`, lastRunId: run2.id, lastBatchId: batch2.id } }));
    await assert.rejects(() => db.pdvMigrationMap.create({ data: { sourceType: 'EVENTO', sourceId: `mismatched-batch-${suffix}`, destinationType: 'OCORRENCIA_OPERACIONAL', destinationId: recurring.id, cervejariaId: company.id, pontoVendaId: point.id, transformVersion: 1, payloadHash: `payload-${suffix}`, lastRunId: run1.id, lastBatchId: batch2.id } }));

    const rollbackRunId = cuidLike('rollback_run');
    const rollbackBatchId = cuidLike('rollback_batch');
    const rollbackSourceId = cuidLike('rollback_source');
    await assert.rejects(() => db.$transaction(async (tx) => {
      await tx.pdvMigrationRun.create({ data: { id: rollbackRunId, transformVersion: 1, sourceSnapshotHash: `rollback-${suffix}` } });
      await tx.pdvMigrationBatch.create({ data: { id: rollbackBatchId, runId: rollbackRunId, sequence: 1, payloadHash: `rollback-${suffix}`, checkpoint: { cursor: rollbackSourceId }, status: 'CONFIRMED', confirmedAt: new Date() } });
      await tx.pdvMigrationMap.create({ data: { sourceType: 'EVENTO', sourceId: rollbackSourceId, destinationType: 'OCORRENCIA_OPERACIONAL', destinationId: recurring.id, cervejariaId: company.id, pontoVendaId: point.id, transformVersion: 1, payloadHash: `rollback-${suffix}`, lastRunId: rollbackRunId, lastBatchId: rollbackBatchId } });
      throw new Error('ROLLBACK_QA_SENTINEL');
    }));
    assert.equal(await db.pdvMigrationRun.count({ where: { id: rollbackRunId } }), 0);
    assert.equal(await db.pdvMigrationBatch.count({ where: { id: rollbackBatchId } }), 0);
    assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'EVENTO', sourceId: rollbackSourceId } }), 0);

    const constraints = await db.$queryRaw`SELECT conname, contype, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('AgendaOperacional_diaSemana_check', 'AgendaOperacional_pontoVendaId_cervejariaId_fkey', 'OcorrenciaOperacional_agendaId_cervejariaId_pontoVendaId_fkey', 'SessaoCaixaQuiosque_ocorrenciaId_cervejariaId_pontoVendaId_fkey', 'PdvMigrationMap_lastBatchId_lastRunId_fkey') ORDER BY conname`;
    assert.equal(constraints.length, 5);
    assert.ok(constraints.every((constraint) => constraint.convalidated));
    assert.ok(constraints.filter((constraint) => constraint.contype === 'f').every((constraint) => constraint.confdeltype === 'r'));
    console.log(`PASS PDV-CORE-SCHEMA-QA-01: immutable baseline=${baselineManifest.confirmedBaseline.commit}; migration=${baselineManifest.confirmedBaseline.migration.sha256}; schema=${baselineManifest.confirmedBaseline.schema.sha256}; old cash/movement values preserved; one-off/recurring, cross-tenant, duplicate, history RESTRICT, stable source map/batch ownership, and atomic rollback verified.`);
  } finally {
    await db.$disconnect();
  }
} finally {
  await prisma.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
