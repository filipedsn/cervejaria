import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import {
  aplicarStatusPedidoCozinha,
  notificarComandaQuiosqueAtualizada,
  notificarCozinha,
  pedidoVaiParaCozinha,
} from './cozinha.js';
import { EstoqueInvalidoError, baixarEstoqueItemPedido, estornarEstoqueItemPedido } from './estoque.js';
import { centavos, reais, resumoComanda, subtotalComandaEmCentavos } from './venda.js';
import {
  INCLUDE_COMANDA_QUIOSQUE,
  recalcComandaTotalQuiosque,
  whereComandaQuiosque,
} from './comanda-adapter.js';
import { lockComandaItemsInTx } from '../comanda-service.js';

type ComandaCompleta = Prisma.ComandaGetPayload<{ include: typeof INCLUDE_COMANDA_QUIOSQUE }>;

async function ajustarDescontoSeNecessario(tx: Prisma.TransactionClient, comanda: ComandaCompleta) {
  const subtotalEmCents = subtotalComandaEmCentavos(comanda);
  const descontoEmCents = centavos(toNumber(comanda.desconto ?? 0));
  if (descontoEmCents <= subtotalEmCents) return;

  await tx.comanda.update({
    where: { id: comanda.id },
    data: { desconto: reais(subtotalEmCents) },
  });
}

async function cancelarPedidoSeVazio(tx: Prisma.TransactionClient, pedidoId: string) {
  const pedido = await tx.pedidoQuiosque.findUnique({
    where: { id: pedidoId },
    include: { itensComanda: true },
  });
  if (!pedido || pedido.itensComanda.length > 0 || pedido.status === 'CANCELADO') return pedido;

  return aplicarStatusPedidoCozinha(tx, pedido, 'CANCELADO');
}

async function carregarItem(
  client: typeof prisma | Prisma.TransactionClient,
  comandaId: string,
  itemId: string,
  cervejariaId: string,
) {
  return client.itemComanda.findFirst({
    where: {
      id: itemId,
      comandaId,
      comanda: whereComandaQuiosque(cervejariaId),
    },
    include: {
      produto: true,
      pedidoCozinha: {
        include: {
          comanda: { include: INCLUDE_COMANDA_QUIOSQUE },
        },
      },
    },
  });
}

async function notificarMudancaCozinha(
  app: FastifyInstance,
  cervejariaId: string,
  temCozinha: boolean,
  pedidoId: string,
) {
  if (!temCozinha) return;

  const pedido = await prisma.pedidoQuiosque.findUnique({
    where: { id: pedidoId },
    include: {
      itensComanda: true,
      comanda: { select: { id: true, tipo: true, identificador: true, numero: true } },
    },
  });
  if (pedido && pedidoVaiParaCozinha(pedido.itensComanda)) {
    notificarCozinha(app, cervejariaId, pedido, false);
  }
}

export async function removeItemFromComandaQuiosque(params: {
  app: FastifyInstance;
  cervejariaId: string;
  comandaId: string;
  itemId: string;
  registradoPorId: string;
  moduloControlaEstoque: boolean;
  temCozinha: boolean;
}) {
  const item = await carregarItem(prisma, params.comandaId, params.itemId, params.cervejariaId);
  if (!item || !item.pedidoCozinha) return { error: 'Item não encontrado' as const };

  const comanda = item.pedidoCozinha.comanda;
  if (comanda.status !== 'ABERTA') {
    return { error: 'Comanda não encontrada ou fechada' as const };
  }
  if (item.pedidoCozinha.status === 'CANCELADO') {
    return { error: 'Este pedido já foi cancelado' as const };
  }

  const pedidoId = item.pedidoCozinhaId!;

  const atualizada = await prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const itemAtual = await carregarItem(tx, params.comandaId, params.itemId, params.cervejariaId);
    if (!itemAtual || !itemAtual.pedidoCozinha) {
      throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
    }
    if (itemAtual.pedidoCozinha.comanda.status !== 'ABERTA') {
      throw Object.assign(new Error('Comanda não encontrada ou fechada'), { statusCode: 409 });
    }
    if (itemAtual.pedidoCozinha.status === 'CANCELADO') {
      throw Object.assign(new Error('Este pedido já foi cancelado'), { statusCode: 409 });
    }

    if (itemAtual.produto) {
      await estornarEstoqueItemPedido(tx, {
        moduloControlaEstoque: params.moduloControlaEstoque,
        cervejariaId: params.cervejariaId,
        pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId,
        pedidoId,
        produtoId: itemAtual.produto.id,
        nome: itemAtual.nome ?? itemAtual.produto.nome,
        quantidade: itemAtual.quantidade,
        controlaEstoque: itemAtual.produto.controlaEstoque,
        registradoPorId: params.registradoPorId,
      });
    }

    await tx.itemComanda.delete({ where: { id: itemAtual.id } });
    await cancelarPedidoSeVazio(tx, pedidoId);

    const comandaFresh = await tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
    await ajustarDescontoSeNecessario(tx, comandaFresh);
    await recalcComandaTotalQuiosque(tx, params.comandaId);

    return tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
  });

  notificarComandaQuiosqueAtualizada(params.app, params.cervejariaId, params.comandaId);
  await notificarMudancaCozinha(params.app, params.cervejariaId, params.temCozinha, pedidoId);

  return { ok: true as const, comanda: resumoComanda(atualizada), item };
}

