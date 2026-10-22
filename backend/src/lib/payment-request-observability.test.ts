import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentRequestAuditInput, recordPaymentRequestTransition } from './payment-request-observability.js';

const input = {
  cervejariaId: 'tenant-safe-id',
  comandaId: 'command-safe-id',
  route: '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/solicitar-pagamento',
  method: 'POST',
  statusCode: 200,
};

test('payment request transitions have semantic audit actions distinct from payment receipt', () => {
  assert.equal(paymentRequestAuditInput('requested', input).action, 'payment.requested');
  assert.equal(paymentRequestAuditInput('resolved', input).action, 'payment.request_resolved');
  assert.equal(paymentRequestAuditInput('requested', input).entityId, input.comandaId);
  assert.equal(paymentRequestAuditInput('requested', input).cervejariaId, input.cervejariaId);
  assert.equal(paymentRequestAuditInput('requested', input).metadata, undefined);
});

test('each committed request-state transition emits one event and one distinct metric sample', () => {
  const events: Array<{ action: string }> = [];
  const metrics: Array<Record<string, string>> = [];
  recordPaymentRequestTransition('requested', input, (event) => events.push(event as { action: string }), (attrs) => metrics.push(attrs));
  recordPaymentRequestTransition('resolved', input, (event) => events.push(event as { action: string }), (attrs) => metrics.push(attrs));
  assert.deepEqual(events.map((event) => event.action), ['payment.requested', 'payment.request_resolved']);
  assert.deepEqual(metrics, [
    { 'quiver.payment_request.action': 'requested', 'cervejaria.id': input.cervejariaId },
    { 'quiver.payment_request.action': 'resolved', 'cervejaria.id': input.cervejariaId },
  ]);
  assert.equal(events.some((event) => event.action.includes('paid') || event.action.includes('payment.received')), false);
});
