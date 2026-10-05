import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const qaUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, qaUrl);
assert.ok(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'sanitized DEV photo path required');
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE);
assert.ok(photoPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
assert.ok(path.basename(photoPath).startsWith('tap76-pdv-photo-'));
const photo = JSON.parse(await readFile(photoPath, 'utf8'));
assert.equal(photo.version, 1);
assert.deepEqual(photo.crossTenantEdges, [], 'photo must have complete, tenant-safe FK closure');
assert.deepEqual(photo.targetIdentity.map((row) => row.status), ['UNIQUE_MATCH', 'UNIQUE_MATCH']);

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: qaUrl } } });
const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
const { runPdvCatalogMigration, runPdvKitchenOrderContextPreparation, runPdvSessionMigration, runPdvFinanceMigration, runPdvCommerceMigration } = await import('./pdv-unico-catalog-migrator.ts');
const runId = `tap76-representative-${randomBytes(8).toString('hex')}`;
const tableByName = new Map(photo.tableRows.map((table) => [table.model, table]));
const modelEntries = Object.entries(db._runtimeDataModel.models).map(([name, model]) => [name, model]);
const modelByName = new Map(modelEntries);
const delegate = (name) => db[name[0].toLowerCase() + name.slice(1)];
const canonical = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toFixed === 'function') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const photoKey = (table, row) => table.primaryKey.map((field) => `${field}=${JSON.stringify(canonical(row[field]))}`).join('|');
const targets = photo.targetIdentity.map((row) => ({ label: row.label, id: row.matches[0].id }));
const reports = [];

try {
  const dbIdentity = await db.$queryRaw`SELECT current_database() AS data`;
  const dbName = dbIdentity[0].data;
  assert.equal(dbName, 'cervejaria_qa_pdv_unico');
  const tables = photo.tableRows.map((table) => {
    const target = modelByName.get(table.model);
    assert.ok(target, `target schema missing photo model ${table.model}`);
    const targetScalars = new Set(target.fields.filter((field) => field.kind === 'scalar').map((field) => field.name));
    const rows = table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => targetScalars.has(field))));
    return { ...table, rows, targetFields: targetScalars };
  });

  // Exact row-level dependency ordering. No fixture substitution and no ID rewriting.
  const remaining = new Map(tables.map((table) => [table.model, table]));
  const insertedModels = new Set();
  await db.$transaction(async (tx) => {
    while (remaining.size) {
      const ready = [...remaining.values()].filter((table) => table.parents.every((relation) => {
        const parent = remaining.get(relation.model);
        if (!parent) return true;
        const values = new Set(parent.rows.map((row) => relation.references.map((key) => canonical(row[key])).join('|')));
        return table.rows.every((row) => {
          const from = relation.fields.map((key) => row[key]);
          return from.some((value) => value == null) || values.has(from.map(canonical).join('|')) && insertedModels.has(relation.model);
        });
      }));
      if (!ready.length) throw new Error(`PHOTO_IMPORT_DEPENDENCY_CYCLE: ${[...remaining.keys()].join(',')}`);
      for (const table of ready) {
        const targetDelegate = tx[table.model[0].toLowerCase() + table.model.slice(1)];
        const data = table.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, revive(value)])));
        if (data.length) await targetDelegate.createMany({ data, skipDuplicates: false });
        insertedModels.add(table.model);
        remaining.delete(table.model);
      }
    }

    // The restored destination must equal every captured common scalar value before transforms.
    for (const table of tables) {
      const targetDelegate = tx[table.model[0].toLowerCase() + table.model.slice(1)];
      const rows = await targetDelegate.findMany({ where: { id: { in: table.rows.map((row) => row.id).filter((id) => id != null) } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      assert.equal(rows.length, table.rows.length, `${table.model}: restored row count/IDs`);
      for (const source of table.rows) {
        const key = source.id;
        const actual = byId.get(key);
        assert.ok(actual, `${table.model} missing ID ${key}`);
        for (const [field, value] of Object.entries(source)) assert.deepEqual(canonical(actual[field]), canonical(revive(value)), `${table.model}.${field} ID ${key}`);
      }
    }
  }, { timeout: 300000, maxWait: 30000 });

  for (const target of targets) {
    const source = tableByName.get('Cervejaria').rows.find((row) => row.id === target.id);
    assert.ok(source, `company identity missing: ${target.label}`);
    const pointRows = await db.pontoVenda.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
    const trailerRows = await db.trailer.findMany({ where: { cervejariaId: target.id }, select: { id: true } });
    if (pointRows.length > 1 || (pointRows.length === 0 && trailerRows.length !== 1) || trailerRows.length > 1) {
      reports.push({ tenant: target.label, status: 'BLOCKED', phase: 'business', code: 'CANONICAL_PDV_DECISION_REQUIRED', pdvIds: pointRows.map((row) => row.id), trailerIds: trailerRows.map((row) => row.id) });
      continue;
    }
    const pointId = pointRows[0]?.id ?? trailerRows[0].id;
    const phases = [
      ['business', (options) => runPdvBusinessMigration({ db, companyId: target.id, runId: `${runId}-${target.id}-business`, batchSize: 100, ...options })],
      ['catalog', (options) => runPdvCatalogMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-catalog`, ...options })],
      ['sessions', (options) => runPdvSessionMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-sessions`, ...options })],
      ['finance', (options) => runPdvFinanceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-finance`, ...options })],
      ['kitchen-preparation-before-commerce', (options) => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-prep`, ...options })],
      ['commerce', (options) => runPdvCommerceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-commerce`, ...options })],
      ['kitchen-preparation-revalidation', (options) => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-prep`, ...options })],
    ];
    let blocker;
    for (const [phase, execute] of phases) {
      try {
        let result = await execute({ maxBatches: 1 });
        const interrupted = result.status === 'RUNNING';
        if (interrupted) result = await execute({});
        if (result.status === 'BLOCKED') { blocker = { phase, ...result }; break; }
        if (result.status !== 'COMPLETED') { blocker = { phase, ...result, code: result.code ?? result.status ?? 'MIGRATOR_NOT_COMPLETED' }; break; }
        const replay = await execute({});
        if (replay.status !== 'COMPLETED') { blocker = { phase, ...replay, code: replay.code ?? replay.status ?? 'REPLAY_NOT_COMPLETED' }; break; }
        reports.push({ tenant: target.label, phase, status: 'COMPLETED', interruptedAndResumed: interrupted, sameRunReplay: replay.reusedCompletedRun === true || replay.status === 'COMPLETED', counts: result.counts ?? result.scopeCounts ?? undefined });
      } catch (error) {
        blocker = { phase, status: 'BLOCKED', code: error.code ?? error.name, sourceType: error.sourceType ?? null, sourceId: error.sourceId ?? null, message: error.message };
        break;
      }
    }
    if (blocker) {
      reports.push({ tenant: target.label, ...blocker });
      break;
    }
  }
  console.log(JSON.stringify({ qaDatabase: dbName, sourcePhoto: { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rows.length, 0), crossTenantEdges: photo.crossTenantEdges.length }, anonymizedFields: photo.anonymization, reports }, null, 2));
} catch (error) {
  const safe = { status: 'BLOCKED', phase: 'photo-import', code: error.code ?? error.name, model: error.meta?.modelName ?? null, field: error.meta?.target ?? null, message: error.message };
  console.error(JSON.stringify(safe, null, 2));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    if (value.$photoType === 'date') return new Date(value.value);
    if (value.$photoType === 'bigint') return BigInt(value.value);
    if (value.$photoType === 'bytes') return Buffer.from(value.value, 'base64');
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
  }
  return value;
}
