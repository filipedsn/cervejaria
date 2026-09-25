import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  createCardapioQuiosque,
  getCardapioQuiosqueById,
  listCardapiosQuiosque,
  listCatalogoCardapioQuiosque,
  mapCardapioQuiosqueResponse,
  updateCardapioQuiosque,
} from '../../lib/quiosque/cardapio.js';
import { quiosqueUsaCardapio } from '../../lib/cardapio-toggle.js';

const itemCardapioSchema = z.object({
  produtoId: z.string().min(1),
  precoUnit: z.number().positive(),
});

const saveCardapioSchema = z.object({
  nome: z.string().min(1),
  produtoIds: z.array(z.string().min(1)).optional(),
  itens: z.array(itemCardapioSchema).optional(),
});

export async function cardapiosQuiosqueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireDono);

  app.addHook('preHandler', async (request, reply) => {
    const usa = await quiosqueUsaCardapio(request.quiosque.cervejariaId);
    if (!usa) {
      return reply.status(403).send({ error: 'Cardápio desativado para esta empresa' });
    }
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const query = z.object({ ativo: z.enum(['true', 'false']).optional() }).parse(request.query);

    const cardapios = await listCardapiosQuiosque(cervejariaId, {
      ativo: query.ativo === 'true' ? true : query.ativo === 'false' ? false : undefined,
    });

    return cardapios.map(mapCardapioQuiosqueResponse);
  });

  app.get('/catalogo', async (request) => {
    const { cervejariaId } = request.quiosque;
    return listCatalogoCardapioQuiosque(cervejariaId);
  });

  app.get('/:id', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };

    const cardapio = await getCardapioQuiosqueById(id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Cardápio não encontrado' });
    return cardapio;
  });

  app.post('/', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const body = saveCardapioSchema.parse(request.body);

    const result = await createCardapioQuiosque({
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
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };
    const body = saveCardapioSchema.parse(request.body);

    const result = await updateCardapioQuiosque({
      id,
      cervejariaId,
      nome: body.nome,
      itens: body.itens,
      produtoIds: body.produtoIds,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    return result;
  });

  app.patch('/:id/ativo', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.cardapioQuiosque.findFirst({
      where: { id, cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapioQuiosque.update({ where: { id }, data: { ativo } });
    const updated = await getCardapioQuiosqueById(id, cervejariaId);
    return updated;
  });

  app.delete('/:id', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };

    const existing = await prisma.cardapioQuiosque.findFirst({
      where: { id, cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapioQuiosque.delete({ where: { id } });
    return reply.status(204).send();
  });
}
