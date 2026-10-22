import { metrics } from '@opentelemetry/api';
import { emitAuditEvent, type AuditEventInput } from './audit/emit-audit-event.js';

export type PaymentRequestTransition = 'requested' | 'resolved';

const paymentRequestTotal = metrics.getMeter('quiver-tap-business').createCounter('quiver.payment_request.total', {
  description: 'Payment requests created or resolved; distinct from payments received',
});

export function paymentRequestAuditInput(
  transition: PaymentRequestTransition,
  input: { cervejariaId: string; comandaId: string; route: string; method: string; statusCode: number },
): AuditEventInput {
  const requested = transition === 'requested';
  return {
    action: requested ? 'payment.requested' : 'payment.request_resolved',
    message: requested ? 'Cliente solicitou pagamento' : 'Equipe resolveu solicitação de pagamento',
    outcome: 'success',
    entityType: 'comanda',
    entityId: input.comandaId,
    cervejariaId: input.cervejariaId,
    http: { method: input.method, route: input.route, statusCode: input.statusCode },
  };
}

export function recordPaymentRequestTransition(
  transition: PaymentRequestTransition,
  input: { cervejariaId: string; comandaId: string; route: string; method: string; statusCode: number },
  emit: (event: AuditEventInput) => void = emitAuditEvent,
  addMetric: (attributes: Record<string, string>) => void = (attributes) => paymentRequestTotal.add(1, attributes),
): void {
  emit(paymentRequestAuditInput(transition, input));
  addMetric({ 'quiver.payment_request.action': transition, 'cervejaria.id': input.cervejariaId });
}