export async function updateItemQuantidadeComandaQuiosque(params: {
  app: FastifyInstance;
  cervejariaId: string;
  comandaId: string;
  itemId: string;
  quantidade: number;
  registradoPorId: string;
  moduloControlaEstoque: boolean;
  temCozinha: boolean;
}) {
  if (!Number.isInteger(params.quantidade) || params.quantidade < 1) {
    return { error: 'Informe uma quantidade válida' as const };
  }

  const item = await carregarItem(prisma, params.comandaId, params.itemId, params.cervejariaId);
  if (!item || !item.pedidoCozinha) return { error: 'Item não encontrado' as const };

  const comanda = item.pedidoCozinha.comanda;
  if (comanda.status !== 'ABERTA') {
    return { error: 'Comanda não encontrada ou fechada' as const };
  }
  if (item.pedidoCozinha.status === 'CANCELADO') {
    return { error: 'Este pedido já foi cancelado' as const };
  }

  const delta = params.quantidade - item.quantidade;
  if (delta === 0) {
    return { ok: true as const, comanda: resumoComanda(comanda), item };
  }

  const pedidoId = item.pedidoCozinhaId!;

  try {
    const atualizada = await prisma.$transaction(async (tx) => {
      await lockComandaItemsInTx(tx, params.comandaId);
      const itemAtual = await carregarItem(tx, params.comandaId, params.itemId, params.cervejariaId);
      if (!itemAtual || !itemAtual.pedidoCozinha) {
        throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
      }
      if (itemAtual.pedidoCozinha.comanda.status !== 'ABERTA') {
        throw Object.assign(new Error('Comanda não encontrada ou fechada'), { statusCode: 409 });
      }
      if (itemAtual.pedidoCozinha.status === 'CANCELADO') {
        throw Object.assign(new Error('Este pedido já foi cancelado'), { statusCode: 409 });
      }

      const deltaAtual = params.quantidade - itemAtual.quantidade;
      if (itemAtual.produto) {
        if (deltaAtual > 0) {
          await baixarEstoqueItemPedido(tx, {
            moduloControlaEstoque: params.moduloControlaEstoque,
            cervejariaId: params.cervejariaId,
            pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId,
            pedidoId,
            produtoId: itemAtual.produto.id,
            nome: itemAtual.nome ?? itemAtual.produto.nome,
            quantidade: deltaAtual,
            controlaEstoque: itemAtual.produto.controlaEstoque,
            registradoPorId: params.registradoPorId,
          });
        } else {
          await estornarEstoqueItemPedido(tx, {
            moduloControlaEstoque: params.moduloControlaEstoque,
            cervejariaId: params.cervejariaId,
            pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId,
            pedidoId,
            produtoId: itemAtual.produto.id,
            nome: itemAtual.nome ?? itemAtual.produto.nome,
            quantidade: -deltaAtual,
            controlaEstoque: itemAtual.produto.controlaEstoque,
            registradoPorId: params.registradoPorId,
          });
        }
      }

      await tx.itemComanda.update({
        where: { id: itemAtual.id },
        data: { quantidade: params.quantidade },
      });

      const comandaFresh = await tx.comanda.findUniqueOrThrow({
        where: { id: params.comandaId },
        include: INCLUDE_COMANDA_QUIOSQUE,
      });
      await ajustarDescontoSeNecessario(tx, comandaFresh);
      await recalcComandaTotalQuiosque(tx, params.comandaId);

      return tx.comanda.findUniqueOrThrow({
        where: { id: params.comandaId },
        include: INCLUDE_COMANDA_QUIOSQUE,
      });
    });

    notificarComandaQuiosqueAtualizada(params.app, params.cervejariaId, params.comandaId);
    await notificarMudancaCozinha(params.app, params.cervejariaId, params.temCozinha, pedidoId);

    return { ok: true as const, comanda: resumoComanda(atualizada), item };
  } catch (err) {
    if (err instanceof EstoqueInvalidoError) {
      return { error: err.message };
    }
    throw err;
  }
}
