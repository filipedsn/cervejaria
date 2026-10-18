import type { Prisma } from '@prisma/client';

/** Debt settlements made outside the turn for comandas that belong to it (informational only). */
export function sumDebtSettledAfterTurn(
  sessaoId: string,
  comandas: Array<{ pagamentos: Array<{ valor: unknown; sessaoCaixaId: string | null; contaReceberId: string | null }> }>,
): number {
  let totalCents = 0;
  for (const comanda of comandas) {
    for (const pagamento of comanda.pagamentos) {
      if (pagamento.contaReceberId === null || pagamento.sessaoCaixaId === sessaoId) continue;
      totalCents += Math.round(Number(pagamento.valor ?? 0) * 100);
    }
  }
  return totalCents / 100;
}

/** Open receivables filter; with `periodo`, only debts whose comanda closed in that window. */
export function contasPendentesWhere(
  cervejariaId: string,
  pontoVendaId: string | undefined,
  canonicalPdvEnabled: boolean,
  periodo?: { inicio: Date; fim: Date },
): Prisma.ContaReceberWhereInput {
  return {
    cliente: { cervejariaId },
    comanda: {
      ...(canonicalPdvEnabled
        ? { origem: { in: ['CAIXA', 'EVENTO'] }, pontoVendaId: { not: null }, pontoVenda: { cervejariaId } }
        : { origem: 'CAIXA' }),
      status: 'FECHADA',
      ...(pontoVendaId ? { pontoVendaId } : {}),
      ...(periodo ? { fechadaEm: { gte: periodo.inicio, lte: periodo.fim } } : {}),
    },
  };
}
