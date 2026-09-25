import type { FastifyInstance } from 'fastify';
import type { Prisma, StatusPedidoQuiosque, ComandaTipo } from '@prisma/client';
import { prisma } from '../prisma.js';
import { emitToCervejaria } from '../realtime.js';
import { toNumber } from '../utils.js';

type TxClient = Prisma.TransactionClient;

/** Pedidos que ainda ocupam a fila da cozinha. */
export const STATUS_NA_FILA: StatusPedidoQuiosque[] = ['RECEBIDO', 'EM_PREPARO', 'PRONTO'];

/**
 * A fila operacional não pode abandonar um pedido pendente na troca de dia.
 * Já os entregues são histórico de turno e ficam limitados ao dia atual.
 */
export function filtroListaPedidosCozinha(
  incluirEntregues: boolean,
  diaAtual: Date,
): Prisma.PedidoQuiosqueWhereInput {
  if (!incluirEntregues) return { status: { in: STATUS_NA_FILA } };

  return {
    OR: [
      { status: { in: STATUS_NA_FILA } },
      { status: 'ENTREGUE', diaOperacional: diaAtual },
    ],
  };
}

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
  itensComanda: true,
  comanda: { select: { id: true, tipo: true, identificador: true, numero: true } },
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
    statusDesde: pedido.statusDesde,
    entregueEm: pedido.entregueEm,
    comanda: {
      id: pedido.comanda.id,
      tipo: pedido.comanda.tipo,
      identificador: pedido.comanda.identificador,
      numero: pedido.comanda.numero,
    },
    itens: pedido.itensComanda
      .filter((item) => item.exigePreparo)
      .map((item) => ({
        id: item.id,
        nome: item.nome ?? '',
        quantidade: item.quantidade,
        precoUnit: toNumber(item.precoUnit),
      })),
  };
}

/** Registra a transicao e reinicia statusDesde; entregueEm congela o cronometro total. */
export async function registrarHistoricoStatusPedido(
  tx: TxClient,
  pedidoId: string,
  status: StatusPedidoQuiosque,
  registradoEm = new Date(),
) {
  await tx.pedidoQuiosqueStatusHistorico.create({
    data: { pedidoId, status, registradoEm },
  });
}

/** A linha foi alterada por outra transição depois da leitura que a originou. */
export class StatusPedidoCozinhaDesatualizadoError extends Error {
  statusCode = 409;

  constructor() {
    super('O status do pedido foi alterado por outra operação. Atualize a fila e tente novamente.');
    this.name = 'StatusPedidoCozinhaDesatualizadoError';
  }
}

export async function aplicarStatusPedidoCozinha(
  tx: TxClient,
  pedido: { id: string; status: StatusPedidoQuiosque },
  novoStatus: StatusPedidoQuiosque,
  agora = new Date(),
) {
  // A comparação no WHERE é o controle otimista: uma leitura anterior não
  // autoriza sobrescrever a transição que já venceu a corrida.
  const resultado = await tx.pedidoQuiosque.updateMany({
    where: { id: pedido.id, status: pedido.status },
    data: {
      status: novoStatus,
      statusDesde: agora,
      entregueEm:
        novoStatus === 'ENTREGUE'
          ? agora
          : pedido.status === 'ENTREGUE'
            ? null
            : undefined,
    },
  });

  if (resultado.count !== 1) throw new StatusPedidoCozinhaDesatualizadoError();

  await registrarHistoricoStatusPedido(tx, pedido.id, novoStatus, agora);

  return tx.pedidoQuiosque.findUniqueOrThrow({
    where: { id: pedido.id },
    include: INCLUDE_PEDIDO_COZINHA,
  });
}

export function pedidoVaiParaCozinha(itens: Array<{ exigePreparo: boolean }>): boolean {
  return itens.some((item) => item.exigePreparo);
}

/** Itens cancelados não entram no total; demais contam ao ser lançados. */
export function pedidoContaNaComanda(
  pedido: {
    status: StatusPedidoQuiosque;
    itens: Array<{ exigePreparo: boolean }>;
  },
  _comanda?: { tipo: ComandaTipo },
): boolean {
  if (pedido.status === 'CANCELADO') return false;
  return true;
}

export function temPedidoCozinhaPendente(
  pedidos: Array<{ status: StatusPedidoQuiosque; itens?: Array<{ exigePreparo: boolean }>; itensComanda?: Array<{ exigePreparo: boolean }> }>,
): boolean {
  return pedidos.some((pedido) => {
    const itens = pedido.itensComanda ?? pedido.itens ?? [];
    return pedidoVaiParaCozinha(itens) && STATUS_NA_FILA.includes(pedido.status);
  });
}

export function notificarComandaQuiosqueAtualizada(
  app: FastifyInstance,
  cervejariaId: string,
  comandaId: string,
) {
  emitToCervejaria(app.io, cervejariaId, {
    type: 'quiosque:comanda-atualizada',
    data: { comandaId },
  });
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
  if (!pedidoVaiParaCozinha(pedido.itensComanda)) return;

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
  pedido: { id: string; itensComanda: Array<{ exigePreparo: boolean }> },
) {
  if (!pedidoVaiParaCozinha(pedido.itensComanda)) return;

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
