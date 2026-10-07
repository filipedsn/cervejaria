import type { Prisma } from '@prisma/client';
import { canonicalPdvQaActivationEnabled } from '../canonical-pdv-operational-config.js';

export class CashOccurrenceContextError extends Error {
  readonly statusCode = 409;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CashOccurrenceContextError';
  }
}

/** Only the guarded canonical QA path reads the additive occurrence table. */
export function cashOccurrenceContextEnabled(): boolean {
  return canonicalPdvQaActivationEnabled();
}

export async function validateCashOccurrenceSelection(
  tx: Pick<Prisma.TransactionClient, 'ocorrenciaOperacional'>,
  params: { cervejariaId: string; pontoVendaId: string; ocorrenciaId?: string | null; diaOperacional: Date; confirmarDataDiferente?: boolean },
): Promise<string | null | undefined> {
  const enabled = cashOccurrenceContextEnabled();
  if (!enabled) {
    if (params.ocorrenciaId) {
      throw new CashOccurrenceContextError(
        'CASH_OCCURRENCE_CONTEXT_DISABLED',
        'Seleção de ocorrência exige a ativação da configuração canônica do PDV.',
      );
    }
    return undefined;
  }

  if (!params.ocorrenciaId) return null;
  const occurrence = await tx.ocorrenciaOperacional.findFirst({
    where: {
      id: params.ocorrenciaId,
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
    },
    select: { id: true, data: true, status: true },
  });
  if (!occurrence) {
    throw new CashOccurrenceContextError(
      'CASH_OCCURRENCE_SCOPE_MISMATCH',
      'A ocorrência selecionada não pertence ao tenant e PDV desta sessão.',
    );
  }
  if (occurrence.status !== 'PROGRAMADA' && occurrence.status !== 'ABERTA') {
    throw new CashOccurrenceContextError(
      'CASH_OCCURRENCE_STATUS_NOT_SELECTABLE',
      'Somente ocorrências programadas ou abertas podem ser associadas a um novo caixa.',
    );
  }
  const occurrenceDate = occurrence.data.toISOString().slice(0, 10);
  const operationalDate = params.diaOperacional.toISOString().slice(0, 10);
  if (occurrenceDate !== operationalDate && params.confirmarDataDiferente !== true) {
    throw new CashOccurrenceContextError(
      'CASH_OCCURRENCE_DATE_CONFIRMATION_REQUIRED',
      'Confirme explicitamente a abertura do caixa em uma data diferente da ocorrência.',
    );
  }
  return occurrence.id;
}

export function assertCommandOccurrenceMatchesSession(
  command: { ocorrenciaId?: string | null },
  session: { ocorrenciaId?: string | null },
): void {
  if (!cashOccurrenceContextEnabled()) return;
  if ((command.ocorrenciaId ?? null) !== (session.ocorrenciaId ?? null)) {
    throw new CashOccurrenceContextError(
      'CASH_OCCURRENCE_COMMAND_CONTEXT_MISMATCH',
      'A comanda pertence a outro contexto de ocorrência e não pode receber novos consumos nesta sessão.',
    );
  }
}
