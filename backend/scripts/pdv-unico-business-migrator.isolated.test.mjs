import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest } from './pdv-unico-qa-migration-manifest.mjs';
import { verifyMigratorQaManifest } from './pdv-unico-migrator-qa-manifest.mjs';
import { createPdvMigrationClient } from './pdv-unico-business-migrate.qa.mjs';
import { runPdvBusinessMigration } from './pdv-unico-business-migrator.ts';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pdv-migrator-qa-'));
const runTag = process.env.PDV_QA_RUN_ID ?? `${process.pid}-${Date.now()}`;
const generatedClientDir = path.join(root, 'node_modules', '.prisma', `pdv-migrator-client-${runTag}`);
const migrationEnv = { ...process.env, DATABASE_URL: databaseUrl };
delete migrationEnv.QA_DATABASE_URL;
delete migrationEnv.PDV_ISOLATED_QA;

function runPrisma(args) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: root, env: migrationEnv, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Prisma failed (${args.join(' ')}): ${result.stderr || result.stdout}`);
}

function unique(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

const historical = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-qa-migration-manifest.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-migrator-qa-manifest.json'), 'utf8'));
await verifyPinnedManifest(historical);
const { schema } = await verifyMigratorQaManifest(manifest);
const bundle = await materializePinnedMigrationBundle(historical, tempRoot);
await writeFile(bundle.schemaPath, schema);

await mkdir(generatedClientDir, { recursive: true });
const generateSchema = path.join(tempRoot, 'schema.prisma');
const schemaText = schema.toString('utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`);
await writeFile(generateSchema, schemaText);
runPrisma(['generate', '--schema', generateSchema]);
const clientUrl = pathToFileURL(path.join(generatedClientDir, 'index.js')).href;
const db = await createPdvMigrationClient(process.env, () => import(clientUrl));

async function companyFixture({ name = unique('migrator'), point = false, trailers = 1, events = [] } = {}) {
  const company = await db.cervejaria.create({ data: { nome: name, slug: unique('migrator-qa') } });
  const points = [];
  for (let index = 0; index < (point ? 1 : 0); index++) points.push(await db.pontoVenda.create({ data: { id: unique('point'), cervejariaId: company.id, nome: `Canonical ${index}`, createdAt: new Date('2025-01-01T10:00:00.000Z'), updatedAt: new Date('2025-01-02T10:00:00.000Z') } }));
  const sourceTrailers = [];
  for (let index = 0; index < trailers; index++) sourceTrailers.push(await db.trailer.create({ data: { id: unique('trailer'), cervejariaId: company.id, nome: `Trailer ${index}`, identificador: `T-${index}`, ativo: index === 0, createdAt: new Date('2025-02-01T10:00:00.000Z'), updatedAt: new Date('2025-02-02T10:00:00.000Z') } }));
  const sourceEvents = [];
  for (const input of events) {
    const row = await db.evento.create({ data: {
      id: unique('event'), cervejariaId: company.id, trailerId: input.foreignTrailerId ?? sourceTrailers[0].id,
      serieId: input.serieId ?? null, nome: input.name ?? 'Synthetic event', local: input.location ?? 'Balcão',
      data: input.date === 'missing' ? null : input.date ? new Date(`${input.date}T00:00:00.000Z`) : null,
      recorrencia: input.recurrence ?? 'NENHUMA', diaSemana: input.weekday ?? null,
      horaInicio: input.start ?? '19:15', horaFim: input.end ?? '23:45', status: input.status ?? 'ABERTO',
      createdAt: new Date('2025-03-01T10:11:12.000Z'), updatedAt: new Date('2025-03-02T11:12:13.000Z'),
    } });
    sourceEvents.push(row);
  }
  return { company, points, trailers: sourceTrailers, events: sourceEvents };
}

function id(prefix) { return `${prefix}_${unique('run').replaceAll('-', '')}`; }
async function counts(companyId) {
  const runs = await db.pdvMigrationRun.findMany({ select: { id: true, checkpoint: true } });
  const runIds = runs.filter((row) => row.checkpoint?.companyId === companyId).map((row) => row.id);
  return {
    points: await db.pontoVenda.count({ where: { cervejariaId: companyId } }),
    agendas: await db.agendaOperacional.count({ where: { cervejariaId: companyId } }),
    occurrences: await db.ocorrenciaOperacional.count({ where: { cervejariaId: companyId } }),
    maps: await db.pdvMigrationMap.count({ where: { cervejariaId: companyId } }),
    batches: runIds.length ? await db.pdvMigrationBatch.count({ where: { runId: { in: runIds } } }) : 0,
  };
}

