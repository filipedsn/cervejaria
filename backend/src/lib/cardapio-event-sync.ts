import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/** Keeps open, template-linked event menus aligned with their saved template. */
export async function syncOpenEventsWithCardapio(
  tx: Prisma.TransactionClient,
  params: { cardapioId: string; cervejariaId: string; produtoIds: string[] },
) {
  const eventos = await tx.evento.findMany({
    where: {
      cardapioId: params.cardapioId,
      cervejariaId: params.cervejariaId,
      recorrencia: 'NENHUMA',
      status: 'ABERTO',
    },
    select: { id: true },
  });
  const eventoIds = eventos.map((evento) => evento.id);
  if (eventoIds.length === 0) return;

  await tx.eventoProduto.deleteMany({ where: { eventoId: { in: eventoIds } } });
  if (params.produtoIds.length > 0) {
    await tx.eventoProduto.createMany({
      data: eventoIds.flatMap((eventoId) => params.produtoIds.map((produtoId) => ({ eventoId, produtoId }))),
      skipDuplicates: true,
    });
  }
}

export async function listOpenEventsUsingCardapio(cardapioId: string, cervejariaId: string) {
  return prisma.evento.findMany({
    where: { cardapioId, cervejariaId, recorrencia: 'NENHUMA', status: 'ABERTO' },
    select: { id: true },
  });
}
