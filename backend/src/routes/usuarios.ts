import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/utils.js';
import { getAuthUser } from '../types/auth.js';

const createAtendenteSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
  podeDarDescontoQuiosque: z.boolean().optional(),
});

const permissoesQuiosqueSchema = z.object({
  podeDarDescontoQuiosque: z.boolean(),
});

export async function usuariosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      throw app.httpErrors.forbidden('Acesso restrito');
    }

    return prisma.usuario.findMany({
      where: { cervejariaId: user.cervejariaId },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoQuiosque: true,
        createdAt: true,
      },
      orderBy: { nome: 'asc' },
    });
  });

  app.post('/', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      return reply.status(403).send({ error: 'Acesso restrito' });
    }

    const body = createAtendenteSchema.parse(request.body);

    const existing = await prisma.usuario.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.status(409).send({ error: 'E-mail já cadastrado' });
    }

    const senhaHash = await hashPassword(body.senha);
    const usuario = await prisma.usuario.create({
      data: {
        nome: body.nome,
        email: body.email,
        senhaHash,
        papel: 'ATENDENTE',
        cervejariaId: user.cervejariaId,
        podeDarDescontoQuiosque: body.podeDarDescontoQuiosque ?? false,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoQuiosque: true,
        createdAt: true,
      },
    });

    return reply.status(201).send(usuario);
  });

  app.patch('/:id/permissoes-quiosque', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      return reply.status(403).send({ error: 'Acesso restrito' });
    }

    const { id } = request.params as { id: string };
    const body = permissoesQuiosqueSchema.parse(request.body);

    const alvo = await prisma.usuario.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!alvo) return reply.status(404).send({ error: 'Usuário não encontrado' });
    if (alvo.papel !== 'ATENDENTE') {
      return reply.status(409).send({ error: 'Permissão aplicável apenas a atendentes' });
    }

    const atualizado = await prisma.usuario.update({
      where: { id: alvo.id },
      data: { podeDarDescontoQuiosque: body.podeDarDescontoQuiosque },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoQuiosque: true,
        createdAt: true,
      },
    });

    return atualizado;
  });
}
