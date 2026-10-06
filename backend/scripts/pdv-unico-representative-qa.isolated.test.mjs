import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const qaUrl = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, qaUrl);
assert.ok(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'sanitized DEV photo path required');
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE);
assert.ok(photoPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
assert.ok(path.basename(photoPath).startsWith('tap76-pdv-photo-'));
const photo = JSON.parse(await readFile(photoPath, 'utf8'));
const approval = JSON.parse(await readFile(new URL('./pdv-unico-historical-no-session-approval.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await readFile(new URL('../../docs/testing/pdv-unico-representative-dev-qa-evidence.json', import.meta.url), 'utf8'));
assert.equal(approval.sourcePhotoSha256, createHash('sha256').update(await readFile(photoPath)).digest('hex'), 'historical C authorization must match this exact sanitized photo');
assert.equal(approval.approvedSnapshotSha256, createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex'), 'historical C authorization digest');
assert.deepEqual(approval.counts, { payments: 577, withExactPaymentAuditReference: 323, withoutExactPaymentAuditReference: 254 });
assert.equal(photo.version, 1);
assert.deepEqual(photo.crossTenantEdges, [], 'photo must have complete, tenant-safe FK closure');
assert.deepEqual(photo.targetIdentity.map((row) => row.status), ['UNIQUE_MATCH', 'UNIQUE_MATCH']);

assert.ok(process.env.PDV_QA_PRISMA_CLIENT, 'QA Prisma client must be generated in the executor-owned temp directory');
const prismaClientPath = path.resolve(process.env.PDV_QA_PRISMA_CLIENT);
assert.ok(prismaClientPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
const { PrismaClient } = await import(pathToFileURL(path.join(prismaClientPath, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: qaUrl } }, log: [{ emit: 'event', level: 'query' }] });
const metricRows = new Map();
let activeMetric = null;
db.$on('query', () => { if (activeMetric) activeMetric.queries++; });
async function measured(stage, operation) {
  const row = metricRows.get(stage) ?? { stage, calls: 0, durationMs: 0, maxDurationMs: 0, queries: 0 };
  metricRows.set(stage, row);
  const previousMetric = activeMetric;
  const started = performance.now();
  activeMetric = row;
  try { return await operation(); }
  finally {
    const durationMs = performance.now() - started;
    row.calls++;
    row.durationMs = Math.round((row.durationMs + durationMs) * 100) / 100;
    row.maxDurationMs = Math.max(row.maxDurationMs, Math.round(durationMs * 100) / 100);
    activeMetric = previousMetric;
  }
}
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
const decimalCents = (value) => {
  const [whole, fraction = ''] = String(value).split('.');
  return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
};
async function reconcileRepresentativeFinance(target) {
  const tenantCases = evidence.paymentSessionReview.allPaymentCases.filter((row) => row.tenantId === target.id);
  const paymentIds = tenantCases.map((row) => row.paymentId);
  const photoPayments = new Map(tableByName.get('Pagamento').rows.filter((row) => paymentIds.includes(row.id)).map((row) => [row.id, revive(row)]));
  const actual = await db.pagamento.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } });
  assert.deepEqual(actual.map((row) => row.id).sort(), [...paymentIds].sort(), `${target.label}: exact payment ID set`);
  const actualById = new Map(actual.map((row) => [row.id, row]));
  const totals = (rows, key) => [...rows.reduce((map, row) => {
    map.set(row.forma, (map.get(row.forma) ?? 0n) + BigInt(key(row)));
    return map;
  }, new Map())];
  const expectedByForm = [...paymentIds.reduce((map, paymentId) => {
    const row = photoPayments.get(paymentId);
    map.set(row.forma, (map.get(row.forma) ?? 0n) + BigInt(decimalCents(row.valor)));
    return map;
  }, new Map())].map(([form, cents]) => [form, cents.toString()]).sort(([a], [b]) => a.localeCompare(b));
  const actualByForm = totals(actual, (row) => decimalCents(row.valor)).map(([form, cents]) => [form, cents.toString()]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(actualByForm, expectedByForm, `${target.label}: exact cents by payment form`);
  for (const row of tenantCases) {
    const source = photoPayments.get(row.paymentId);
    const saved = actualById.get(row.paymentId);
    assert.equal(saved.comandaId, source.comandaId);
    assert.equal(saved.contaReceberId, source.contaReceberId);
    assert.equal(saved.forma, source.forma);
    assert.equal(decimalCents(saved.valor), decimalCents(source.valor));
    assert.equal(saved.valorRecebido == null ? null : decimalCents(saved.valorRecebido), source.valorRecebido == null ? null : decimalCents(source.valorRecebido));
    assert.equal(saved.troco == null ? null : decimalCents(saved.troco), source.troco == null ? null : decimalCents(source.troco));
    assert.equal(saved.registradoPorId, source.registradoPorId);
    assert.equal(saved.pagoEm.toISOString(), source.pagoEm.toISOString());
    if (row.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT') {
      assert.equal(saved.sessaoCaixaId, null);
      assert.equal(saved.sessaoCaixaEventoId, null);
      assert.equal(saved.provenienciaHistorica, 'CAIXA_NAO_COMPROVADA');
    } else if (row.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE') {
      assert.equal(saved.sessaoCaixaId, null);
      assert.equal(saved.sessaoCaixaEventoId, null);
      assert.equal(saved.provenienciaHistorica, null);
    } else {
      assert.equal(saved.sessaoCaixaId, source.sessaoCaixaId ?? source.sessaoCaixaEventoId);
      assert.equal(saved.sessaoCaixaEventoId, source.sessaoCaixaEventoId);
      assert.equal(saved.provenienciaHistorica, null);
    }
  }
  const unassigned = actual.filter((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA');
  const sessionLinked = actual.filter((row) => row.sessaoCaixaId !== null);
  const debtWithoutSession = actual.filter((row) => row.contaReceberId !== null && row.sessaoCaixaId === null);
  const expectedC = tenantCases.filter((row) => row.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT');
  const expectedA = tenantCases.filter((row) => row.classification === 'A_EXACT_SESSION_REFERENCE');
  const expectedB = tenantCases.filter((row) => row.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE');
  assert.equal(unassigned.length, expectedC.length);
  assert.equal(unassigned.reduce((sum, row) => sum + BigInt(decimalCents(row.valor)), 0n), expectedC.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  if (unassigned.length) {
    const existingSession = await db.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: target.id }, select: { id: true } });
    await assert.rejects(
      db.pagamento.update({ where: { id: unassigned[0].id }, data: { sessaoCaixaId: existingSession.id } }),
      (error) => error.code === 'P2004' || /Pagamento_provenienciaHistorica_sem_sessao_check/.test(error.message),
      'the durable C disposition forbids later session attribution',
    );
    assert.equal((await db.pagamento.findUniqueOrThrow({ where: { id: unassigned[0].id } })).sessaoCaixaId, null, 'blocked attribution leaves the payment unchanged');
  }
  assert.equal(sessionLinked.length, expectedA.length);
  assert.equal(sessionLinked.reduce((sum, row) => sum + BigInt(decimalCents(row.valor)), 0n), expectedA.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  assert.equal(debtWithoutSession.length, expectedB.length);
  assert.equal(debtWithoutSession.reduce((sum, row) => sum + BigInt(decimalCents(row.valor)), 0n), expectedB.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  assert.equal(new Set(actual.map((row) => row.id)).size, actual.length, 'no payment appears twice');
  assert.equal(actual.reduce((sum, row) => sum + BigInt(decimalCents(row.valor)), 0n), tenantCases.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  const expectedCustomerHistoryIds = expectedC.filter((row) => photoPayments.get(row.paymentId).comandaId
    && tableByName.get('Comanda').rows.find((command) => command.id === row.commandId)?.clienteId).map((row) => row.paymentId).sort();
  const customerHistoryRows = await db.comanda.findMany({
    where: { clienteId: { not: null }, pagamentos: { some: { id: { in: expectedC.map((row) => row.paymentId) } } } },
    select: { pagamentos: { where: { id: { in: expectedC.map((row) => row.paymentId) } }, select: { id: true, valor: true } } },
  });
  const customerHistoryPayments = customerHistoryRows.flatMap((command) => command.pagamentos);
  assert.deepEqual(customerHistoryPayments.map((row) => row.id).sort(), expectedCustomerHistoryIds, 'customer history retains each linked C payment once');
  assert.equal(customerHistoryPayments.reduce((sum, row) => sum + BigInt(decimalCents(row.valor)), 0n), expectedC
    .filter((row) => expectedCustomerHistoryIds.includes(row.paymentId)).reduce((sum, row) => sum + BigInt(row.cents), 0n));
  const accounts = await db.contaReceber.findMany({ where: { comanda: { OR: [{ pontoVenda: { cervejariaId: target.id } }, { evento: { cervejariaId: target.id } }] } }, include: { pagamentos: true } });
  for (const row of tenantCases.filter((item) => item.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE')) {
    const sourceCase = row;
    const account = accounts.find((item) => item.id === sourceCase.receivableId);
    assert.ok(account, 'historical debt receipt remains on its original receivable');
    const receiptIds = account.pagamentos.map((item) => item.id).sort();
    const expectedReceiptIds = tenantCases.filter((item) => item.receivableId === account.id).map((item) => item.paymentId).sort();
    assert.deepEqual(receiptIds, expectedReceiptIds, 'receivable payments remain once on the original account');
    const principal = BigInt(decimalCents(account.valorOriginal));
    const receipts = account.pagamentos.reduce((sum, item) => sum + BigInt(decimalCents(item.valor)), 0n);
    const balance = principal - receipts;
    assert.equal(principal, receipts + balance, 'debt principal equals receipts plus balance');
    assert.equal(principal, BigInt(sourceCase.receivable.originalCents));
    assert.equal(receipts, BigInt(sourceCase.receivable.originalCents));
    assert.equal(balance, 0n);
  }
  const tenantEventIds = new Set(tableByName.get('Evento').rows.filter((row) => row.cervejariaId === target.id).map((row) => row.id));
  const photoSessions = tableByName.get('SessaoCaixaEvento').rows.filter((row) => tenantEventIds.has(row.eventoId)).length
    + tableByName.get('SessaoCaixaOperacao').rows.filter((row) => row.cervejariaId === target.id).length;
  assert.equal(await db.sessaoCaixaOperacao.count({ where: { cervejariaId: target.id } }), photoSessions, 'finance phase does not create or infer a cash session');
}

async function proveCommerceLinkRequiresDurableProof(target, pointId) {
  const approved = evidence.paymentSessionReview.allPaymentCases.find((row) => row.tenantId === target.id
    && row.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT');
  assert.ok(approved, `${target.label}: approved historical command is available for commerce proof guards`);
  const commandId = approved.commandId;
  const originalCommand = await db.comanda.findUniqueOrThrow({ where: { id: commandId } });
  const originalMap = await db.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: commandId } } });
  const originalBatch = await db.pdvMigrationBatch.findUniqueOrThrow({ where: { id: originalMap.lastBatchId } });
  const originalCheckpoint = structuredClone(originalBatch.checkpoint);
  const proofResults = [];
  const runProof = async (name) => {
    const result = await runPdvFinanceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-finance-proof-${name}`, historicalNoSessionApproval: approval, maxBatches: 1 });
    assert.equal(result.status, 'BLOCKED', `${target.label}: ${name} commerce proof mutation is blocked`);
    assert.ok(result.code, `${target.label}: ${name} blocker has an evidence code`);
    proofResults.push({ case: name, status: result.status, code: result.code });
  };
  const restoreMap = async () => {
    await db.pdvMigrationMap.deleteMany({ where: { sourceType: 'COMANDA', sourceId: commandId } });
    await db.pdvMigrationMap.create({ data: originalMap });
  };
  const alternatePoint = await db.pontoVenda.create({ data: { id: `finance-proof-alternate-point-${target.id}`, cervejariaId: target.id, nome: 'Temporary QA proof guard' } });
  try {
    await db.pdvMigrationMap.delete({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: commandId } } });
    await runProof('commerce-map-missing');
    await restoreMap();

    await db.pdvMigrationMap.update({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: commandId } }, data: { pontoVendaId: alternatePoint.id } });
    await runProof('commerce-map-manually-altered');
    await db.pdvMigrationMap.update({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: commandId } }, data: { pontoVendaId: pointId } });

    const originalReceipts = originalCheckpoint.receipts;
    await db.pdvMigrationBatch.update({ where: { id: originalBatch.id }, data: { checkpoint: { ...originalCheckpoint, receipts: originalReceipts.filter((row) => !(row.sourceType === 'COMANDA' && row.sourceId === commandId)) } } });
    await runProof('commerce-receipt-missing');
    await db.pdvMigrationBatch.update({ where: { id: originalBatch.id }, data: { checkpoint: originalCheckpoint } });

    await db.pdvMigrationBatch.update({ where: { id: originalBatch.id }, data: { checkpoint: { ...originalCheckpoint, receipts: originalReceipts.map((row) => row.sourceType === 'COMANDA' && row.sourceId === commandId ? { ...row, destinationHash: 'manual-divergence' } : row) } } });
    await runProof('commerce-receipt-divergent');
    await db.pdvMigrationBatch.update({ where: { id: originalBatch.id }, data: { checkpoint: originalCheckpoint } });

    await db.comanda.update({ where: { id: commandId }, data: { pontoVendaId: alternatePoint.id, ocorrenciaId: null } });
    await runProof('command-pdv-manually-altered');
    await db.comanda.update({ where: { id: commandId }, data: { pontoVendaId: originalCommand.pontoVendaId, ocorrenciaId: originalCommand.ocorrenciaId } });
  } finally {
    await db.comanda.update({ where: { id: commandId }, data: { pontoVendaId: originalCommand.pontoVendaId, ocorrenciaId: originalCommand.ocorrenciaId } });
    await db.pdvMigrationMap.deleteMany({ where: { sourceType: 'COMANDA', sourceId: commandId } });
    await db.pdvMigrationMap.create({ data: originalMap });
    await db.pdvMigrationBatch.update({ where: { id: originalBatch.id }, data: { checkpoint: originalCheckpoint } });
    await db.pontoVenda.delete({ where: { id: alternatePoint.id } });
  }
  return { commandId, proofResults };
}

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
  await measured('photoRestoreAndScalarReconciliation', () => db.$transaction(async (tx) => {
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
    const remainingDependencies = new Map(entries.map((entry) => [entry, entry.dependencies.size]));
    const dependents = new Map(entries.map((entry) => [entry, []]));
    for (const entry of entries) for (const edge of entry.dependencies) dependents.get(edge.parent).push({ child: entry, edge, active: true });
    const nullableCycleCandidates = [...dependents.values()].flat().filter((item) => item.edge.relation.fields.every((field) => nullableFields.get(item.child.table.model)?.get(field)));
    let cycleCandidateIndex = 0;
    const readyQueue = entries.filter((entry) => remainingDependencies.get(entry) === 0);
    let readyIndex = 0;
    while (inserted.size < entries.length) {
      if (readyIndex < readyQueue.length) {
        const ready = readyQueue.slice(readyIndex);
        readyIndex = readyQueue.length;
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
          for (const entry of modelEntriesReady) {
            inserted.add(entry);
            for (const dependent of dependents.get(entry)) {
              if (!dependent.active) continue;
              dependent.active = false;
              const remaining = remainingDependencies.get(dependent.child) - 1;
              remainingDependencies.set(dependent.child, remaining);
              if (remaining === 0) readyQueue.push(dependent.child);
            }
          }
          console.log(`PDV_PHOTO_IMPORT model=${modelName} rows=${modelEntriesReady.length} inserted=${inserted.size}/${entries.length}`);
        }
        continue;
      }
      let cycleCandidate;
      while (cycleCandidateIndex < nullableCycleCandidates.length) {
        const candidate = nullableCycleCandidates[cycleCandidateIndex++];
        if (candidate.active && !inserted.has(candidate.child) && !inserted.has(candidate.edge.parent)) { cycleCandidate = candidate; break; }
      }
      if (!cycleCandidate) {
        throw new Error(`PHOTO_IMPORT_REQUIRED_FK_CYCLE: ${entries.filter((entry) => !inserted.has(entry)).slice(0, 8).map((entry) => entry.identity).join(',')}`);
      }
      const cycleEdge = { entry: cycleCandidate.child, ...cycleCandidate.edge };
      for (const field of cycleEdge.relation.fields) cycleEdge.entry.data[field] = null;
      cycleEdge.entry.deferred.push(...cycleEdge.relation.fields.map((field) => [field, revive(cycleEdge.entry.row[field])]));
      const removed = [...cycleEdge.entry.dependencies].find((edge) => edge.parent === cycleEdge.parent && edge.relation === cycleEdge.relation);
      cycleEdge.entry.dependencies.delete(removed);
      cycleCandidate.active = false;
      const remaining = remainingDependencies.get(cycleEdge.entry) - 1;
      remainingDependencies.set(cycleEdge.entry, remaining);
      if (remaining === 0) readyQueue.push(cycleEdge.entry);
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
    console.log(`PDV_PHOTO_RESTORE=PASS; tables=${tables.length}; rows=${entries.length}; deferredRelations=${entries.reduce((sum, entry) => sum + entry.deferred.length, 0)}`);
  }, { timeout: 300000, maxWait: 30000 }));

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
      ['finance', (options) => runPdvFinanceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-finance`, historicalNoSessionApproval: approval, ...options })],
      ['kitchen-preparation-before-commerce', (options) => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-prep`, ...options })],
      ['commerce', (options) => runPdvCommerceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-commerce`, ...options })],
      ['finance-revalidation-after-commerce', (options) => runPdvFinanceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-finance`, historicalNoSessionApproval: approval, ...options })],
      ['kitchen-preparation-revalidation', (options) => runPdvKitchenOrderContextPreparation({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-kitchen-prep`, ...options })],
    ];
    let blocker;
    for (const [phase, execute] of phases) {
      try {
        const measure = (stage, operation) => measured(`${target.label}:${phase}:${stage}`, operation);
        const runStage = async (stage, operation) => {
          const started = performance.now();
          console.log(`PDV_REP_PHASE_START tenant=${target.label} phase=${phase} stage=${stage}`);
          const result = await measured(`${target.label}:${phase}:${stage}`, operation);
          console.log(`PDV_REP_PHASE_END tenant=${target.label} phase=${phase} stage=${stage} status=${result.status} durationMs=${Math.round(performance.now() - started)}`);
          return result;
        };
        let result = await runStage('firstBatch', () => execute({ maxBatches: 1, measure }));
        const interrupted = result.status === 'RUNNING';
        if (interrupted) result = await runStage('resume', () => execute({ measure }));
        if (result.status === 'BLOCKED') { blocker = { phase, ...result }; break; }
        if (result.status !== 'COMPLETED') { blocker = { phase, ...result, code: result.code ?? result.status ?? 'MIGRATOR_NOT_COMPLETED' }; break; }
        const replay = await runStage('replay', () => execute({ measure }));
        if (replay.status !== 'COMPLETED') { blocker = { phase, ...replay, code: replay.code ?? replay.status ?? 'REPLAY_NOT_COMPLETED' }; break; }
        let proofGuards;
        if (phase === 'finance' || phase === 'finance-revalidation-after-commerce') await reconcileRepresentativeFinance(target);
        if (phase === 'finance-revalidation-after-commerce') {
          proofGuards = await proveCommerceLinkRequiresDurableProof(target, pointId);
          const verifiedReplay = await runPdvFinanceMigration({ db, companyId: target.id, pointId, runId: `${runId}-${target.id}-finance`, historicalNoSessionApproval: approval });
          assert.equal(verifiedReplay.status, 'COMPLETED', `${target.label}: finance replay completes after restoring QA proof guard fixtures`);
          await reconcileRepresentativeFinance(target);
        }
        reports.push({ tenant: target.label, phase, status: 'COMPLETED', interruptedAndResumed: interrupted, sameRunReplay: replay.reusedCompletedRun === true || replay.status === 'COMPLETED', ...(proofGuards ? { commerceLinkProofGuards: proofGuards.proofResults } : {}), counts: result.counts ?? result.scopeCounts ?? result.checkpoint?.scopeCounts ?? undefined });
      } catch (error) {
        const timedOut = error.code === 'P2028' || /transaction.*(expired|timeout)|timed out/i.test(error.message ?? '');
        blocker = { phase, status: 'BLOCKED', code: timedOut ? 'TRANSACTION_TIMEOUT' : (error.code ?? error.name), failureKind: timedOut ? 'TECHNICAL_TRANSACTION_TIMEOUT' : 'MIGRATION_BLOCKER', prismaCode: timedOut ? (error.code ?? null) : undefined, sourceType: error.sourceType ?? null, sourceId: error.sourceId ?? null, message: timedOut ? 'A bounded database transaction expired; this is a technical execution failure, not evidence of source-data divergence.' : error.message };
        console.log(`PDV_REP_PHASE_BLOCKED tenant=${target.label} phase=${phase} code=${blocker.code} kind=${blocker.failureKind}`);
        break;
      }
    }
    if (blocker) {
      reports.push({ tenant: target.label, ...blocker });
      continue;
    }
  }
  const requiredPhases = ['business', 'catalog', 'sessions', 'finance', 'kitchen-preparation-before-commerce', 'commerce', 'finance-revalidation-after-commerce', 'kitchen-preparation-revalidation'];
  const tenantResults = targets.map((target) => {
    const rows = reports.filter((row) => row.tenant === target.label);
    const completed = new Set(rows.filter((row) => row.status === 'COMPLETED').map((row) => row.phase));
    const missingPhases = requiredPhases.filter((phase) => !completed.has(phase));
    return { tenant: target.label, status: missingPhases.length === 0 ? 'COMPLETED' : 'BLOCKED', missingPhases };
  });
  const aggregateStatus = tenantResults.every((row) => row.status === 'COMPLETED') ? 'COMPLETED' : 'BLOCKED';
  console.log(JSON.stringify({ aggregateStatus, qaDatabase: dbName, sourcePhoto: { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rows.length, 0), crossTenantEdges: photo.crossTenantEdges.length, measurements: photo.measurements ?? null }, anonymizedFields: photo.anonymization, metrics: [...metricRows.values()], tenantResults, reports }, null, 2));
  if (aggregateStatus !== 'COMPLETED') process.exitCode = 1;
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
