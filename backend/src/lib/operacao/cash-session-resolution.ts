export class ActiveCashSessionConflictError extends Error {
  statusCode = 409;

  constructor() {
    super('Ha mais de uma sessao de caixa aberta neste ponto. Nenhum turno foi selecionado; regularize a inconsistencia antes de continuar.');
  }
}

export function resolveUniqueOpenCashSession<T>(sessions: readonly T[]): T | null {
  if (sessions.length > 1) throw new ActiveCashSessionConflictError();
  return sessions[0] ?? null;
}
