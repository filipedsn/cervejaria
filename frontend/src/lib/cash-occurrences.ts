export type CashOccurrenceOption = {
  id: string;
  nome: string;
  data: string;
  status: 'PROGRAMADA' | 'ABERTA' | 'FECHADA' | 'CANCELADA';
  agenda: { nome: string; frequencia: 'SEMANAL'; diaSemana: number } | null;
};

export function cashOccurrenceQueryUrl(operationalDay: string): string {
  const day = encodeURIComponent(operationalDay);
  return `/api/operacao/agenda/ocorrencias?inicio=${day}&fim=${day}`;
}

export function eligibleCashOccurrences(occurrences: CashOccurrenceOption[], operationalDay: string): CashOccurrenceOption[] {
  return occurrences.filter((occurrence) => occurrence.data === operationalDay
    && (occurrence.status === 'PROGRAMADA' || occurrence.status === 'ABERTA'));
}

export function cashOccurrenceSelectionIsEligible(
  occurrences: CashOccurrenceOption[],
  occurrenceId: string,
  operationalDay: string,
): boolean {
  return eligibleCashOccurrences(occurrences, operationalDay).some((occurrence) => occurrence.id === occurrenceId);
}
