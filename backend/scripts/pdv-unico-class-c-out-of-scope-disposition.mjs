import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const OUT_OF_SCOPE_TENANT = 'cmr9yfsdd0001hvtku98n4cjd';
const EXPECTED_SUBSET_PAYLOAD_SHA256 = '73fbccde971ff9b27ba8db63bd86d3cb86a745386ea71f305cbb58c6e609f682';
const EXPECTED_SUBSET_IDS_SHA256 = 'd9962b9978ac641d940cfb55195a3c7d0b17a672ce48e09f8db27575316fae0e';
const EXPECTED_FULL_PAYLOAD_SHA256 = '6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9';
const EXPECTED_FULL_IDS_SHA256 = '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128';
const SCOPE = 'PDV_CLASS_C_DISPOSITION_V1';
const VERSION = 1;

const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const cents = (value) => {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  assert.ok(match, 'QA class-C payment value must be exact cents');
  return `${match[1] === '-' ? '-' : ''}${(BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))).toString()}`;
};

function assertExactAuthorization({ approval, productionContext }) {
  assert.equal(productionContext?.checkpoint?.checkpointId, approval.sourceCheckpointId, 'checkpoint id must bind the class-C approval');
  assert.equal(productionContext?.checkpointSha256, approval.sourceCheckpointSha256, 'checkpoint digest must bind the class-C approval');
  assert.equal(productionContext?.productionAuthorization?.sourceCheckpointId, approval.sourceCheckpointId, 'separate production authorization must bind checkpoint id');
  assert.equal(productionContext?.productionAuthorization?.sourceCheckpointSha256, approval.sourceCheckpointSha256, 'separate production authorization must bind checkpoint digest');
  assert.equal(productionContext?.productionAuthorization?.payloadSha256, EXPECTED_FULL_PAYLOAD_SHA256, 'production authorization payload must be exact');
  assert.equal(productionContext?.productionAuthorization?.idsSha256, EXPECTED_FULL_IDS_SHA256, 'production authorization IDs must be exact');
  assert.equal(approval.entries.length, 579);
  assert.equal(sha(json(approval.entries)), EXPECTED_FULL_PAYLOAD_SHA256);
  assert.equal(sha(json(approval.entries.map((entry) => entry.id).sort())), EXPECTED_FULL_IDS_SHA256);
}

function expectedSourcePayment(entry, alreadyApplied = false) {
  return {
    id: entry.id,
    comandaId: entry.commandId,
    contaReceberId: entry.receivableId,
    sessaoCaixaId: entry.operationalSessionId,
    sessaoCaixaEventoId: entry.eventSessionId,
    provenienciaHistorica: alreadyApplied ? 'CAIXA_NAO_COMPROVADA' : null,
    forma: entry.form,
    valor: entry.cents,
    valorRecebido: entry.receivedCents,
    troco: entry.changeCents,
    registradoPorId: entry.registeredById,
    pagoEm: entry.paidAt,
    command: {
      id: entry.commandId,
      origem: entry.origin,
      pontoVendaId: entry.pointId,
      eventoId: entry.eventId,
      total: entry.commandTotalCents,
      fechadaEm: entry.commandClosedAt,
      cervejariaId: OUT_OF_SCOPE_TENANT,
    },
  };
}

function actualSourcePayment(row) {
  return {
    id: row.id,
    comandaId: row.comandaId,
    contaReceberId: row.contaReceberId,
    sessaoCaixaId: row.sessaoCaixaId,
    sessaoCaixaEventoId: row.sessaoCaixaEventoId,
    provenienciaHistorica: row.provenienciaHistorica,
    forma: row.forma,
    valor: cents(row.valor),
    valorRecebido: row.valorRecebido == null ? null : cents(row.valorRecebido),
    troco: row.troco == null ? null : cents(row.troco),
    registradoPorId: row.registradoPorId,
    pagoEm: row.pagoEm.toISOString(),
    command: {
      id: row.comanda.id,
      origem: row.comanda.origem,
      pontoVendaId: row.comanda.pontoVendaId,
      eventoId: row.comanda.eventoId,
      total: cents(row.comanda.total),
      fechadaEm: row.comanda.fechadaEm?.toISOString?.() ?? null,
      cervejariaId: row.comanda.evento?.cervejariaId ?? row.comanda.pontoVenda?.cervejariaId,
    },
  };
}

