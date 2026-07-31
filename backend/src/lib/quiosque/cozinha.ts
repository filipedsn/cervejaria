import type { FastifyInstance } from 'fastify';
import type { Prisma, StatusPedidoQuiosque } from '@prisma/client';
import { prisma } from '../prisma.js';
import { emitToCervejaria } from '../realtime.js';
import { toNumber } from '../utils.js';

/** Pedidos que ainda ocupam a fila da cozinha. */
export const STATUS_NA_FILA: StatusPedidoQuiosque[] = ['RECEBIDO', 'EM_PREPARO', 'PRONTO'];

/**
 * Para onde cada status pode ir. O caminho de volta existe porque na correria a
 * cozinha erra o toque, e obrigar a cancelar o pedido para corrigir seria pior.
 */
export const TRANSICOES: Record<StatusPedidoQuiosque, StatusPedidoQuiosque[]> = {
  RECEBIDO: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'RECEBIDO', 'CANCELADO'],
  PRONTO: ['ENTREGUE', 'EM_PREPARO'],
  ENTREGUE: ['PRONTO'],
  CANCELADO: [],
};

export const INCLUDE_PEDIDO_COZINHA = {
  itens: true,
  comanda: { select: { id: true, tipo: true, identificador: true } },
} as const;

type PedidoCozinha = Prisma.PedidoQuiosqueGetPayload<{
  include: typeof INCLUDE_PEDIDO_COZINHA;
}>;

/**
 * O que a cozinha precisa ver. Itens sem preparo (bebida, gelo) ficam de fora
 * para nao poluir a tela com o que ja saiu direto do balcao.
 */
export function resumoPedidoCozinha(pedido: PedidoCozinha) {
  return {
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    observacao: pedido.observacao,
    createdAt: pedido.createdAt,
    comanda: {
      id: pedido.comanda.id,
      tipo: pedido.comanda.tipo,
      identificador: pedido.comanda.identificador,
    },
    itens: pedido.itens
      .filter((item) => item.exigePreparo)
      .map((item) => ({
        id: item.id,
        nome: item.nome,
        quantidade: item.quantidade,
        precoUnit: toNumber(item.precoUnit),
      })),
  };
}

export function pedidoVaiParaCozinha(itens: Array<{ exigePreparo: boolean }>): boolean {
  return itens.some((item) => item.exigePreparo);
}

/**
 * Avisa as telas de cozinha da empresa. Usa a sala da cervejaria porque o
 * quiosque nao tem evento, que e o recorte de sala do modulo de cervejaria.
 */
export function notificarCozinha(
  app: FastifyInstance,
  cervejariaId: string,
  pedido: PedidoCozinha,
  novo: boolean,
) {
  if (!pedidoVaiParaCozinha(pedido.itens)) return;

  emitToCervejaria(app.io, cervejariaId, {
    type: novo ? 'quiosque:pedido-novo' : 'quiosque:pedido-atualizado',
    data: resumoPedidoCozinha(pedido),
  });
}

/**
 * Anuncia a rodada recem-criada. Chamada depois da transacao: a cozinha so pode
 * ser avisada de um pedido que ja esta gravado.
 */
export async function notificarPedidoNovo(
  app: FastifyInstance,
  cervejariaId: string,
  pedido: { id: string; itens: Array<{ exigePreparo: boolean }> },
) {
  if (!pedidoVaiParaCozinha(pedido.itens)) return;

  const completo = await prisma.pedidoQuiosque.findUnique({
    where: { id: pedido.id },
    include: INCLUDE_PEDIDO_COZINHA,
  });
  if (completo) notificarCozinha(app, cervejariaId, completo, true);
}

/** Reflete na cozinha uma mudanca feita na comanda inteira, como o cancelamento. */
export async function notificarPedidosDaComanda(
  app: FastifyInstance,
  cervejariaId: string,
  comandaId: string,
) {
  const pedidos = await prisma.pedidoQuiosque.findMany({
    where: { comandaId, cervejariaId },
    include: INCLUDE_PEDIDO_COZINHA,
  });
  for (const pedido of pedidos) notificarCozinha(app, cervejariaId, pedido, false);
}
