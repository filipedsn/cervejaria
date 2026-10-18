import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertClassCSourceMatchesApproval, validateClassCAuthorization } from './pdv-class-c-authorization.mjs';

const root = path.resolve(process.env.PDV_CUTOVER_TEST_FIXTURE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const approvalPath = path.join(root, 'artifacts/rbac-permissions-ui-2026-10-10/run-admin-freeze-20261015/class-c-qa-approval.protected.json');
const approved = JSON.parse(await readFile(approvalPath, 'utf8'));
const copy = (value) => structuredClone(value);
const sourceFacts = (entries = approved.entries) => entries.map(({ classification, ...facts }) => facts);

test('accepts real source facts without the approval-only classification annotation', () => {
  assert.equal(validateClassCAuthorization({ mode: 'qa', approval: approved, originBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' }).count, 579);
  const result = assertClassCSourceMatchesApproval({ approval: approved, sourceEntries: sourceFacts(copy(approved.entries)) });
  assert.equal(result.authorization.historicalPayloadSha256, approved.approvedSnapshotSha256);
  assert.equal(result.decision.classification, 'C_ORIGIN_UNPROVEN');
  assert.equal(result.decision.provenance, 'CAIXA_NAO_COMPROVADA');
  assert.equal(result.originFacts.count, 579);
  assert.notEqual(result.originFacts.payloadSha256, approved.approvedSnapshotSha256);
  assert.ok(sourceFacts()[0] && !Object.hasOwn(sourceFacts()[0], 'classification'));
});

test('refuses an unauthorized or altered classification decision', () => {
  const invalidTopLevel = copy(approved);
  invalidTopLevel.classification = 'A_PROVEN';
  assert.throws(() => validateClassCAuthorization({ mode: 'qa', approval: invalidTopLevel, originBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' }), /CLASS_C_APPROVAL_SHAPE_INVALID/);
  const invalidEntry = copy(approved);
  invalidEntry.entries[0].classification = 'A_PROVEN';
  assert.throws(() => validateClassCAuthorization({ mode: 'qa', approval: invalidEntry, originBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' }), /CLASS_C_DECISION_INVALID/);
});

test('refuses a different origin backup', () => {
  assert.throws(() => validateClassCAuthorization({ mode: 'qa', approval: approved, originBackupSha256: '0'.repeat(64) }), /CLASS_C_QA_ORIGIN_MISMATCH/);
});

test('refuses an altered source value', () => {
  const sourceEntries = sourceFacts(copy(approved.entries));
  sourceEntries[0].cents = String(BigInt(sourceEntries[0].cents) + 1n);
  assert.throws(() => assertClassCSourceMatchesApproval({ approval: approved, sourceEntries }), /CLASS_C_SOURCE_CONTENT_MISMATCH/);
});

test('refuses changed source tenant, time, command and all financial/operational links', () => {
  const mutations = [
    ['tenantId', (entry) => { entry.tenantId = 'unauthorized-tenant'; }],
    ['paidAt', (entry) => { entry.paidAt = '2026-01-01T00:00:00.000Z'; }],
    ['commandClosedAt', (entry) => { entry.commandClosedAt = '2026-01-01T00:00:00.000Z'; }],
    ['commandId', (entry) => { entry.commandId = 'different-command'; }],
    ['pointId', (entry) => { entry.pointId = 'different-point'; }],
    ['eventId', (entry) => { entry.eventId = 'different-event'; }],
    ['receivableId', (entry) => { entry.receivableId = 'different-receivable'; }],
    ['operationalSessionId', (entry) => { entry.operationalSessionId = 'different-operational-session'; }],
    ['eventSessionId', (entry) => { entry.eventSessionId = 'different-event-session'; }],
  ];
  for (const [field, mutate] of mutations) {
    const sourceEntries = sourceFacts(copy(approved.entries));
    mutate(sourceEntries[0]);
    assert.throws(
      () => assertClassCSourceMatchesApproval({ approval: approved, sourceEntries }),
      new RegExp(`CLASS_C_SOURCE_CONTENT_MISMATCH:.*${field}`),
      `${field} changes must be refused`,
    );
  }
});

test('refuses an added ID', () => {
  const sourceEntries = sourceFacts(copy(approved.entries));
  sourceEntries.push({ ...sourceEntries[0], id: 'unauthorized-payment-id' });
  assert.throws(() => assertClassCSourceMatchesApproval({ approval: approved, sourceEntries }), /CLASS_C_SOURCE_ID_SET_MISMATCH/);
});

test('refuses a removed ID', () => {
  const sourceEntries = sourceFacts(copy(approved.entries)).slice(1);
  assert.throws(() => assertClassCSourceMatchesApproval({ approval: approved, sourceEntries }), /CLASS_C_SOURCE_ID_SET_MISMATCH/);
});

test('does not promote QA authorization into production', () => {
  assert.throws(() => validateClassCAuthorization({ mode: 'production', approval: approved, originBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' }), /CLASS_C_EXPLICIT_PRODUCTION_AUTHORIZATION_REQUIRED/);
});

test('represents production authorization only as a separate checkpoint-bound approval', () => {
  const sourceCheckpointId = 'qa-contract-only-checkpoint';
  const sourceCheckpointSha256 = 'a'.repeat(64);
  const productionApproval = { ...copy(approved), scope: 'TAP-76 production checkpoint', sourceCheckpointId };
  const productionAuthorization = {
    scope: 'PRODUCTION', decision: 'APPROVED', approvedBy: 'explicit-approver', approvedAt: '2026-10-15T14:00:00Z',
    sourceCheckpointId, sourceCheckpointSha256, payloadSha256: approved.approvedSnapshotSha256,
    idsSha256: '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128',
  };
  assert.equal(validateClassCAuthorization({ mode: 'production', approval: productionApproval, productionAuthorization, originBackupSha256: sourceCheckpointSha256 }).mode, 'production');
  assert.throws(() => validateClassCAuthorization({ mode: 'production', approval: productionApproval, productionAuthorization, originBackupSha256: 'b'.repeat(64) }), /CLASS_C_EXPLICIT_PRODUCTION_AUTHORIZATION_REQUIRED/);
});