async function readApprovedRows(db, entries, { provenance = 'null' } = {}) {
  const rows = await db.pagamento.findMany({
    where: { id: { in: entries.map((entry) => entry.id) } },
    select: {
      id: true, comandaId: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true,
      provenienciaHistorica: true, forma: true, valor: true, valorRecebido: true, troco: true,
      registradoPorId: true, pagoEm: true,
      comanda: { select: {
        id: true, origem: true, pontoVendaId: true, eventoId: true, total: true, fechadaEm: true,
        evento: { select: { cervejariaId: true } },
        pontoVenda: { select: { cervejariaId: true } },
      } },
    },
  });
  assert.equal(rows.length, entries.length, 'all exact out-of-scope payments must exist');
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const entry of entries) {
    const row = byId.get(entry.id);
    assert.ok(row, `approved payment ${entry.id} must exist`);
    const actual = actualSourcePayment(row);
    if (provenance === 'either') {
      assert.ok(actual.provenienciaHistorica == null || actual.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA');
      actual.provenienciaHistorica = null;
    } else if (provenance === 'applied') {
      assert.equal(actual.provenienciaHistorica, 'CAIXA_NAO_COMPROVADA');
    } else {
      assert.equal(actual.provenienciaHistorica, null);
    }
    assert.equal(json(actual), json(expectedSourcePayment(entry, provenance === 'applied')), `payment ${entry.id} no longer matches the protected approval content`);
    assert.equal(entry.origin, 'EVENTO', 'out-of-scope disposition only supports the two approved event payments');
    assert.equal(entry.pointId, null, 'out-of-scope event payment must not have a PDV link');
    assert.equal(entry.receivableId, null, 'out-of-scope payment must not have a receivable link');
    assert.equal(entry.operationalSessionId, null);
    assert.equal(entry.eventSessionId, null);
  }
  return rows;
}

