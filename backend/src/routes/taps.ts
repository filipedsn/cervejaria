import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { assertTapPodeExcluir } from '../lib/catalogo-utils.js';
import { isChopeConfiguravelNaTapOperacao } from '../lib/produto-utils.js';
import { findTrailerForTenant } from '../lib/trailer-utils.js';
import { canonicalPdvQaActivationEnabled, readCanonicalPdvOperationalSettingsIfEnabled } from '../lib/canonical-pdv-operational-config.js';
import { hasUnmappedCanonicalTaps } from '../lib/tap-montagem.js';

const createTapSchema = z.object({
  numero: z.number().int().positive(),
  nome: z.string().optional(),
  produtoId: z.string().min(1),
  trailerId: z.string().min(1).optional(),
  pontoVendaId: z.string().min(1).optional(),
});

const updateTapSchema = createTapSchema.partial();

async function validateChopeProduto(produtoId: string | null | undefined, cervejariaId: string, pontoVendaId?: string) {
  if (!produtoId) return 'Informe o chope disponível neste tap';
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId, ativo: true, ...(pontoVendaId ? { pontoVendaId } : {}) },
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
        pontoVendaId: z.string().optional(),
      })
      .parse(request.query);

    if (canonicalPdvQaActivationEnabled()) {
      const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(user.cervejariaId!);
      if (!canonical) return reply.status(409).send({ error: 'Mapeamento canônico de PDV indisponível', code: 'CANONICAL_PDV_MAPPING_REQUIRED' });
      if (await hasUnmappedCanonicalTaps(user.cervejariaId!)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      if (query.trailerId || (query.pontoVendaId && query.pontoVendaId !== canonical.pointId)) {
        return reply.status(409).send({ error: 'Os Taps desta operação pertencem ao PDV canônico', code: 'CANONICAL_PDV_MAPPING_REQUIRED' });
      }
      return prisma.tap.findMany({
        where: { cervejariaId: user.cervejariaId, pontoVendaId: canonical.pointId },
        include: { produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } } },
        orderBy: { numero: 'asc' },
      });
    }

    if (query.trailerId) {
      const trailer = await findTrailerForTenant(query.trailerId, user.cervejariaId!);
      if (!trailer) return reply.status(404).send({ error: 'Trailer não encontrado' });
    }

    return prisma.tap.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        trailerId: { not: null },
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

    if (canonicalPdvQaActivationEnabled()) {
      const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(user.cervejariaId!);
      if (!canonical) return reply.status(409).send({ error: 'Mapeamento canônico de PDV indisponível', code: 'CANONICAL_PDV_MAPPING_REQUIRED' });
      if (await hasUnmappedCanonicalTaps(user.cervejariaId!)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      if (!body.pontoVendaId || body.pontoVendaId !== canonical.pointId || body.trailerId) {
        return reply.status(409).send({ error: 'Informe o PDV canônico sem Trailer', code: 'CANONICAL_PDV_MAPPING_REQUIRED' });
      }
      const chopeError = await validateChopeProduto(body.produtoId, user.cervejariaId!, canonical.pointId);
      if (chopeError) return reply.status(400).send({ error: chopeError });
      const duplicate = await prisma.tap.findFirst({ where: { pontoVendaId: canonical.pointId, numero: body.numero } });
      if (duplicate) return reply.status(409).send({ error: `Já existe um Tap ${body.numero} neste PDV` });
      const tap = await prisma.tap.create({ data: { numero: body.numero, nome: body.nome, produtoId: body.produtoId, cervejariaId: user.cervejariaId!, pontoVendaId: canonical.pointId } });
      return reply.status(201).send(tap);
    }

    if (!body.trailerId) return reply.status(400).send({ error: 'Informe o Trailer' });
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

    if (canonicalPdvQaActivationEnabled()) {
      const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(user.cervejariaId!);
      if (await hasUnmappedCanonicalTaps(user.cervejariaId!)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      if (!canonical || existing.pontoVendaId !== canonical.pointId || (body.pontoVendaId && body.pontoVendaId !== canonical.pointId) || body.trailerId) {
        return reply.status(409).send({ error: 'Tap sem mapeamento canônico para este PDV', code: 'CANONICAL_PDV_MAPPING_REQUIRED' });
      }
      if (body.produtoId !== undefined) {
        const chopeError = await validateChopeProduto(body.produtoId, user.cervejariaId!, canonical.pointId);
        if (chopeError) return reply.status(400).send({ error: chopeError });
      }
      if (body.numero !== undefined && await prisma.tap.findFirst({ where: { pontoVendaId: canonical.pointId, numero: body.numero, id: { not: id } } })) {
        return reply.status(409).send({ error: `Já existe um Tap ${body.numero} neste PDV` });
      }
      return prisma.tap.update({ where: { id }, data: { numero: body.numero, nome: body.nome, produtoId: body.produtoId }, include: { produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } } } });
    }

    const trailerId = body.trailerId ?? existing.trailerId;
    if (!trailerId) return reply.status(400).send({ error: 'Informe o Trailer' });
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
