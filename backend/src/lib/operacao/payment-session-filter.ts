import type { Prisma } from '@prisma/client';

type OperationalSessionWindow = {
  id: string;
  pontoVendaId: string;
  diaOperacional: Date;
  abertoEm: Date;
  fechadoEm: Date | null;
  status: string;
  tipoEncerramento?: 'FINANCEIRO' | 'ADMINISTRATIVO' | null;
};

/** Keep the historical interval fallback only while canonical PDV is disabled. */
export function paymentFilterForOperationalSession(
  session: OperationalSessionWindow,
  tenantId: string,
  canonicalPdvEnabled: boolean,
): Prisma.PagamentoWhereInput {
  const exactSession: Prisma.PagamentoWhereInput = {
    sessaoCaixaId: session.id,
    comanda: { origem: 'CAIXA', pontoVenda: { cervejariaId: tenantId } },
  };
  if (canonicalPdvEnabled) return {
    sessaoCaixaId: session.id,
    comanda: {
      pontoVendaId: session.pontoVendaId,
      pontoVenda: { cervejariaId: tenantId },
      OR: [
        { origem: 'CAIXA', eventoId: null },
        { origem: 'EVENTO', evento: { cervejariaId: tenantId } },
      ],
    },
  };
  // Administrative closure does not establish a financial interval. Only
  // payments with an explicit session link may be included in its projection.
  if (session.status === 'FECHADO' && session.tipoEncerramento === 'ADMINISTRATIVO') {
    return exactSession;
  }
  const closedAt = session.status === 'FECHADO' && session.fechadoEm ? session.fechadoEm : undefined;
  const legacyWindow: Prisma.PagamentoWhereInput = {
    sessaoCaixaId: null,
    contaReceberId: null,
    comanda: {
      origem: 'CAIXA',
      pontoVenda: { cervejariaId: tenantId },
      pontoVendaId: session.pontoVendaId,
      diaOperacional: session.diaOperacional,
      status: 'FECHADA',
      fechadaEm: { gte: session.abertoEm, ...(closedAt ? { lte: closedAt } : {}) },
    },
  };
  return { OR: [exactSession, legacyWindow] };
}
