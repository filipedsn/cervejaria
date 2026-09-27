import type { Prisma } from '@prisma/client';
import { isBebidaChope } from './produto-utils.js';
import { toNumber } from './utils.js';

type ItemWithProduto = {
  volumeMl: number;
  quantidade: number;
  produto: { tipo: string; formato: string | null } | null;
};

export function computeChopeMlFromItens(itens: ItemWithProduto[]): number {
  let totalMl = 0;
  for (const item of itens) {
    if (item.produto && isBebidaChope(item.produto.tipo, item.produto.formato)) {
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
  const pagas = comandas.flatMap((comanda) => {
    const valorPago = comanda.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0);
    return valorPago > 0 ? [{ comanda, valorPago }] : [];
  });

  const visitas = pagas.map(({ comanda }) => comanda.fechadaEm ?? comanda.updatedAt);
  return {
    totalComandasFechadas: pagas.length,
    totalGasto: pagas.reduce((soma, item) => soma + item.valorPago, 0),
    totalMlChope: pagas.reduce((soma, item) => soma + computeChopeMlFromItens(item.comanda.itens), 0),
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
