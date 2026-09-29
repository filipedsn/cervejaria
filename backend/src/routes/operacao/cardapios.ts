import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  createCardapioOperacao,
  getCardapioOperacaoById,
  listCardapiosOperacao,
  listCatalogoCardapioOperacao,
  mapCardapioOperacaoResponse,
  updateCardapioOperacao,
} from '../../lib/operacao/cardapio.js';
import { operacaoUsaCardapio } from '../../lib/cardapio-toggle.js';
import { emitToCervejaria } from '../../lib/realtime.js';
import { listOpenEventsUsingCardapio } from '../../lib/cardapio-event-sync.js';

const itemCardapioSchema = z.object({
  produtoId: z.string().min(1),
  volumeMl: z.number().int().nonnegative().optional(),
  precoUnit: z.number().positive(),
});

const saveCardapioSchema = z.object({
  nome: z.string().min(1),
  produtoIds: z.array(z.string().min(1)).optional(),
  itens: z.array(itemCardapioSchema).optional(),
});

export async function cardapiosOperacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireDono);

  app.addHook('preHandler', async (request, reply) => {
    const usa = await operacaoUsaCardapio(request.operacao.cervejariaId);
    if (!usa) {
      return reply.status(403).send({ error: 'Cardápio desativado para esta empresa' });
    }
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.operacao;
    const query = z.object({ ativo: z.enum(['true', 'false']).optional() }).parse(request.query);

    const cardapios = await listCardapiosOperacao(cervejariaId, {
      ativo: query.ativo === 'true' ? true : query.ativo === 'false' ? false : undefined,
    });

    return cardapios.map(mapCardapioOperacaoResponse);
  });

  app.get('/catalogo', async (request) => {
    const { cervejariaId } = request.operacao;
    return listCatalogoCardapioOperacao(cervejariaId);
  });

  app.get('/:id', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };

    const cardapio = await getCardapioOperacaoById(id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Cardápio não encontrado' });
    return cardapio;
  });

  app.post('/', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const body = saveCardapioSchema.parse(request.body);

    const result = await createCardapioOperacao({
      cervejariaId,
      nome: body.nome,
      itens: body.itens,
      produtoIds: body.produtoIds,
    });
    if (!result || 'error' in result) {
      return reply.status(400).send({
        error: result && 'error' in result ? result.error : 'Erro ao criar cardápio',
      });
    }

    return reply.status(201).send(result);
  });

  app.put('/:id', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = saveCardapioSchema.parse(request.body);

    const result = await updateCardapioOperacao({
      id,
      cervejariaId,
      nome: body.nome,
      itens: body.itens,
      produtoIds: body.produtoIds,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    if (body.itens !== undefined || body.produtoIds !== undefined) {
      const eventos = await listOpenEventsUsingCardapio(id, cervejariaId);
      for (const evento of eventos) {
        emitToCervejaria(app.io, cervejariaId, {
          type: 'evento-cardapio:updated',
          data: { eventoId: evento.id },
        });
      }
    }
    return result;
  });

  app.patch('/:id/ativo', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.cardapio.findFirst({
      where: { id, cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapio.update({ where: { id }, data: { ativo } });
    const updated = await getCardapioOperacaoById(id, cervejariaId);
    return updated;
  });

  app.delete('/:id', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };

    const existing = await prisma.cardapio.findFirst({
      where: { id, cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapio.delete({ where: { id } });
    return reply.status(204).send();
  });
}
