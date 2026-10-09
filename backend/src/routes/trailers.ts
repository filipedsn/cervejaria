import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { trailerSelect } from '../lib/trailer-utils.js';
import { canonicalPdvQaActivationEnabled } from '../lib/canonical-pdv-operational-config.js';

const createTrailerSchema = z.object({
  nome: z.string().min(1),
  identificador: z.string().optional(),
});

const updateTrailerSchema = createTrailerSchema.partial();

export async function trailersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  // Use the same persisted tenant activation selector as the canonical routes.
  // Do not infer activation from physical records or a client-supplied PDV.
  const requireLegacyTenant = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getTenantUser(app, request);
    if (canonicalPdvQaActivationEnabled(process.env, user.cervejariaId)) {
      return reply.status(409).send({ code: 'CANONICAL_PDV_TRAILER_MUTATION_BLOCKED', error: 'A gestão de Trailer não está disponível para o PDV canônico.' });
    }
  };
  const mutationGuards = [app.requireDono, requireLegacyTenant];

  app.get('/operacional', async (request) => {
    const user = getTenantUser(app, request);

    const trailers = await prisma.trailer.findMany({
      where: { cervejariaId: user.cervejariaId, ativo: true },
      orderBy: [{ nome: 'asc' }],
    });

    const eventosAbertos = await prisma.evento.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        status: 'ABERTO',
        data: { not: null },
      },
      include: {
        trailer: { select: trailerSelect },
        serie: { select: { id: true, nome: true, diaSemana: true } },
      },
    });

    const eventoPorTrailer = new Map(eventosAbertos.map((e) => [e.trailerId, e]));

    return trailers.map((trailer) => ({
      ...trailer,
      eventoAberto: eventoPorTrailer.get(trailer.id) ?? null,
    }));
  });

  app.get('/', async (request) => {
    const user = getTenantUser(app, request);
    const query = z
      .object({
        ativo: z.enum(['true', 'false']).optional(),
      })
      .parse(request.query);

    return prisma.trailer.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        ...(query.ativo !== undefined ? { ativo: query.ativo === 'true' } : {}),
      },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
  });

  app.post('/', { preHandler: mutationGuards }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = createTrailerSchema.parse(request.body);

    const trailer = await prisma.trailer.create({
      data: {
        nome: body.nome,
        identificador: body.identificador,
        cervejariaId: user.cervejariaId!,
      },
    });

    return reply.status(201).send(trailer);
  });

  app.put('/:id', { preHandler: mutationGuards }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = updateTrailerSchema.parse(request.body);

    const existing = await prisma.trailer.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Trailer não encontrado' });

    const trailer = await prisma.trailer.update({
      where: { id },
      data: {
        nome: body.nome,
        identificador: body.identificador,
      },
    });

    return trailer;
  });

  app.patch('/:id/ativo', { preHandler: mutationGuards }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.trailer.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Trailer não encontrado' });

    if (!ativo) {
      const openEventos = await prisma.evento.count({
        where: { trailerId: id, status: 'ABERTO', data: { not: null } },
      });
      if (openEventos > 0) {
        return reply.status(409).send({
          error: `Este trailer está em ${openEventos} evento(s) aberto(s). Encerre-os antes de desativar.`,
        });
      }
    }

    const trailer = await prisma.trailer.update({
      where: { id },
      data: { ativo },
    });

    return trailer;
  });

  app.delete('/:id', { preHandler: mutationGuards }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const existing = await prisma.trailer.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Trailer não encontrado' });

    const openEventos = await prisma.evento.count({
      where: { trailerId: id, status: 'ABERTO', data: { not: null } },
    });
    if (openEventos > 0) {
      return reply.status(409).send({
        error: `Este trailer está em ${openEventos} evento(s) aberto(s). Encerre-os antes de excluir.`,
      });
    }

    const totalTrailers = await prisma.trailer.count({
      where: { cervejariaId: user.cervejariaId },
    });
    if (totalTrailers <= 1) {
      return reply.status(409).send({ error: 'A cervejaria precisa de ao menos um trailer.' });
    }

    await prisma.trailer.delete({ where: { id } });
    return reply.status(204).send();
  });
}