/** Applies only the approved class-C provenance to exact records outside the two operational tenants. */
export async function applyApprovedClassCOutOfScopeDisposition({ db, approval, productionContext, baseRunId }) {
  assertExactAuthorization({ approval, productionContext });
  assert.match(baseRunId ?? '', /^[a-zA-Z0-9_-]{8,80}$/);
  const entries = approval.entries.filter((entry) => entry.tenantId === OUT_OF_SCOPE_TENANT);
  assert.equal(entries.length, 2, 'the pinned third-tenant subset must remain exactly two payments');
  assert.equal(sha(json(entries)), EXPECTED_SUBSET_PAYLOAD_SHA256, 'out-of-scope content differs from its pinned approval');
  assert.equal(sha(json(entries.map((entry) => entry.id).sort())), EXPECTED_SUBSET_IDS_SHA256, 'out-of-scope payment IDs differ from their pinned approval');
  assert.equal(approval.entries.filter((entry) => ![...productionContext.tenantIds].includes(entry.tenantId)).length, 2, 'no additional tenant may be introduced by the approval');
  await readApprovedRows(db, entries, { provenance: 'either' });

  const runId = `${baseRunId}-classc-only-${OUT_OF_SCOPE_TENANT}`;
  const subsetHash = EXPECTED_SUBSET_PAYLOAD_SHA256;
  const checkpoint = {
    executionProfile: 'production',
    approvalSnapshotSha256: EXPECTED_FULL_PAYLOAD_SHA256,
    approvalIdsSha256: EXPECTED_FULL_IDS_SHA256,
    sourceCheckpointId: productionContext.checkpoint.checkpointId,
    sourceCheckpointSha256: productionContext.checkpointSha256,
    productionAuthorizationDecision: productionContext.productionAuthorization.decision,
    records: entries.map((entry) => entry.id).sort(),
    disposition: 'CAIXA_NAO_COMPROVADA',
    noTenantActivation: true,
    noOperationalLinksCreated: true,
  };

  return db.$transaction(async (tx) => {
    const prior = await tx.pdvMigrationRun.findUnique({ where: { id: runId }, include: { batches: true, mappings: true } });
    if (prior) {
      assert.equal(prior.scope, SCOPE);
      assert.equal(prior.cervejariaId, OUT_OF_SCOPE_TENANT);
      assert.equal(prior.sourceSnapshotHash, subsetHash);
      assert.equal(json(canonical(prior.checkpoint)), json(canonical(checkpoint)), 'completed class-C checkpoint is semantically identical despite database JSON key ordering');
      assert.equal(prior.status, 'COMPLETED');
      assert.equal(prior.batches.length, 1);
      assert.equal(prior.batches[0].status, 'CONFIRMED');
      assert.equal(prior.mappings.length, 2);
      await readApprovedRows(tx, entries, { provenance: 'applied' });
      const reread = await tx.pagamento.findMany({ where: { id: { in: entries.map((entry) => entry.id) } }, select: { id: true, provenienciaHistorica: true } });
      assert.ok(reread.every((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA'));
      for (const entry of entries) {
        const mapping = prior.mappings.find((row) => row.sourceId === entry.id);
        assert.ok(mapping);
        assert.equal(mapping.payloadHash, sha(json(entry)));
        assert.equal(mapping.destinationId, entry.id);
      }
      return { status: 'COMPLETED', runId, count: 2, subsetSha256: subsetHash, reusedCompletedRun: true };
    }

    await readApprovedRows(tx, entries);
    const batchId = `${runId}-batch-1`;
    await tx.pdvMigrationRun.create({ data: {
      id: runId, status: 'RUNNING', scope: SCOPE, cervejariaId: OUT_OF_SCOPE_TENANT,
      pontoVendaId: null, transformVersion: VERSION, sourceSnapshotHash: subsetHash, checkpoint,
    } });
    await tx.pdvMigrationBatch.create({ data: {
      id: batchId, runId, sequence: 1, status: 'PROCESSING', payloadHash: subsetHash,
      checkpoint: { ...checkpoint, batchRecords: entries.map((entry) => entry.id).sort() },
    } });
    const update = await tx.pagamento.updateMany({
      where: {
        id: { in: entries.map((entry) => entry.id) },
        provenienciaHistorica: null,
        comandaId: { in: entries.map((entry) => entry.commandId) },
        contaReceberId: null, sessaoCaixaId: null, sessaoCaixaEventoId: null,
      },
      data: { provenienciaHistorica: 'CAIXA_NAO_COMPROVADA' },
    });
    assert.equal(update.count, 2, 'only the exact two approved, unchanged payment rows may be updated');
    await tx.pdvMigrationMap.createMany({ data: entries.map((entry) => ({
      sourceType: 'PAGAMENTO', sourceId: entry.id, destinationType: 'PAGAMENTO', destinationId: entry.id,
      cervejariaId: OUT_OF_SCOPE_TENANT, pontoVendaId: null, transformVersion: VERSION,
      payloadHash: sha(json(entry)), sourcePayload: {
        ...entry, historicalDisposition: 'C_ORIGIN_UNPROVEN',
        approvalSnapshotSha256: EXPECTED_FULL_PAYLOAD_SHA256, approvalIdsSha256: EXPECTED_FULL_IDS_SHA256,
        sourceCheckpointId: productionContext.checkpoint.checkpointId,
        sourceCheckpointSha256: productionContext.checkpointSha256,
        productionAuthorization: productionContext.productionAuthorization,
        lastRunId: runId, lastBatchId: batchId,
      }, lastRunId: runId, lastBatchId: batchId,
    })) });
    await tx.pdvMigrationBatch.update({ where: { id_runId: { id: batchId, runId } }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
    const after = await tx.pagamento.findMany({ where: { id: { in: entries.map((entry) => entry.id) } }, select: { id: true, provenienciaHistorica: true, comandaId: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true } });
    assert.equal(after.length, 2);
    assert.ok(after.every((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA' && row.contaReceberId == null && row.sessaoCaixaId == null && row.sessaoCaixaEventoId == null));
    assert.deepEqual(new Set(after.map((row) => row.comandaId)), new Set(entries.map((entry) => entry.commandId)));
    return { status: 'COMPLETED', runId, count: 2, subsetSha256: subsetHash, reusedCompletedRun: false };
  }, { isolationLevel: 'Serializable' });
}