try {
  const finishedMigrations = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(finishedMigrations[0].count, historical.migrations.length + 1, 'the exact immutable schema migration must already be applied');

  // One existing canonical point stays the destination and is never duplicated.
  const existing = await companyFixture({ name: unique('existing'), point: true, trailers: 1 });
  const existingBefore = await counts(existing.company.id);
  const existingRun = await runPdvBusinessMigration({ db, companyId: existing.company.id, runId: id('existing-run'), batchSize: 4 });
  assert.equal(existingRun.status, 'COMPLETED');
  const existingAfter = await counts(existing.company.id);
  assert.equal(existingAfter.points, existingBefore.points);
  const existingTrailerMap = await db.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'TRAILER', sourceId: existing.trailers[0].id } } });
  assert.equal(existingTrailerMap.destinationId, existing.points[0].id);

  // New Trailer-derived point, weekly agenda, two dated occurrences, and a one-off occurrence.
  const create = await companyFixture({ name: unique('create'), trailers: 1, events: [
    { name: 'Weekly source', recurrence: 'SEMANAL', weekday: 4, start: '18:30', end: '22:00', status: 'ABERTO' },
  ] });
  const agendaSource = create.events[0];
  const occurrenceA = await db.evento.create({ data: { cervejariaId: create.company.id, trailerId: create.trailers[0].id, serieId: agendaSource.id, nome: 'Occurrence A', local: 'Praça', data: new Date('2026-11-05T00:00:00Z'), horaInicio: '18:31', horaFim: '22:01', status: 'ABERTO', createdAt: new Date('2025-04-01T00:00:00Z'), updatedAt: new Date('2025-04-02T00:00:00Z') } });
  const occurrenceB = await db.evento.create({ data: { cervejariaId: create.company.id, trailerId: create.trailers[0].id, serieId: agendaSource.id, nome: 'Occurrence B', local: 'Praça', data: new Date('2026-11-12T00:00:00Z'), horaInicio: '18:32', horaFim: '22:02', status: 'FECHADO', createdAt: new Date('2025-05-01T00:00:00Z'), updatedAt: new Date('2025-05-02T00:00:00Z') } });
  const oneOff = await db.evento.create({ data: { cervejariaId: create.company.id, trailerId: create.trailers[0].id, nome: 'One-off source', local: 'Rua', data: new Date('2026-12-20T00:00:00Z'), horaInicio: '20:00', status: 'FECHADO', createdAt: new Date('2025-06-01T00:00:00Z'), updatedAt: new Date('2025-06-02T00:00:00Z') } });
  const before = await counts(create.company.id);
  const runOne = id('restart-run');
  const paused = await runPdvBusinessMigration({ db, companyId: create.company.id, runId: runOne, batchSize: 10, maxBatches: 2 });
  assert.equal(paused.status, 'RUNNING', 'execution should stop after the requested confirmed batch count');
  const afterPause = await counts(create.company.id);
  assert.equal(afterPause.points, 1);
  assert.equal(afterPause.agendas, 1);
  assert.equal(afterPause.occurrences, 0);
  const pausedCheckpoint = paused.checkpoint;
  assert.equal(pausedCheckpoint.lastConfirmedBatch, 2);
  assert.equal(pausedCheckpoint.completedSourceKeys.length, 2);
  const resumed = await runPdvBusinessMigration({ db, companyId: create.company.id, runId: runOne, batchSize: 10 });
  assert.equal(resumed.status, 'COMPLETED');
  const after = await counts(create.company.id);
  assert.deepEqual({ points: after.points, agendas: after.agendas, occurrences: after.occurrences }, { points: 1, agendas: 1, occurrences: 3 });
  const targetAgenda = await db.agendaOperacional.findUniqueOrThrow({ where: { id: agendaSource.id } });
  assert.deepEqual({ id: targetAgenda.id, pontoVendaId: targetAgenda.pontoVendaId, nome: targetAgenda.nome, diaSemana: targetAgenda.diaSemana, horaInicio: targetAgenda.horaInicio, horaFim: targetAgenda.horaFim, local: targetAgenda.local, ativa: targetAgenda.ativa, createdAt: targetAgenda.createdAt.toISOString(), updatedAt: targetAgenda.updatedAt.toISOString() }, { id: agendaSource.id, pontoVendaId: create.trailers[0].id, nome: 'Weekly source', diaSemana: 4, horaInicio: '18:30', horaFim: '22:00', local: 'Balcão', ativa: true, createdAt: '2025-03-01T10:11:12.000Z', updatedAt: '2025-03-02T11:12:13.000Z' });
  const targetOccurrences = await db.ocorrenciaOperacional.findMany({ where: { cervejariaId: create.company.id }, orderBy: { data: 'asc' } });
  assert.deepEqual(targetOccurrences.map((row) => [row.id, row.data.toISOString().slice(0, 10), row.agendaId, row.status]), [[occurrenceA.id, '2026-11-05', agendaSource.id, 'ABERTA'], [occurrenceB.id, '2026-11-12', agendaSource.id, 'FECHADA'], [oneOff.id, '2026-12-20', null, 'FECHADA']]);
  assert.equal((await db.pontoVenda.findUniqueOrThrow({ where: { id: create.trailers[0].id } })).nome, create.trailers[0].nome);
  assert.equal((await db.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'TRAILER', sourceId: create.trailers[0].id } } })).destinationId, create.trailers[0].id);
  const reexecuted = await runPdvBusinessMigration({ db, companyId: create.company.id, runId: id('new-run'), batchSize: 10 });
  assert.equal(reexecuted.status, 'COMPLETED');
  const afterSecondRun = await counts(create.company.id);
  assert.deepEqual({ points: afterSecondRun.points, agendas: afterSecondRun.agendas, occurrences: afterSecondRun.occurrences }, { points: after.points, agendas: after.agendas, occurrences: after.occurrences });

  // Failure after creating the destination but before map/checkpoint confirmation is atomic.
  const rollbackFixture = await companyFixture({ name: unique('rollback'), trailers: 1 });
  const rollbackRunId = id('rollback-run');
  await assert.rejects(() => runPdvBusinessMigration({ db, companyId: rollbackFixture.company.id, runId: rollbackRunId, batchSize: 1, afterDestinationWrite: () => { throw new Error('QA_INTERRUPTION_AFTER_DESTINATION'); } }), /QA_INTERRUPTION_AFTER_DESTINATION/);
  assert.equal(await db.pontoVenda.count({ where: { cervejariaId: rollbackFixture.company.id } }), 0);
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: rollbackFixture.company.id } }), 0);
  assert.equal(await db.pdvMigrationBatch.count({ where: { runId: rollbackRunId } }), 0);
  const rollbackRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: rollbackRunId } });
  assert.deepEqual((rollbackRun.checkpoint).completedSourceKeys, []);
  assert.equal(rollbackRun.status, 'RUNNING');
  const afterRollbackResume = await runPdvBusinessMigration({ db, companyId: rollbackFixture.company.id, runId: rollbackRunId, batchSize: 1 });
  assert.equal(afterRollbackResume.status, 'COMPLETED');
  assert.equal(await db.pontoVenda.count({ where: { cervejariaId: rollbackFixture.company.id } }), 1);

  // Exact, reason-specific preflight blockers leave the destination untouched.
  const manyTrailers = await companyFixture({ name: unique('many-trailers'), trailers: 2 });
  const multiResult = await runPdvBusinessMigration({ db, companyId: manyTrailers.company.id, runId: id('blocked-many'), batchSize: 2 });
  assert.equal(multiResult.status, 'BLOCKED');
  assert.equal(multiResult.blocker.code, 'MULTIPLE_TRAILERS_REQUIRES_MANUAL_COALESCING');
  assert.equal(await db.pontoVenda.count({ where: { cervejariaId: manyTrailers.company.id } }), 0);

  const noDate = await companyFixture({ name: unique('no-date'), point: true, trailers: 1, events: [{ date: 'missing', name: 'Undated occurrence' }] });
  const missingDateResult = await runPdvBusinessMigration({ db, companyId: noDate.company.id, runId: id('blocked-date'), batchSize: 2 });
  assert.equal(missingDateResult.status, 'BLOCKED');
  assert.equal(missingDateResult.blocker.code, 'EVENT_DATE_MISSING');
  assert.equal(await db.ocorrenciaOperacional.count({ where: { cervejariaId: noDate.company.id } }), 0);

  const multiplePoints = await companyFixture({ name: unique('multi-pdv'), point: true, trailers: 1 });
  await db.pontoVenda.create({ data: { id: unique('second-point'), cervejariaId: multiplePoints.company.id, nome: 'Second canonical candidate' } });
  const multiPdvResult = await runPdvBusinessMigration({ db, companyId: multiplePoints.company.id, runId: id('blocked-pdv'), batchSize: 2 });
  assert.equal(multiPdvResult.status, 'BLOCKED');
  assert.equal(multiPdvResult.blocker.code, 'MULTIPLE_CANONICAL_PDVS');

  const foreignCompany = await db.cervejaria.create({ data: { nome: unique('foreign'), slug: unique('foreign-slug') } });
  const foreignTrailer = await db.trailer.create({ data: { id: unique('foreign-trailer'), cervejariaId: foreignCompany.id, nome: 'Foreign trailer' } });
  const crossTenant = await companyFixture({ name: unique('cross-tenant'), point: true, trailers: 1 });
  await db.evento.create({ data: { cervejariaId: crossTenant.company.id, trailerId: foreignTrailer.id, nome: 'Cross tenant event', local: 'QA', data: new Date('2026-12-01T00:00:00Z') } });
  const crossTenantResult = await runPdvBusinessMigration({ db, companyId: crossTenant.company.id, runId: id('blocked-tenant'), batchSize: 2 });
  assert.equal(crossTenantResult.status, 'BLOCKED');
  assert.ok(['CROSS_TENANT_PARENT', 'MISSING_PARENT'].includes(crossTenantResult.blocker.code));
  assert.equal(await db.ocorrenciaOperacional.count({ where: { cervejariaId: crossTenant.company.id } }), 0);

  // Changed input and changed target content block without overwriting or advancing past that entity.
  const conflict = await companyFixture({ name: unique('conflict'), point: true, trailers: 1, events: [{ recurrence: 'SEMANAL', weekday: 2, name: 'Stable weekly' }] });
  const conflictInitial = await runPdvBusinessMigration({ db, companyId: conflict.company.id, runId: id('conflict-initial'), batchSize: 1 });
  assert.equal(conflictInitial.status, 'COMPLETED');
  const agendaMapKey = { sourceType_sourceId: { sourceType: 'EVENTO', sourceId: conflict.events[0].id } };
  const originalMap = await db.pdvMigrationMap.findUniqueOrThrow({ where: agendaMapKey });
  await db.evento.update({ where: { id: conflict.events[0].id }, data: { nome: 'Changed source payload' } });
  const payloadConflict = await runPdvBusinessMigration({ db, companyId: conflict.company.id, runId: id('payload-conflict'), batchSize: 1 });
  assert.equal(payloadConflict.status, 'BLOCKED');
  assert.equal(payloadConflict.blocker.code, 'SOURCE_PAYLOAD_CHANGED');
  assert.equal((await db.pdvMigrationMap.findUniqueOrThrow({ where: agendaMapKey })).payloadHash, originalMap.payloadHash);
  assert.equal((await db.agendaOperacional.findUniqueOrThrow({ where: { id: conflict.events[0].id } })).nome, 'Stable weekly');
  assert.equal((payloadConflict.checkpoint).lastSourceKey, `TRAILER:${conflict.trailers[0].id}`);
  await db.evento.update({ where: { id: conflict.events[0].id }, data: { nome: 'Stable weekly', updatedAt: conflict.events[0].updatedAt } });
  await db.agendaOperacional.update({ where: { id: conflict.events[0].id }, data: { nome: 'Tampered target agenda' } });
  const targetConflict = await runPdvBusinessMigration({ db, companyId: conflict.company.id, runId: id('target-conflict'), batchSize: 1 });
  assert.equal(targetConflict.status, 'BLOCKED');
  assert.equal(targetConflict.blocker.code, 'MAPPED_DESTINATION_DIVERGED');
  assert.equal((await db.agendaOperacional.findUniqueOrThrow({ where: { id: conflict.events[0].id } })).nome, 'Tampered target agenda');
  assert.equal((targetConflict.checkpoint).lastSourceKey, `TRAILER:${conflict.trailers[0].id}`);
  await db.agendaOperacional.update({ where: { id: conflict.events[0].id }, data: { nome: 'Stable weekly' } });
  const pointMap = await db.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'TRAILER', sourceId: conflict.trailers[0].id } } });
  const targetBeforeTamper = await db.pontoVenda.findUniqueOrThrow({ where: { id: pointMap.destinationId } });
  await db.pontoVenda.update({ where: { id: pointMap.destinationId }, data: { nome: 'Tampered point' } });
  const pointConflict = await runPdvBusinessMigration({ db, companyId: conflict.company.id, runId: id('point-conflict'), batchSize: 1 });
  assert.equal(pointConflict.status, 'BLOCKED');
  assert.equal(pointConflict.blocker.code, 'MAPPED_DESTINATION_DIVERGED');
  assert.equal((await db.pontoVenda.findUniqueOrThrow({ where: { id: pointMap.destinationId } })).nome, 'Tampered point');
  assert.equal((pointConflict.checkpoint).lastSourceKey, null);
  await db.pontoVenda.update({ where: { id: pointMap.destinationId }, data: { nome: targetBeforeTamper.nome } });

  const missingTarget = await companyFixture({ name: unique('missing-target'), point: true, trailers: 1, events: [{ recurrence: 'SEMANAL', weekday: 1, name: 'Missing target agenda' }] });
  const missingInitial = await runPdvBusinessMigration({ db, companyId: missingTarget.company.id, runId: id('missing-initial'), batchSize: 1 });
  assert.equal(missingInitial.status, 'COMPLETED');
  await db.agendaOperacional.delete({ where: { id: missingTarget.events[0].id } });
  const missingResult = await runPdvBusinessMigration({ db, companyId: missingTarget.company.id, runId: id('missing-target'), batchSize: 1 });
  assert.equal(missingResult.status, 'BLOCKED');
  assert.equal(missingResult.blocker.code, 'MAPPED_DESTINATION_MISSING');
  assert.equal(await db.agendaOperacional.count({ where: { id: missingTarget.events[0].id } }), 0, 'missing mapped destination must not be silently recreated');
  assert.equal((missingResult.checkpoint).lastSourceKey, `TRAILER:${missingTarget.trailers[0].id}`);

  // Two independent runs serialize by scope; global source identity prevents double destinations.
  const concurrent = await companyFixture({ name: unique('concurrent'), trailers: 1, events: [{ recurrence: 'SEMANAL', weekday: 3, name: 'Concurrent agenda' }] });
  const concurrentRunIds = [id('concurrent-a'), id('concurrent-b')];
  const concurrentResults = await Promise.all(concurrentRunIds.map((runId) => runPdvBusinessMigration({ db, companyId: concurrent.company.id, runId, batchSize: 2 })));
  assert.ok(concurrentResults.every((result) => result.status === 'COMPLETED'));
  assert.equal(await db.pontoVenda.count({ where: { cervejariaId: concurrent.company.id } }), 1);
  assert.equal(await db.agendaOperacional.count({ where: { cervejariaId: concurrent.company.id } }), 1);
  assert.equal(await db.ocorrenciaOperacional.count({ where: { cervejariaId: concurrent.company.id } }), 0);
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: concurrent.company.id, sourceType: 'TRAILER' } }), 1);
  const concurrentRuns = await db.pdvMigrationRun.findMany({ where: { id: { in: concurrentRunIds } }, orderBy: { id: 'asc' } });
  assert.ok(concurrentRuns.every((row) => row.status === 'COMPLETED' && row.checkpoint.completedSourceKeys.length === 2), JSON.stringify(concurrentRuns.map((row) => ({ status: row.status, checkpoint: row.checkpoint }))));

  const output = {
    baseline: manifest.confirmedBaseline.commit,
    createFixtureCounts: { before, after, afterSecondRun },
    existingPdvCounts: { before: existingBefore, after: existingAfter },
    resumed: { afterPause, completedSourceRecords: resumed.checkpoint.completedSourceKeys.length, batches: resumed.checkpoint.lastConfirmedBatch },
    blockers: ['MULTIPLE_TRAILERS_REQUIRES_MANUAL_COALESCING', 'EVENT_DATE_MISSING', 'MULTIPLE_CANONICAL_PDVS', crossTenantResult.blocker.code, 'SOURCE_PAYLOAD_CHANGED', 'MAPPED_DESTINATION_MISSING', 'MAPPED_DESTINATION_DIVERGED (agenda and PDV)'],
    rollback: { destination: 0, maps: 0, batches: 0, resumed: afterRollbackResume.status },
    concurrentRuns: concurrentResults.map((result) => result.status),
  };
  console.log(`PASS PDV-BUSINESS-MIGRATOR-QA-01 ${JSON.stringify(output)}`);
} finally {
  await db.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
