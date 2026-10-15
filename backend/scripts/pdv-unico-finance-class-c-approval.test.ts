import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPdvFinanceMigrationItems } from './pdv-unico-finance-transform.js';

const approvalPath = process.env.PDV_QA_CLASS_C_APPROVAL_PATH;
assert.ok(approvalPath, 'protected class-C approval path is required');
const approved = JSON.parse(await readFile(approvalPath, 'utf8'));
const emptySnapshot = { payments: [], debts: [], operationalMovements: [], eventMovements: [] };
const input = (extra: any = {}) => ({
  companyId: 'qa-policy-probe',
  pointId: 'qa-policy-probe',
  confirmedPdvSourceKey: 'PDV:qa-policy-probe',
  snapshot: emptySnapshot,
  confirmedSessions: {},
  confirmedEvents: {},
  mappedPaymentIds: new Set<string>(),
  ...extra,
} as any);

assert.deepEqual(buildPdvFinanceMigrationItems(input({
  executionProfile: 'qa',
  historicalNoSessionApproval: { ...approved, sourceBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' },
  historicalNoSessionBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e',
})), []);

const checkpointId = 'qa-production-policy-contract';
const checkpointSha256 = 'a'.repeat(64);
const productionApproval = {
  ...approved,
  scope: 'TAP-76 production checkpoint',
  sourceCheckpointId: checkpointId,
  sourceCheckpointSha256: checkpointSha256,
};
const productionAuthorization = {
  scope: 'PRODUCTION',
  decision: 'APPROVED',
  approvedBy: 'named-approver',
  approvedAt: '2026-10-15T14:00:00.000Z',
  sourceCheckpointId: checkpointId,
  sourceCheckpointSha256: checkpointSha256,
  payloadSha256: approved.approvedSnapshotSha256,
  idsSha256: '9ac3dac5ad2311bcf49817dd062771c5f7cf51b017da96c121b703441a8cf128',
};
assert.deepEqual(buildPdvFinanceMigrationItems(input({
  executionProfile: 'production',
  historicalNoSessionApproval: productionApproval,
  historicalNoSessionProductionAuthorization: productionAuthorization,
  historicalNoSessionBackupSha256: checkpointSha256,
})), []);
assert.throws(() => buildPdvFinanceMigrationItems(input({
  executionProfile: 'production',
  historicalNoSessionApproval: productionApproval,
  historicalNoSessionProductionAuthorization: productionAuthorization,
  historicalNoSessionBackupSha256: 'b'.repeat(64),
})), (error: any) => error.code === 'FINANCE_HISTORICAL_APPROVAL_INVALID');
assert.throws(() => buildPdvFinanceMigrationItems(input({
  executionProfile: 'production',
  historicalNoSessionApproval: { ...approved, sourceBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e' },
  historicalNoSessionBackupSha256: '3ba54e26d9d5b7042e65695217eae396d1c7d291c87aed48f024d5963386cd3e',
})), (error: any) => error.code === 'FINANCE_HISTORICAL_APPROVAL_INVALID');

const altered = structuredClone(productionApproval);
altered.entries[0].cents = String(BigInt(altered.entries[0].cents) + 1n);
assert.throws(() => buildPdvFinanceMigrationItems(input({
  executionProfile: 'production',
  historicalNoSessionApproval: altered,
  historicalNoSessionProductionAuthorization: productionAuthorization,
  historicalNoSessionBackupSha256: checkpointSha256,
})), (error: any) => error.code === 'FINANCE_HISTORICAL_APPROVAL_DIGEST_MISMATCH');

process.stdout.write('class-C finance authorization contracts PASS\n');
