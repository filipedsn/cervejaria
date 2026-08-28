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

export async function incrementClienteStatsOnComandaFechada(
  tx: TxClient,
  params: {
    clienteId: string;
    totalGasto: number;
    totalMlChope: number;
    fechadoEm: Date;
  },
) {
  const existing = await tx.clienteEstatisticas.findUnique({
    where: { clienteId: params.clienteId },
  });

  if (!existing) {
    await tx.clienteEstatisticas.create({
      data: {
        clienteId: params.clienteId,
        totalComandasFechadas: 1,
        totalGasto: params.totalGasto,
        totalMlChope: params.totalMlChope,
        primeiraVisitaEm: params.fechadoEm,
        ultimaVisitaEm: params.fechadoEm,
      },
    });
    return;
  }

  await tx.clienteEstatisticas.update({
    where: { clienteId: params.clienteId },
    data: {
      totalComandasFechadas: { increment: 1 },
      totalGasto: { increment: params.totalGasto },
      totalMlChope: { increment: params.totalMlChope },
      primeiraVisitaEm: existing.primeiraVisitaEm ?? params.fechadoEm,
      ultimaVisitaEm: params.fechadoEm,
    },
  });
}

export async function recalculateClienteStats(tx: TxClient, clienteId: string) {
  const comandas = await tx.comanda.findMany({
    where: { clienteId, status: 'FECHADA', tipo: 'COMANDA' },
    include: {
      itens: { include: { produto: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  let totalComandasFechadas = 0;
  let totalGasto = 0;
  let totalMlChope = 0;
  let primeiraVisitaEm: Date | null = null;
  let ultimaVisitaEm: Date | null = null;

  for (const comanda of comandas) {
    totalComandasFechadas += 1;
    totalGasto += toNumber(comanda.total);
    totalMlChope += computeChopeMlFromItens(comanda.itens);
    const visitaEm = comanda.updatedAt;
    if (!primeiraVisitaEm || visitaEm < primeiraVisitaEm) primeiraVisitaEm = visitaEm;
    if (!ultimaVisitaEm || visitaEm > ultimaVisitaEm) ultimaVisitaEm = visitaEm;
  }

  await tx.clienteEstatisticas.upsert({
    where: { clienteId },
    create: {
      clienteId,
      totalComandasFechadas,
      totalGasto,
      totalMlChope,
      primeiraVisitaEm,
      ultimaVisitaEm,
    },
    update: {
      totalComandasFechadas,
      totalGasto,
      totalMlChope,
      primeiraVisitaEm,
      ultimaVisitaEm,
    },
  });
}
