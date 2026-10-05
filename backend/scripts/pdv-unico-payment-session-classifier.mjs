/** Classifies persisted payment/session evidence for migration review only. */
export function classifyPaymentSessionEvidence({
  payment,
  tenantId,
  command,
  eventSessions = [],
  operationalSessions = [],
  noSessionProof = null,
}) {
  if (!payment || !command || !tenantId) return { classification: 'D_INVALID_OWNERSHIP_CONTEXT' };

  const eventSessionId = payment.sessaoCaixaEventoId ?? null;
  const operationalSessionId = payment.sessaoCaixaId ?? null;
  if (eventSessionId && operationalSessionId) return { classification: 'D_DUAL_SESSION_REFERENCE' };

  if (eventSessionId) {
    const session = eventSessions.find((row) => row.id === eventSessionId);
    if (!session) return { classification: 'D_EVENT_SESSION_REFERENCE_MISSING' };
    if (session.tenantId !== tenantId || session.eventId !== command.eventId) {
      return { classification: 'D_EVENT_SESSION_TENANT_OR_EVENT_MISMATCH' };
    }
    return { classification: 'A_EXACT_SESSION_REFERENCE', sessionId: session.id, sessionKind: 'EVENTO' };
  }

  if (operationalSessionId) {
    const session = operationalSessions.find((row) => row.id === operationalSessionId);
    if (!session) return { classification: 'D_OPERATIONAL_SESSION_REFERENCE_MISSING' };
    if (session.tenantId !== tenantId || session.pdvId !== command.pdvId) {
      return { classification: 'D_OPERATIONAL_SESSION_TENANT_OR_PDV_MISMATCH' };
    }
    return { classification: 'A_EXACT_SESSION_REFERENCE', sessionId: session.id, sessionKind: 'CAIXA' };
  }

  if (noSessionProof?.paymentId === payment.id
    && noSessionProof.explicitNullSessionFields === true
    && noSessionProof.provenanceCodePath === true) {
    return { classification: 'B_HISTORICAL_NO_SESSION_PROVENANCE', provenanceType: noSessionProof.type };
  }

  return { classification: 'C_NO_SESSION_PROVENANCE_INSUFFICIENT' };
}
