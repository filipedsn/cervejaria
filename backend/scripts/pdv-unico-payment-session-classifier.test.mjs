import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPaymentSessionEvidence } from './pdv-unico-payment-session-classifier.mjs';

const base = {
  payment: { id: 'payment-1', cents: '3800', sessaoCaixaId: null, sessaoCaixaEventoId: null },
  command: { id: 'command-1', pdvId: 'pdv-a', eventId: 'event-a' },
  tenantId: 'tenant-a',
};

test('A requires one exact persisted session reference in the same tenant and operation', () => {
  assert.deepEqual(classifyPaymentSessionEvidence({
    ...base,
    payment: { ...base.payment, sessaoCaixaId: 'session-a' },
    operationalSessions: [{ id: 'session-a', tenantId: 'tenant-a', pdvId: 'pdv-a' }],
  }), { classification: 'A_EXACT_SESSION_REFERENCE', sessionId: 'session-a', sessionKind: 'CAIXA' });
});

test('B requires an exact payment identity, explicit null session snapshot, and code-path provenance', () => {
  assert.deepEqual(classifyPaymentSessionEvidence({
    ...base,
    noSessionProof: { paymentId: 'payment-1', explicitNullSessionFields: true, provenanceCodePath: true, type: 'SALE_PAYMENT_RECORDED' },
  }), { classification: 'B_HISTORICAL_NO_SESSION_PROVENANCE', provenanceType: 'SALE_PAYMENT_RECORDED' });
});

test('C keeps null references blocked when evidence is only a payment or command audit', () => {
  assert.deepEqual(classifyPaymentSessionEvidence({ ...base }), { classification: 'C_NO_SESSION_PROVENANCE_INSUFFICIENT' });
});

test('D identifies contradiction, missing reference, and tenant/PDV mismatch', () => {
  assert.equal(classifyPaymentSessionEvidence({
    ...base, payment: { ...base.payment, sessaoCaixaId: 'session-a', sessaoCaixaEventoId: 'event-session-a' },
  }).classification, 'D_DUAL_SESSION_REFERENCE');
  assert.equal(classifyPaymentSessionEvidence({
    ...base, payment: { ...base.payment, sessaoCaixaEventoId: 'missing' },
  }).classification, 'D_EVENT_SESSION_REFERENCE_MISSING');
  assert.equal(classifyPaymentSessionEvidence({
    ...base,
    payment: { ...base.payment, sessaoCaixaId: 'session-b' },
    operationalSessions: [{ id: 'session-b', tenantId: 'tenant-b', pdvId: 'pdv-a' }],
  }).classification, 'D_OPERATIONAL_SESSION_TENANT_OR_PDV_MISMATCH');
});

test('a debt receipt with explicit no-session provenance remains separate and conserves amount', () => {
  const payment = { ...base.payment, id: 'receipt-1', cents: '3800', contaReceberId: 'receivable-1' };
  const result = classifyPaymentSessionEvidence({
    ...base,
    payment,
    noSessionProof: { paymentId: 'receipt-1', explicitNullSessionFields: true, provenanceCodePath: true, type: 'SALE_PAYMENT_RECORDED' },
  });
  assert.equal(result.classification, 'B_HISTORICAL_NO_SESSION_PROVENANCE');
  assert.equal(payment.cents, '3800');
  assert.equal(payment.contaReceberId, 'receivable-1');
});

test('tenant isolation refuses a perfectly matching session from another tenant', () => {
  assert.equal(classifyPaymentSessionEvidence({
    ...base,
    payment: { ...base.payment, sessaoCaixaEventoId: 'event-session-b' },
    eventSessions: [{ id: 'event-session-b', tenantId: 'tenant-b', eventId: 'event-a' }],
  }).classification, 'D_EVENT_SESSION_TENANT_OR_EVENT_MISMATCH');
});
