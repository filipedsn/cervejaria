import type { Prisma } from '@prisma/client';
import { isBebidaChope } from './produto-utils.js';
import { toNumber } from './utils.js';
import { itemContaNaVendaLiquida } from './venda-liquida.js';

type ItemWithProduto = {
  volumeMl: number;
  quantidade: number;
  canceladoEm?: unknown;
  cancelamentoPendenteEm?: unknown;
  produto: { tipo: string; formato: string | null } | null;
};

export function computeChopeMlFromItens(itens: ItemWithProduto[]): number {
  let totalMl = 0;
  for (const item of itens) {
    if (item.produto && itemContaNaVendaLiquida(item) && isBebidaChope(item.produto.tipo, item.produto.formato)) {
      totalMl += item.volumeMl * item.quantidade;
    }
  }
  return totalMl;
}

type TxClient = Prisma.TransactionClient;

type ComandaStats = {
  total: unknown;
  fechadaEm: Date | null;
  updatedAt: Date;
  pagamentos: Array<{ valor: unknown }>;
  itens: ItemWithProduto[];
};

export function calcularEstatisticasCliente(comandas: ComandaStats[]) {
  const visitas = comandas.map((comanda) => comanda.fechadaEm ?? comanda.updatedAt);
  const recebidas = comandas.flatMap((comanda) => {
    const valorPago = comanda.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0);
    return valorPago > 0 ? [{ comanda, valorPago }] : [];
  });

  return {
    totalComandasFechadas: comandas.length,
    totalGasto: recebidas.reduce((soma, item) => soma + item.valorPago, 0),
    totalMlChope: comandas.reduce((soma, comanda) => soma + computeChopeMlFromItens(comanda.itens), 0),
    primeiraVisitaEm: visitas.length ? new Date(Math.min(...visitas.map((data) => data.getTime()))) : null,
    ultimaVisitaEm: visitas.length ? new Date(Math.max(...visitas.map((data) => data.getTime()))) : null,
  };
}

export async function recalculateClienteStats(tx: TxClient, clienteId: string) {
  const comandas = await tx.comanda.findMany({
    where: { clienteId, status: 'FECHADA', tipo: { not: 'AVULSA' } },
    include: {
      pagamentos: { select: { valor: true } },
      itens: { include: { produto: true } },
    },
  });
  const stats = calcularEstatisticasCliente(comandas);

  await tx.clienteEstatisticas.upsert({
    where: { clienteId },
    create: {
      clienteId,
      ...stats,
    },
    update: stats,
  });
}
