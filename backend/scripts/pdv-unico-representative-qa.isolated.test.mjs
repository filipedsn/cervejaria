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
    const targetScalars = new Set(target.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum').map((field) => field.name));
    const rows = table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => targetScalars.has(field))));
    return { ...table, rows, targetFields: targetScalars };
  });

  // Exact row-level FK order. Nullable cyclic links are restored after all endpoints exist.
  await db.$transaction(async (tx) => {
    const entries = [];
    for (const table of tables) for (const row of table.rows) {
      const identity = `${table.model}:${photoKey(table, row)}`;
      const entry = { table, row, data: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, revive(value)])), identity, dependencies: new Set(), deferred: [] };
      entries.push(entry);
    }
    const byTargetKey = new Map();
    for (const entry of entries) {
      const table = entry.table;
      const key = table.primaryKey.map((field) => JSON.stringify(canonical(entry.row[field])).replaceAll('|', '\\|')).join('|');
      byTargetKey.set(`${table.model}:${key}`, entry);
    }
    for (const entry of entries) for (const relation of entry.table.parents) {
      const values = relation.fields.map((field) => entry.row[field]);
      if (values.some((value) => value == null)) continue;
      const parentKey = relation.references.map((field, index) => JSON.stringify(canonical(values[index])).replaceAll('|', '\\|')).join('|');
      const parent = byTargetKey.get(`${relation.model}:${parentKey}`);
      if (!parent) throw new Error(`PHOTO_IMPORT_MISSING_PARENT: ${entry.table.model}.${relation.fields.join('+')} -> ${relation.model}; row=${photoKey(entry.table, entry.row)}`);
      entry.dependencies.add({ parent, relation });
    }
    const inserted = new Set();
    const nullableFields = new Map(modelEntries.map(([name, model]) => [name, new Map(model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum').map((field) => [field.name, field.isRequired === false]))]));
    while (inserted.size < entries.length) {
      const ready = entries.filter((entry) => !inserted.has(entry) && [...entry.dependencies].every(({ parent }) => inserted.has(parent)));
      if (ready.length) {
        for (const [modelName, modelEntriesReady] of Map.groupBy(ready, (entry) => entry.table.model)) {
          const delegateName = modelName[0].toLowerCase() + modelName.slice(1);
          try {
            await tx[delegateName].createMany({ data: modelEntriesReady.map((entry) => entry.data), skipDuplicates: false });
          } catch (error) {
            const first = modelEntriesReady[0];
            const wrapped = new Error(`PHOTO_IMPORT_DB_CONSTRAINT: ${modelName} rows=${modelEntriesReady.length}; first=${photoKey(first.table, first.row)}; code=${error.code ?? error.name}; target=${JSON.stringify(error.meta?.target ?? null)}`);
            wrapped.code = 'PHOTO_IMPORT_DB_CONSTRAINT'; wrapped.model = modelName; wrapped.cause = error;
            throw wrapped;
          }
          for (const entry of modelEntriesReady) inserted.add(entry);
        }
        continue;
      }
      const cycleEdge = entries.filter((entry) => !inserted.has(entry)).flatMap((entry) => [...entry.dependencies].filter(({ parent }) => !inserted.has(parent)).map((edge) => ({ entry, ...edge })))[0];
      if (!cycleEdge || !cycleEdge.relation.fields.every((field) => nullableFields.get(cycleEdge.entry.table.model)?.get(field))) {
        throw new Error(`PHOTO_IMPORT_REQUIRED_FK_CYCLE: ${entries.filter((entry) => !inserted.has(entry)).slice(0, 8).map((entry) => entry.identity).join(',')}`);
      }
      for (const field of cycleEdge.relation.fields) cycleEdge.entry.data[field] = null;
      cycleEdge.entry.deferred.push(...cycleEdge.relation.fields.map((field) => [field, revive(cycleEdge.entry.row[field])]));
      cycleEdge.entry.dependencies.delete([...cycleEdge.entry.dependencies].find((edge) => edge.parent === cycleEdge.parent && edge.relation === cycleEdge.relation));
    }
    for (const entry of entries.filter((candidate) => candidate.deferred.length)) {
      const where = Object.fromEntries(entry.table.primaryKey.map((field) => [field, entry.data[field]]));
      await tx[entry.table.model[0].toLowerCase() + entry.table.model.slice(1)].update({ where, data: Object.fromEntries(entry.deferred) });
    }

    // The restored destination must equal every captured common scalar value before transforms.
    for (const table of tables) {
      const targetDelegate = tx[table.model[0].toLowerCase() + table.model.slice(1)];
      const rows = await targetDelegate.findMany();
      const byId = new Map(rows.map((row) => [table.primaryKey.map((field) => `${field}=${JSON.stringify(canonical(row[field])).replaceAll('|', '\\|')}`).join('|'), row]));
      assert.equal(rows.length, table.rows.length, `${table.model}: restored row count/IDs`);
      for (const source of table.rows) {
        const key = table.primaryKey.map((field) => `${field}=${JSON.stringify(canonical(revive(source[field]))).replaceAll('|', '\\|')}`).join('|');
        const actual = byId.get(key);
        assert.ok(actual, `${table.model} missing primary key ${key}`);
        for (const [field, value] of Object.entries(source)) assert.deepEqual(canonical(actual[field]), canonical(revive(value)), `${table.model}.${field} primary key ${key}`);
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
        reports.push({ tenant: target.label, phase, status: 'COMPLETED', interruptedAndResumed: interrupted, sameRunReplay: replay.reusedCompletedRun === true || replay.status === 'COMPLETED', counts: result.counts ?? result.scopeCounts ?? result.checkpoint?.scopeCounts ?? undefined });
      } catch (error) {
        blocker = { phase, status: 'BLOCKED', code: error.code ?? error.name, sourceType: error.sourceType ?? null, sourceId: error.sourceId ?? null, message: error.message };
        break;
      }
    }
    if (blocker) {
      reports.push({ tenant: target.label, ...blocker });
      continue;
    }
  }
  console.log(JSON.stringify({ qaDatabase: dbName, sourcePhoto: { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rows.length, 0), crossTenantEdges: photo.crossTenantEdges.length }, anonymizedFields: photo.anonymization, reports }, null, 2));
} catch (error) {
  const safe = { status: 'BLOCKED', phase: 'photo-import', code: error.code ?? error.name, model: error.model ?? error.meta?.modelName ?? null, field: error.meta?.target ?? null, message: error.code === 'PHOTO_IMPORT_DB_CONSTRAINT' || String(error.message).startsWith('PHOTO_IMPORT_') ? error.message : `${error.code ?? error.name}: database rejected the sanitized snapshot import.` };
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
