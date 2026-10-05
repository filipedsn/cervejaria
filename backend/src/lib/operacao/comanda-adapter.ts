import type { Prisma } from '@prisma/client';
import {
  fecharComandaComPagamentos,
  type PagamentoInput,
} from '../fechar-comanda.js';
import { calcularFinanceiroComanda } from './venda.js';
import { toNumber } from '../utils.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../canonical-pdv-operational-config.js';

export const INCLUDE_COMANDA_OPERACAO = {
  pontoVenda: { select: { configuracaoPdv: { select: { kitchenItemsChargeAtLaunch: true } }, cervejaria: { select: { configuracaoOperacional: { select: { kitchenItemsChargeAtLaunch: true } } } } } },
  evento: { select: { cervejaria: { select: { configuracaoOperacional: { select: { kitchenItemsChargeAtLaunch: true } } } } } },
  pedidosOperacao: {
    include: { itensComanda: { include: { opcionais: true } } },
    orderBy: { numero: 'asc' as const },
  },
  itens: {
    orderBy: { createdAt: 'asc' as const },
    include: { produto: true, opcionais: true },
  },
  pagamentos: { orderBy: { pagoEm: 'asc' as const } },
  contaReceber: { include: { pagamentos: true } },
  cliente: { select: { id: true, nome: true, telefone: true } },
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
  options: { kitchenItemsChargeAtLaunch?: boolean } = {},
) {
  const comanda = await tx.comanda.findUnique({
    where: { id: comandaId },
    select: {
      status: true,
      total: true,
      desconto: true,
      evento: { select: { cervejariaId: true } },
      pontoVenda: { select: { cervejariaId: true } },
    },
  });
  const cervejariaId = comanda?.evento?.cervejariaId ?? comanda?.pontoVenda?.cervejariaId;
  const canonicalSettings = cervejariaId
    ? await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId, tx)
    : null;
  const [pedidos, itensSemPedido, configuration] = await Promise.all([
    tx.pedidoOperacao.findMany({
      where: { comandaId },
      select: {
        status: true,
        itensComanda: {
          select: { precoUnit: true, quantidade: true, exigePreparo: true, cancelamentoPendenteEm: true, canceladoEm: true },
        },
      },
    }),
    tx.itemComanda.findMany({
      where: { comandaId, pedidoCozinhaId: null },
      select: { precoUnit: true, quantidade: true, exigePreparo: true, cancelamentoPendenteEm: true, canceladoEm: true },
    }),
    canonicalSettings
      ? Promise.resolve(null)
      : cervejariaId
      ? tx.configuracaoOperacional.findUnique({ where: { cervejariaId }, select: { kitchenItemsChargeAtLaunch: true } })
      : Promise.resolve(null),
  ]);
  const financeiro = calcularFinanceiroComanda({
    status: comanda?.status ?? 'ABERTA',
    totalPersistido: comanda?.total,
    desconto: comanda?.desconto,
    kitchenItemsChargeAtLaunch: options.kitchenItemsChargeAtLaunch ?? canonicalSettings?.kitchenItemsChargeAtLaunch ?? configuration?.kitchenItemsChargeAtLaunch ?? false,
    itensSemPedido,
    pedidos: pedidos.map((pedido) => ({ status: pedido.status, itens: pedido.itensComanda })),
  });
  const total = financeiro.total / 100;
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
    sessaoCaixaId?: string;
    deixarPendente?: boolean;
    kitchenItemsChargeAtLaunch?: boolean;
  },
) {
  // O total pode estar desatualizado em comandas cujos pedidos foram entregues
  // antes do recálculo ser executado no fluxo da cozinha.
  await recalcComandaTotalOperacao(tx, params.comanda.id, {
    kitchenItemsChargeAtLaunch: params.kitchenItemsChargeAtLaunch,
  });

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
    sessaoCaixaId: params.sessaoCaixaId,
    deixarPendente: params.deixarPendente,
  });
}
