import type { Prisma } from '@prisma/client';
import {
  fecharComandaComPagamentos,
  type PagamentoInput,
} from '../fechar-comanda.js';
import { centavos } from './venda.js';
import { toNumber } from '../utils.js';

export const INCLUDE_COMANDA_OPERACAO = {
  pedidosOperacao: {
    include: { itensComanda: true },
    orderBy: { numero: 'asc' as const },
  },
  itens: {
    orderBy: { createdAt: 'asc' as const },
    include: { produto: true },
  },
  pagamentos: { orderBy: { pagoEm: 'asc' as const } },
} satisfies Prisma.ComandaInclude;

export type ComandaOperacaoCompleta = Prisma.ComandaGetPayload<{
  include: typeof INCLUDE_COMANDA_OPERACAO;
}>;

export function whereComandaOperacao(
  cervejariaId: string,
  extra?: Prisma.ComandaWhereInput,
): Prisma.ComandaWhereInput {
  return {
    origem: 'CAIXA',
    pontoVenda: { cervejariaId },
    ...extra,
  };
}

export async function recalcComandaTotalOperacao(
  tx: Prisma.TransactionClient,
  comandaId: string,
) {
  const comanda = await tx.comanda.findUnique({
    where: { id: comandaId },
    select: { desconto: true },
  });
  const itens = await tx.itemComanda.findMany({ where: { comandaId } });
  const subtotal = itens.reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
  const total = Math.max(0, subtotal - toNumber(comanda?.desconto ?? 0));
  await tx.comanda.update({
    where: { id: comandaId },
    data: { total },
  });
  return total;
}

export interface PagamentoOperacaoResolvido extends PagamentoInput {
  valorRecebido?: number;
  troco: number | null;
}

export async function fecharComandaOperacaoInTx(
  tx: Prisma.TransactionClient,
  params: {
    comanda: ComandaOperacaoCompleta;
    pagamentos: PagamentoOperacaoResolvido[];
    cervejariaId: string;
    usuarioId: string;
    fechadaEm: Date;
    grupoPagamentoId?: string;
    comandaIdsGrupo?: string[];
  },
) {
  return fecharComandaComPagamentos(tx, {
    comanda: {
      id: params.comanda.id,
      eventoId: params.comanda.eventoId,
      clienteId: params.comanda.clienteId,
      tipo: params.comanda.tipo,
      total: params.comanda.total,
      desconto: params.comanda.desconto,
      itens: params.comanda.itens.map((item) => ({
        volumeMl: item.volumeMl,
        quantidade: item.quantidade,
        produto: item.produto
          ? { tipo: item.produto.tipo, formato: item.produto.formato }
          : null,
      })),
      origem: 'CAIXA',
    },
    pagamentos: params.pagamentos.map((p) => ({ forma: p.forma, valor: p.valor })),
    cervejariaId: params.cervejariaId,
    usuarioId: params.usuarioId,
    fechadaEm: params.fechadaEm,
    grupoPagamentoId: params.grupoPagamentoId,
    comandaIdsGrupo: params.comandaIdsGrupo,
    origem: 'CAIXA',
    pagamentosDetalhados: params.pagamentos,
  });
}
