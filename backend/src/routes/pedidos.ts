import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToEvento, emitToComanda, emitRankingUpdated } from '../lib/realtime.js';
import {
  addItemToComanda,
  pedidoInclude,
  serializePedido,
} from '../lib/comanda-service.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import { isBebidaChope } from '../lib/produto-utils.js';

const recusarSchema = z.object({
  motivo: z.string().min(1).max(300),
});

const confirmarSchema = z.object({
  tapIds: z.record(z.string(), z.string()).optional(),
});

export async function pedidosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/eventos/:eventoId/pedidos', async (request, reply) => {
    const user = getAuthUser(request);
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

  app.post('/:id/confirmar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = confirmarSchema.parse(request.body ?? {});

    const pedido = await prisma.pedidoCliente.findFirst({
      where: {
        id,
        status: 'PENDENTE',
        evento: { cervejariaId: user.cervejariaId },
      },
      include: {
        ...pedidoInclude,
        evento: { select: { id: true, cervejariaId: true } },
      },
    });
    if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado' });

    const comanda = await prisma.comanda.findFirst({
      where: { id: pedido.comandaId, status: 'ABERTA' },
    });
    if (!comanda) return reply.status(400).send({ error: 'Comanda não está aberta' });

    let lastComanda = null;
    for (const item of pedido.itens) {
      const tapId = item.tapId ?? body.tapIds?.[item.id];
      const result = await addItemToComanda({
        comandaId: pedido.comandaId,
        cervejariaId: user.cervejariaId!,
        eventoId: pedido.eventoId,
        item: {
          produtoId: item.produtoId,
          volumeMl: item.volumeMl,
          quantidade: item.quantidade,
          tapId: tapId ?? undefined,
        },
      });

      if ('error' in result) {
        return reply.status(400).send({ error: result.error, itemId: item.id });
      }

      lastComanda = result.comanda;
      await registrarTransacao({
        cervejariaId: user.cervejariaId!,
        tipo: 'COMANDA_ITEM_ADICIONADO',
        usuarioId: user.sub,
        eventoId: pedido.eventoId,
        comandaId: pedido.comandaId,
        entidadeTipo: 'PedidoCliente',
        entidadeId: pedido.id,
        metadata: {
          produtoNome: result.produto.nome,
          volumeMl: item.volumeMl,
          quantidade: item.quantidade,
          precoUnit: result.precoUnit,
          origem: 'pedido_cliente',
        },
        payload: { pedido, item, comanda: result.comanda },
      });

      emitToEvento(app.io, pedido.eventoId, { type: 'item:added', data: result.comanda });
      if (result.isChope) {
        emitRankingUpdated(app.io, user.cervejariaId!, pedido.eventoId);
      }
    }

    const updated = await prisma.pedidoCliente.update({
      where: { id },
      data: {
        status: 'CONFIRMADO',
        confirmadoPorId: user.sub,
        confirmadoEm: new Date(),
      },
      include: pedidoInclude,
    });

    const serialized = serializePedido(updated);
    emitToEvento(app.io, pedido.eventoId, { type: 'pedido:confirmed', data: serialized });
    emitToComanda(app.io, pedido.comandaId, { type: 'pedido:confirmed', data: serialized });
    if (lastComanda) {
      emitToComanda(app.io, pedido.comandaId, { type: 'item:added', data: lastComanda });
    }

    return {
      pedido: serialized,
      comanda: lastComanda,
    };
  });

  app.post('/:id/recusar', async (request, reply) => {
    const user = getAuthUser(request);
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
    emitToComanda(app.io, pedido.comandaId, { type: 'pedido:recusado', data: serialized });

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
