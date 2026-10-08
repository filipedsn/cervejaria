import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTenantUser } from '../types/auth.js';
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
import { emitToCervejaria } from '../lib/realtime.js';
import { listOpenEventsUsingCardapio } from '../lib/cardapio-event-sync.js';
import { requireDonoComPermissoesDesligadas, requirePermissaoOuDono } from '../lib/operacao/permissoes.js';

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
  app.addHook('preHandler', requireDonoComPermissoesDesligadas(app));

  app.addHook('preHandler', async (request, reply) => {
    const user = getTenantUser(app, request);
    const usa = await cervejariaUsaCardapio(user.cervejariaId!);
    if (!usa) {
      return reply.status(403).send({ error: 'Cardápio desativado para esta empresa' });
    }
  });

  app.get('/', async (request) => {
    const user = getTenantUser(app, request);
    const query = z.object({ ativo: z.enum(['true', 'false']).optional() }).parse(request.query);

    const cardapios = await listCardapios(user.cervejariaId!, {
      ativo: query.ativo === 'true' ? true : query.ativo === 'false' ? false : undefined,
    });

    return cardapios.map(mapCardapioResponse);
  });

  app.get('/catalogo', async (request) => {
    const user = getTenantUser(app, request);
    return listCatalogoCardapio(user.cervejariaId!);
  });

  app.get('/:id', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const cardapio = await getCardapioById(id, user.cervejariaId!);
    if (!cardapio) return reply.status(404).send({ error: 'Cardápio não encontrado' });
    return cardapio;
  });

  app.post('/', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
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

  app.put('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
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
    if (body.itens !== undefined || body.produtoIds !== undefined) {
      const eventos = await listOpenEventsUsingCardapio(id, user.cervejariaId!);
      for (const evento of eventos) {
        emitToCervejaria(app.io, user.cervejariaId!, {
          type: 'evento-cardapio:updated',
          data: { eventoId: evento.id },
        });
      }
    }
    return result;
  });

  app.patch('/:id/ativo', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
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

  app.delete('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const existing = await prisma.cardapio.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cardápio não encontrado' });

    await prisma.cardapio.delete({ where: { id } });
    return reply.status(204).send();
  });
}
