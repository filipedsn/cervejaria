import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToEvento, emitRankingUpdated } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { isBebidaChope } from '../lib/produto-utils.js';
import { cancelarComandaVazia } from '../lib/comanda-cancelar.js';
import { resolveClienteParaComanda } from '../lib/cliente-resolver.js';
import { isTelefoneClienteAvulsoReservado } from '../lib/cliente-avulso.js';
import { normalizePhone } from '../lib/phone.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import {
  addItemToComanda,
  comandaDetailInclude,
  removeItemFromComanda,
} from '../lib/comanda-service.js';

const createComandaSchema = z.object({
  eventoId: z.string(),
  clienteNome: z.string().min(1),
  clienteTelefone: z.string().min(1, 'Telefone é obrigatório'),
});

const addItemSchema = z.object({
  produtoId: z.string(),
  volumeMl: z.number().int().positive(),
  quantidade: z.number().int().positive().default(1),
  tapId: z.string().optional(),
});

export async function comandasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };
    const { status } = request.query as { status?: 'ABERTA' | 'FECHADA' };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    return prisma.comanda.findMany({
      where: {
        eventoId,
        ...(status ? { status } : {}),
      },
      include: comandaDetailInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  });

  app.post('/:id/itens', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = addItemSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
      include: { evento: { select: { id: true } } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const result = await addItemToComanda({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      eventoId: comanda.eventoId,
      item: {
        produtoId: body.produtoId,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        tapId: body.tapId,
      },
    });

    if ('error' in result) {
      return reply.status(400).send({ error: result.error });
    }

    const { comanda: updated, produto, isChope, precoUnit } = result;
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_ADICIONADO',
      usuarioId: user.sub,
      eventoId: comanda.eventoId,
      comandaId: id,
      entidadeTipo: 'Produto',
      entidadeId: body.produtoId,
      metadata: {
        produtoNome: produto.nome,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        precoUnit,
        tapId: body.tapId ?? null,
      },
    });
    emitToEvento(app.io, comanda.eventoId, { type: 'item:added', data: updated });
    if (isChope) {
      emitRankingUpdated(app.io, user.cervejariaId!, comanda.eventoId);
    }
    return reply.status(201).send(updated);
  });

  app.delete('/:id/itens/:itemId', async (request, reply) => {
    const user = getAuthUser(request);
    const { id, itemId } = request.params as { id: string; itemId: string };

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const result = await removeItemFromComanda({
      comandaId: id,
      itemId,
      cervejariaId: user.cervejariaId!,
      eventoId: comanda.eventoId,
    });

    if ('error' in result) {
      return reply.status(404).send({ error: result.error });
    }

    const { comanda: updated, item } = result;
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_REMOVIDO',
      usuarioId: user.sub,
      eventoId: comanda.eventoId,
      comandaId: id,
      entidadeTipo: 'ItemComanda',
      entidadeId: itemId,
      metadata: {
        produtoNome: item.produto.nome,
        volumeMl: item.volumeMl,
        quantidade: item.quantidade,
        precoUnit: toNumber(item.precoUnit),
      },
    });
    const chopeAfetado = isBebidaChope(item.produto.tipo, item.produto.formato);
    emitToEvento(app.io, comanda.eventoId, { type: 'item:removed', data: updated });
    if (chopeAfetado) {
      emitRankingUpdated(app.io, user.cervejariaId!, comanda.eventoId);
    }
    return updated;
  });

  app.post('/:id/cancelar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const result = await cancelarComandaVazia({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      fechadoPorId: user.sub,
      motivo: 'manual',
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    emitToEvento(app.io, result.eventoId, { type: 'comanda:closed', data: result.comanda });
    return result.comanda;
  });

  app.get('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: {
        id,
        evento: { cervejariaId: user.cervejariaId },
      },
      include: comandaDetailInclude,
    });

    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    return comanda;
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = createComandaSchema.parse(request.body);

    const evento = await prisma.evento.findFirst({
      where: { id: body.eventoId, cervejariaId: user.cervejariaId, status: 'ABERTO' },
    });
    if (!evento) return reply.status(400).send({ error: 'Evento não encontrado ou fechado' });

    const telefone = normalizePhone(body.clienteTelefone);
    if (!telefone) {
      return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).' });
    }
    if (isTelefoneClienteAvulsoReservado(telefone)) {
      return reply.status(400).send({ error: 'Telefone reservado pelo sistema' });
    }

    let cliente;
    try {
      cliente = await resolveClienteParaComanda({
        cervejariaId: user.cervejariaId!,
        nome: body.clienteNome,
        telefone,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Telefone inválido';
      return reply.status(400).send({ error: message });
    }

    const comanda = await prisma.comanda.create({
      data: {
        eventoId: body.eventoId,
        clienteId: cliente.id,
      },
      include: comandaDetailInclude,
    });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_CRIADA',
      usuarioId: user.sub,
      eventoId: body.eventoId,
      comandaId: comanda.id,
      metadata: {
        clienteNome: cliente.nome,
        clienteTelefone: cliente.telefone,
      },
    });

    emitToEvento(app.io, body.eventoId, { type: 'comanda:created', data: comanda });
    return reply.status(201).send(comanda);
  });
}
