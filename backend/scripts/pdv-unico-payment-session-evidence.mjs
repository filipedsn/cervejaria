/**
 * The finance migrator maps an EVENTO session into the operational session table
 * with destinationId === sourceId while preserving sessaoCaixaEventoId.
 */
export function expectedMigratedPaymentSessionReferences(review) {
  const eventId = review?.sessionRefs?.eventId ?? null;
  return {
    operationalId: review?.sessionRefs?.operationalId ?? eventId,
    eventId,
  };
}
