import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { assertTapPodeExcluir } from '../lib/catalogo-utils.js';
import { isChopeConfiguravelNaTapOperacao } from '../lib/produto-utils.js';
import { findTrailerForTenant } from '../lib/trailer-utils.js';

const createTapSchema = z.object({
  numero: z.number().int().positive(),
  nome: z.string().optional(),
  produtoId: z.string().min(1),
  trailerId: z.string().min(1),
});

const updateTapSchema = createTapSchema.partial();

async function validateChopeProduto(produtoId: string | null | undefined, cervejariaId: string) {
  if (!produtoId) return 'Informe o chope disponível neste tap';
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId, ativo: true },
  });
  if (!produto) return 'Chope inválido';
  if (!isChopeConfiguravelNaTapOperacao(produto)) return 'Apenas chope pode ser associado a um tap';
  return null;
}

async function findTapComNumero(trailerId: string, numero: number, excludeId?: string) {
  return prisma.tap.findFirst({
    where: {
      trailerId,
      numero,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export async function tapsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request, reply) => {
    const user = getTenantUser(app, request);
    const query = z
      .object({
        trailerId: z.string().optional(),
      })
      .parse(request.query);

    if (query.trailerId) {
      const trailer = await findTrailerForTenant(query.trailerId, user.cervejariaId!);
      if (!trailer) return reply.status(404).send({ error: 'Trailer não encontrado' });
    }

    return prisma.tap.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        ...(query.trailerId ? { trailerId: query.trailerId } : {}),
      },
      include: {
        produto: {
          include: { precos: { orderBy: { volumeMl: 'asc' } } },
        },
      },
      orderBy: { numero: 'asc' },
    });
  });

  app.post('/', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = createTapSchema.parse(request.body);

    const trailer = await findTrailerForTenant(body.trailerId, user.cervejariaId!);
    if (!trailer) return reply.status(400).send({ error: 'Trailer inválido' });

    const chopeError = await validateChopeProduto(body.produtoId, user.cervejariaId!);
    if (chopeError) return reply.status(400).send({ error: chopeError });

    const duplicado = await findTapComNumero(body.trailerId, body.numero);
    if (duplicado) {
      return reply.status(409).send({ error: `Já existe um tap com o número ${body.numero} neste trailer` });
    }

    const tap = await prisma.tap.create({
      data: {
        numero: body.numero,
        nome: body.nome,
        produtoId: body.produtoId,
        cervejariaId: user.cervejariaId,
        trailerId: body.trailerId,
      },
      include: {
        produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } },
      },
    });

    return reply.status(201).send(tap);
  });

  app.put('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = updateTapSchema.parse(request.body);

    const existing = await prisma.tap.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Tap não encontrado' });

    const trailerId = body.trailerId ?? existing.trailerId;
    if (body.trailerId) {
      const trailer = await findTrailerForTenant(body.trailerId, user.cervejariaId!);
      if (!trailer) return reply.status(400).send({ error: 'Trailer inválido' });
    }

    if (body.produtoId !== undefined) {
      const chopeError = await validateChopeProduto(body.produtoId, user.cervejariaId!);
      if (chopeError) return reply.status(400).send({ error: chopeError });
    }

    if (body.numero !== undefined) {
      const duplicado = await findTapComNumero(trailerId, body.numero, id);
      if (duplicado) {
        return reply.status(409).send({ error: `Já existe um tap com o número ${body.numero} neste trailer` });
      }
    }

    const tap = await prisma.tap.update({
      where: { id },
      data: {
        numero: body.numero,
        nome: body.nome,
        produtoId: body.produtoId,
        trailerId: body.trailerId,
      },
      include: {
        produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } },
      },
    });

    return tap;
  });

  app.patch('/:id/ativo', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.tap.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Tap não encontrado' });

    const tap = await prisma.tap.update({
      where: { id },
      data: { ativo },
      include: {
        produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } },
      },
    });

    return tap;
  });

  app.delete('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const existing = await prisma.tap.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Tap não encontrado' });

    const blockReason = await assertTapPodeExcluir(existing, user.cervejariaId);
    if (blockReason) return reply.status(409).send({ error: blockReason });

    await prisma.tap.delete({ where: { id } });
    return reply.status(204).send();
  });
}
