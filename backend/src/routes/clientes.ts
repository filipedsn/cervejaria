import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { resolveClienteParaComanda } from '../lib/cliente-resolver.js';

const createClienteSchema = z.object({
  nome: z.string().min(1),
  telefone: z.string().optional().nullable(),
});

export async function clientesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const user = getAuthUser(request);
    const { q } = request.query as { q?: string };

    return prisma.cliente.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { telefone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: 20,
    });
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = createClienteSchema.parse(request.body);

    if (body.telefone) {
      const existing = await prisma.cliente.findFirst({
        where: { cervejariaId: user.cervejariaId, telefone: body.telefone },
      });
      if (existing) return existing;
    }

    const cliente = await prisma.cliente.create({
      data: {
        nome: body.nome,
        telefone: body.telefone ?? null,
        cervejariaId: user.cervejariaId,
      },
    });

    return reply.status(201).send(cliente);
  });

  app.post('/find-or-create', async (request) => {
    const user = getAuthUser(request);
    const body = createClienteSchema.parse(request.body);

    return resolveClienteParaComanda({
      cervejariaId: user.cervejariaId!,
      nome: body.nome,
      telefone: body.telefone,
    });
  });
}
