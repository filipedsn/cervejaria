import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuthUser } from '../types/auth.js';
import {
  createCardapio,
  getCardapioById,
  listCardapios,
  mapCardapioResponse,
  updateCardapio,
} from '../lib/cardapio.js';
import { listCatalogoCardapio } from '../lib/evento-cardapio.js';
import { cervejariaUsaCardapio } from '../lib/cardapio-toggle.js';
import { prisma } from '../lib/prisma.js';

const itemCardapioSchema = z.object({
  produtoId: z.string().min(1),
  precoUnit: z.number().positive(),
});

const saveCardapioSchema = z.object({
  nome: z.string().min(1),
  produtoIds: z.array(z.string().min(1)).optional(),
  itens: z.array(itemCardapioSchema).optional(),
});

export async function cardapiosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireDono);

  app.addHook('preHandler', async (request, reply) => {
    const user = getAuthUser(request);
    const usa = await cervejariaUsaCardapio(user.cervejariaId!);
    if (!usa) {
      return reply.status(403).send({ error: 'Cardápio desativado para esta empresa' });
    }
  });

  app.get('/', async (request) => {
    const user = getAuthUser(request);
    const query = z.object({ ativo: z.enum(['true', 'false']).optional() }).parse(request.query);

    const cardapios = await listCardapios(user.cervejariaId!, {
      ativo: query.ativo === 'true' ? true : query.ativo === 'false' ? false : undefined,
    });

    return cardapios.map(mapCardapioResponse);
  });

  app.get('/catalogo', async (request) => {
    const user = getAuthUser(request);
    return listCatalogoCardapio(user.cervejariaId!);
  });

  app.get('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const cardapio = await getCardapioById(id, user.cervejariaId!);
    if (!cardapio) return reply.status(404).send({ error: 'Cardápio não encontrado' });
    return cardapio;
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = saveCardapioSchema.parse(request.body);

    const result = await createCardapio({
      cervejariaId: user.cervejariaId!,
      nome: body.nome,
      itens: body.itens,
      produtoIds: body.produtoIds,
    });
    if (!result || 'error' in result) {
      return reply.status(400).send({ error: result && 'error' in result ? result.error : 'Erro ao criar cardápio' });
    }

    return reply.status(201).send(result);
  });

  app.put('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = saveCardapioSchema.parse(request.body);

    const result = await updateCardapio({
      id,
      cervejariaId: user.cervejariaId!,
      nome: body.nome,
      itens: body.itens,
      produtoIds: body.produtoIds,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    return result;
  });

  app.patch('/:id/ativo', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.cardapio.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapio.update({ where: { id }, data: { ativo } });
    const updated = await getCardapioById(id, user.cervejariaId!);
    return updated;
  });

  app.delete('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.cardapio.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapio.delete({ where: { id } });
    return reply.status(204).send();
  });
}
