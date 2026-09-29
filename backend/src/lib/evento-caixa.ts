import type { PaymentMethod, Prisma, TipoMovimentoCaixaEvento } from '@prisma/client';
import { prisma } from './prisma.js';

export const FORMAS_CAIXA_EVENTO = ['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO'] as const;
export type FormaCaixaEvento = (typeof FORMAS_CAIXA_EVENTO)[number];

const emptyTotals = () => ({ DINHEIRO: 0, PIX: 0, CARTAO: 0, CARTAO_DEBITO: 0, CARTAO_CREDITO: 0 });

type EventoCashSession = {
  id: string;
  eventoId: string;
  status: 'ABERTO' | 'FECHADO';
  trocoInicial: unknown;
  abertoEm: Date;
  fechadoEm: Date | null;
  contadoDinheiro: unknown;
  contadoPix: unknown;
  contadoDebito: unknown;
  contadoCredito: unknown;
  contadoCartao: unknown;
  observacaoFechamento: string | null;
  movimentos: Array<{ id: string; tipo: TipoMovimentoCaixaEvento; valor: unknown; observacao: string | null; createdAt: Date }>;
  pagamentos: Array<{ forma: PaymentMethod; valor: unknown }>;
};

export function resumoCaixaEvento(session: EventoCashSession | null) {
  if (!session) return null;
  const recebidos = emptyTotals();
  for (const pagamento of session.pagamentos) {
    if (pagamento.forma in recebidos) {
      recebidos[pagamento.forma as FormaCaixaEvento] += Number(pagamento.valor);
    }
  }

  const suprimentos = session.movimentos
    .filter((movimento) => movimento.tipo === 'SUPRIMENTO')
    .reduce((total, movimento) => total + Number(movimento.valor), 0);
  const sangrias = session.movimentos
    .filter((movimento) => movimento.tipo === 'SANGRIA')
    .reduce((total, movimento) => total + Number(movimento.valor), 0);
  const esperado = {
    DINHEIRO: Number(session.trocoInicial) + recebidos.DINHEIRO + suprimentos - sangrias,
    PIX: recebidos.PIX,
    CARTAO_DEBITO: recebidos.CARTAO_DEBITO,
    CARTAO_CREDITO: recebidos.CARTAO_CREDITO,
    CARTAO: recebidos.CARTAO,
  };
  const contado = session.status === 'FECHADO' ? {
    DINHEIRO: Number(session.contadoDinheiro ?? 0),
    PIX: Number(session.contadoPix ?? 0),
    CARTAO_DEBITO: Number(session.contadoDebito ?? 0),
    CARTAO_CREDITO: Number(session.contadoCredito ?? 0),
    CARTAO: Number(session.contadoCartao ?? 0),
  } : null;
  const divergencia = contado ? {
    DINHEIRO: contado.DINHEIRO - esperado.DINHEIRO,
    PIX: contado.PIX - esperado.PIX,
    CARTAO_DEBITO: contado.CARTAO_DEBITO - esperado.CARTAO_DEBITO,
    CARTAO_CREDITO: contado.CARTAO_CREDITO - esperado.CARTAO_CREDITO,
    CARTAO: contado.CARTAO - esperado.CARTAO,
  } : null;

  return {
    ...session,
    trocoInicial: Number(session.trocoInicial),
    recebidos,
    suprimentos,
    sangrias,
    esperado,
    contado,
    divergencia,
    movimentos: session.movimentos.map((movimento) => ({ ...movimento, valor: Number(movimento.valor) })),
  };
}

export const eventoCaixaInclude = {
  movimentos: { orderBy: { createdAt: 'desc' as const } },
  pagamentos: { select: { forma: true, valor: true } },
};

export type EventoCaixaTx = Prisma.TransactionClient | typeof prisma;

export async function obterCaixaAtualEvento(eventoId: string, db: EventoCaixaTx = prisma) {
  return db.sessaoCaixaEvento.findFirst({
    where: { eventoId, status: 'ABERTO' },
    include: eventoCaixaInclude,
    orderBy: { abertoEm: 'desc' },
  });
}

export async function bloquearCaixaEvento(tx: Prisma.TransactionClient, eventoId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${`caixa-evento:${eventoId}`})))`;
}
