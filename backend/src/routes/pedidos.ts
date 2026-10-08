import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { emitToEvento, emitToComanda, emitRankingUpdated } from '../lib/realtime.js';
import {
  addItemToComandaInTx,
  comandaDetailInclude,
  lockComandaItemsInTx,
  pedidoInclude,
  serializePedido,
} from '../lib/comanda-service.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import { isBebidaChope } from '../lib/produto-utils.js';
import { requirePermissao } from '../lib/operacao/permissoes.js';

const recusarSchema = z.object({
  motivo: z.string().min(1).max(300),
});

const confirmarSchema = z.object({
  tapIds: z.record(z.string(), z.string()).optional(),
});

class PedidoConfirmacaoError extends Error {
  constructor(
    message: string,
    readonly itemId?: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export async function pedidosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/eventos/:eventoId/pedidos', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const { status } = z
      .object({ status: z.enum(['PENDENTE', 'CONFIRMADO', 'RECUSADO', 'CANCELADO']).optional() })
      .parse(request.query);

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const pedidos = await prisma.pedidoCliente.findMany({
      where: {
        eventoId,
        ...(status ? { status } : {}),
      },
      include: pedidoInclude,
      orderBy: { createdAt: 'asc' },
    });

    return pedidos.map(serializePedido);
  });

  app.post('/:id/confirmar', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = confirmarSchema.parse(request.body ?? {});

    let confirmed;
    try {
      confirmed = await prisma.$transaction(async (tx) => {
        const claimed = await tx.pedidoCliente.updateMany({
          where: {
            id,
            status: 'PENDENTE',
            evento: { cervejariaId: user.cervejariaId! },
          },
          data: {
            status: 'CONFIRMADO',
            confirmadoPorId: user.sub,
            confirmadoEm: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new PedidoConfirmacaoError('Pedido não encontrado', undefined, 404);
        }

        const pedido = await tx.pedidoCliente.findUniqueOrThrow({
          where: { id },
          include: pedidoInclude,
        });
        await lockComandaItemsInTx(tx, pedido.comandaId);

        const comanda = await tx.comanda.findFirst({
          where: { id: pedido.comandaId, status: 'ABERTA' },
        });
        if (!comanda) {
          throw new PedidoConfirmacaoError('Comanda não está aberta');
        }

        const itensConfirmados = [] as Array<{
          item: (typeof pedido.itens)[number];
          produtoNome: string;
          precoUnit: number;
          isChope: boolean;
        }>;

        for (const item of pedido.itens) {
          const tapId = item.tapId ?? body.tapIds?.[item.id];
          const result = await addItemToComandaInTx(tx, {
            comandaId: pedido.comandaId,
            cervejariaId: user.cervejariaId!,
            eventoId: pedido.eventoId,
            item: {
              produtoId: item.produtoId,
              volumeMl: item.volumeMl,
              quantidade: item.quantidade,
              tapId: tapId ?? undefined,
            },
            criadoPorId: user.sub,
          });
          if ('error' in result) {
            throw new PedidoConfirmacaoError(result.error ?? 'Falha ao adicionar item', item.id);
          }
          itensConfirmados.push({
            item,
            produtoNome: result.produto.nome,
            precoUnit: result.precoUnit,
            isChope: result.isChope,
          });
        }

        const comandaAtualizada = await tx.comanda.findUniqueOrThrow({
          where: { id: pedido.comandaId },
          include: comandaDetailInclude,
        });
        return { pedido, comanda: comandaAtualizada, itensConfirmados };
      });
    } catch (error) {
      if (error instanceof PedidoConfirmacaoError) {
        return reply
          .status(error.statusCode)
          .send({ error: error.message, ...(error.itemId ? { itemId: error.itemId } : {}) });
      }
      throw error;
    }

    const { pedido, comanda: lastComanda, itensConfirmados } = confirmed;
    for (const itemConfirmado of itensConfirmados) {
      await registrarTransacao({
        cervejariaId: user.cervejariaId!,
        tipo: 'COMANDA_ITEM_ADICIONADO',
        usuarioId: user.sub,
        eventoId: pedido.eventoId,
        comandaId: pedido.comandaId,
        entidadeTipo: 'PedidoCliente',
        entidadeId: pedido.id,
        metadata: {
          produtoNome: itemConfirmado.produtoNome,
          volumeMl: itemConfirmado.item.volumeMl,
          quantidade: itemConfirmado.item.quantidade,
          precoUnit: itemConfirmado.precoUnit,
          origem: 'pedido_cliente',
        },
        payload: { pedido, item: itemConfirmado.item, comanda: lastComanda },
      });

      emitToEvento(app.io, pedido.eventoId, { type: 'item:added', data: lastComanda });
      if (itemConfirmado.isChope) {
        emitRankingUpdated(app.io, user.cervejariaId!, pedido.eventoId);
      }
    }

    const updated = pedido;
    const serialized = serializePedido(updated);
    emitToEvento(app.io, pedido.eventoId, { type: 'pedido:confirmed', data: serialized });
    emitToComanda(app.io, pedido.comandaId, { type: 'pedido:confirmed', data: { comandaId: pedido.comandaId } });
    if (lastComanda) {
      emitToComanda(app.io, pedido.comandaId, { type: 'item:added', data: { comandaId: pedido.comandaId } });
    }

    return {
      pedido: serialized,
      comanda: lastComanda,
    };
  });

  app.post('/:id/recusar', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = recusarSchema.parse(request.body);

    const pedido = await prisma.pedidoCliente.findFirst({
      where: {
        id,
        status: 'PENDENTE',
        evento: { cervejariaId: user.cervejariaId },
      },
      include: pedidoInclude,
    });
    if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado' });

    const updated = await prisma.pedidoCliente.update({
      where: { id },
      data: {
        status: 'RECUSADO',
        recusadoMotivo: body.motivo.trim(),
        confirmadoPorId: user.sub,
        confirmadoEm: new Date(),
      },
      include: pedidoInclude,
    });

    const serialized = serializePedido(updated);
    emitToEvento(app.io, pedido.eventoId, { type: 'pedido:recusado', data: serialized });
    emitToComanda(app.io, pedido.comandaId, { type: 'pedido:recusado', data: { comandaId: pedido.comandaId } });

    void registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'PORTAL_PEDIDO_RECUSADO',
      usuarioId: user.sub,
      eventoId: pedido.eventoId,
      comandaId: pedido.comandaId,
      entidadeId: pedido.id,
      metadata: { motivo: body.motivo.trim() },
      payload: serialized,
    });

    return serialized;
  });
}
