import { createHash } from 'node:crypto';

export const APPROVED_CLASS_C = Object.freeze({
  payments: 579,
  payloadSha256: '6d649ade7c8471adba44b381bd113d0fe2c8c04191287b1f8504e84ad9e908a9',
  sortedIdsSha256: '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128',
  qaBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const payloadDigest = (entries) => sha256(JSON.stringify(entries));
const idsDigest = (entries) => sha256(JSON.stringify(entries.map(({ id }) => id).sort()));
const FACT_FIELDS = Object.freeze([
  'tenantId', 'id', 'commandId', 'origin', 'pointId', 'eventId', 'commandTotalCents',
  'commandClosedAt', 'form', 'cents', 'receivedCents', 'changeCents', 'paidAt',
  'registeredById', 'receivableId', 'operationalSessionId', 'eventSessionId',
]);

function sourceFactsFromDecisionEntry(entry) {
  return Object.fromEntries(FACT_FIELDS.map((field) => [field, entry[field]]));
}

function contractsForApproval(approval) {
  const facts = approval.entries.map(sourceFactsFromDecisionEntry);
  return Object.freeze({
    authorization: Object.freeze({
      formatVersion: approval.version,
      scope: approval.scope,
      historicalPayloadSha256: approval.approvedSnapshotSha256,
      idsSha256: APPROVED_CLASS_C.sortedIdsSha256,
    }),
    originFacts: Object.freeze({
      formatVersion: 1,
      count: facts.length,
      payloadSha256: payloadDigest(facts),
      idsSha256: idsDigest(facts),
    }),
    decision: Object.freeze({
      classification: approval.classification,
      provenance: approval.provenance,
    }),
  });
}

function assertApprovalShape(approval) {
  if (!approval || approval.version !== 1 || approval.classification !== 'C_ORIGIN_UNPROVEN'
    || approval.provenance !== 'CAIXA_NAO_COMPROVADA' || !Array.isArray(approval.entries)
    || approval.entries.length !== APPROVED_CLASS_C.payments || approval.counts?.payments !== APPROVED_CLASS_C.payments
    || approval.counts?.withExactPaymentAuditReference !== 0
    || approval.counts?.withoutExactPaymentAuditReference !== APPROVED_CLASS_C.payments) {
    throw new Error('CLASS_C_APPROVAL_SHAPE_INVALID');
  }
  if (approval.entries.some((entry) => entry?.classification !== approval.classification)) {
    throw new Error('CLASS_C_DECISION_INVALID');
  }
  const ids = approval.entries.map((entry) => entry?.id);
  if (ids.some((id) => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) {
    throw new Error('CLASS_C_APPROVAL_IDS_INVALID');
  }
  if (payloadDigest(approval.entries) !== APPROVED_CLASS_C.payloadSha256
    || approval.approvedSnapshotSha256 !== APPROVED_CLASS_C.payloadSha256) {
    throw new Error('CLASS_C_APPROVAL_PAYLOAD_DIGEST_MISMATCH');
  }
  if (idsDigest(approval.entries) !== APPROVED_CLASS_C.sortedIdsSha256) {
    throw new Error('CLASS_C_APPROVAL_ID_SET_MISMATCH');
  }
}

/**
 * Validate an immutable class-C authorization before invoking any transformer.
 * QA approvals are backup-bound and can never satisfy the production mode.
 */
export function validateClassCAuthorization({ mode, approval, originBackupSha256, productionAuthorization }) {
  if (mode !== 'qa' && mode !== 'production') throw new Error('CLASS_C_MODE_INVALID');
  assertApprovalShape(approval);

  if (mode === 'qa') {
    if (approval.scope !== 'TAP-76 QA rehearsal only'
      || originBackupSha256 !== APPROVED_CLASS_C.qaBackupSha256) {
      throw new Error('CLASS_C_QA_ORIGIN_MISMATCH');
    }
    return Object.freeze({ mode, count: APPROVED_CLASS_C.payments, payloadSha256: APPROVED_CLASS_C.payloadSha256, idsSha256: APPROVED_CLASS_C.sortedIdsSha256 });
  }

  if (approval.scope === 'TAP-76 QA rehearsal only' || !productionAuthorization
    || productionAuthorization.scope !== 'PRODUCTION'
    || productionAuthorization.decision !== 'APPROVED'
    || typeof productionAuthorization.approvedBy !== 'string' || !productionAuthorization.approvedBy.trim()
    || !Number.isFinite(Date.parse(productionAuthorization.approvedAt))
    || typeof productionAuthorization.sourceCheckpointId !== 'string' || !productionAuthorization.sourceCheckpointId.trim()
    || !/^[a-f0-9]{64}$/.test(productionAuthorization.sourceCheckpointSha256 ?? '')
    || productionAuthorization.sourceCheckpointSha256 !== originBackupSha256
    || productionAuthorization.payloadSha256 !== APPROVED_CLASS_C.payloadSha256
    || productionAuthorization.idsSha256 !== APPROVED_CLASS_C.sortedIdsSha256) {
    throw new Error('CLASS_C_EXPLICIT_PRODUCTION_AUTHORIZATION_REQUIRED');
  }
  if (approval.scope !== 'TAP-76 production checkpoint'
    || approval.sourceCheckpointId !== productionAuthorization.sourceCheckpointId
    || approval.approvedSnapshotSha256 !== APPROVED_CLASS_C.payloadSha256) {
    throw new Error('CLASS_C_PRODUCTION_SOURCE_MISMATCH');
  }
  return Object.freeze({ mode, count: APPROVED_CLASS_C.payments, payloadSha256: APPROVED_CLASS_C.payloadSha256, idsSha256: APPROVED_CLASS_C.sortedIdsSha256 });
}

/**
 * The v1 authorization digest covers both the approved origin facts and the
 * decision annotation. Source rows do not persist classification, so compare
 * them against the v1 facts projection while retaining and reporting the
 * original authorization digest unchanged.
 */
export function assertClassCSourceMatchesApproval({ approval, sourceEntries }) {
  assertApprovalShape(approval);
  if (!Array.isArray(sourceEntries)) throw new Error('CLASS_C_SOURCE_SNAPSHOT_INVALID');
  const byId = new Map(sourceEntries.map((entry) => [entry?.id, entry]));
  if (byId.size !== sourceEntries.length || byId.size !== APPROVED_CLASS_C.payments) {
    throw new Error('CLASS_C_SOURCE_ID_SET_MISMATCH');
  }
  const orderedSource = approval.entries.map(({ id }) => byId.get(id));
  if (orderedSource.some((entry) => entry === undefined)) throw new Error('CLASS_C_SOURCE_ID_SET_MISMATCH');
  const approvedFacts = approval.entries.map(sourceFactsFromDecisionEntry);
  const canonicalSource = orderedSource.map((entry) => {
    if (Object.keys(entry ?? {}).sort().join('|') !== [...FACT_FIELDS].sort().join('|')) {
      throw new Error('CLASS_C_SOURCE_FACT_SHAPE_MISMATCH');
    }
    return Object.fromEntries(FACT_FIELDS.map((field) => [field, entry[field]]));
  });
  if (JSON.stringify(canonicalSource) !== JSON.stringify(approvedFacts)) {
    const fieldCounts = new Map();
    for (let index = 0; index < canonicalSource.length; index++) {
      const actual = canonicalSource[index];
      const expected = approvedFacts[index];
      for (const field of FACT_FIELDS) {
        if (JSON.stringify(actual?.[field]) !== JSON.stringify(expected?.[field])) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }
    const summary = [...fieldCounts].sort(([a], [b]) => a.localeCompare(b)).map(([field, count]) => `${field}:${count}`).join(',');
    throw new Error(`CLASS_C_SOURCE_CONTENT_MISMATCH:${summary || 'canonicalization'}`);
  }
  const contracts = contractsForApproval(approval);
  if (idsDigest(canonicalSource) !== APPROVED_CLASS_C.sortedIdsSha256) throw new Error('CLASS_C_SOURCE_ID_SET_MISMATCH');
  return Object.freeze({
    count: APPROVED_CLASS_C.payments,
    payloadSha256: APPROVED_CLASS_C.payloadSha256,
    idsSha256: APPROVED_CLASS_C.sortedIdsSha256,
    ...contracts,
  });
}
