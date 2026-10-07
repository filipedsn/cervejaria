import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/utils.js';
import { getAuthUser } from '../types/auth.js';
import {
  PERMISSOES_OPERACAO,
  permissoesIndividuaisAtivas,
  permissoesOperacaoSchema as permissionListSchema,
  requireDonoAtual,
} from '../lib/operacao/permissoes.js';
import { reconcileRealtimePermissionsForUser } from '../lib/socket-auth.js';

const createAtendenteSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
  podeDarDescontoOperacao: z.boolean().optional(),
  permissoesOperacao: permissionListSchema.optional(),
});

const permissoesOperacaoSchema = z.object({
  podeDarDescontoOperacao: z.boolean().optional(),
  permissoesOperacao: permissionListSchema.optional(),
}).refine((value) => value.podeDarDescontoOperacao !== undefined || value.permissoesOperacao !== undefined, {
  message: 'Informe as permissões que deseja salvar',
});

export async function usuariosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      throw app.httpErrors.forbidden('Acesso restrito');
    }

    const usuarios = await prisma.usuario.findMany({
      where: { cervejariaId: user.cervejariaId },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoOperacao: true,
        ...(permissoesIndividuaisAtivas() ? { permissoesOperacao: true } : {}),
        createdAt: true,
      },
      orderBy: { nome: 'asc' },
    });
    if (!permissoesIndividuaisAtivas()) return usuarios;
    return usuarios.map((usuario) => ({
      ...usuario,
      permissoesOperacao: usuario.papel === 'DONO' ? [...PERMISSOES_OPERACAO] : usuario.permissoesOperacao,
    }));
  });

  app.post('/', { preHandler: [requireDonoAtual(app)] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      return reply.status(403).send({ error: 'Acesso restrito' });
    }

    const body = createAtendenteSchema.parse(request.body);

    const existing = await prisma.usuario.findUnique({ where: { email: body.email }, select: { id: true } });
    if (existing) {
      return reply.status(409).send({ error: 'E-mail já cadastrado' });
    }

    const senhaHash = await hashPassword(body.senha);
    const permissionMode = permissoesIndividuaisAtivas();
    const explicitPermissions = body.permissoesOperacao
      ?? (body.podeDarDescontoOperacao ? ['discount.apply' as const] : []);
    const usuario = await prisma.usuario.create({
      data: {
        nome: body.nome,
        email: body.email,
        senhaHash,
        papel: 'ATENDENTE',
        cervejariaId: user.cervejariaId,
        podeDarDescontoOperacao: permissionMode
          ? explicitPermissions.includes('discount.apply')
          : (body.podeDarDescontoOperacao ?? false),
        ...(permissionMode ? { permissoesOperacao: explicitPermissions } : {}),
      },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoOperacao: true,
        ...(permissionMode ? { permissoesOperacao: true } : {}),
        createdAt: true,
      },
    });

    return reply.status(201).send(usuario);
  });

  app.patch('/:id/permissoes-operacao', { preHandler: [requireDonoAtual(app)] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      return reply.status(403).send({ error: 'Acesso restrito' });
    }

    const { id } = request.params as { id: string };
    const body = permissoesOperacaoSchema.parse(request.body);

    const alvo = await prisma.usuario.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      select: {
        id: true,
        papel: true,
        ...(permissoesIndividuaisAtivas() ? { permissoesOperacao: true } : {}),
      },
    });
    if (!alvo) return reply.status(404).send({ error: 'Usuário não encontrado' });
    if (alvo.papel !== 'ATENDENTE') {
      return reply.status(409).send({ error: 'Permissão aplicável apenas a atendentes' });
    }

    const permissionMode = permissoesIndividuaisAtivas();
    const existingPermissions = 'permissoesOperacao' in alvo ? alvo.permissoesOperacao ?? [] : [];
    const permissions = body.permissoesOperacao ?? (body.podeDarDescontoOperacao
      ? [...new Set([...existingPermissions, 'discount.apply' as const])]
      : existingPermissions.filter((permission) => permission !== 'discount.apply'));
    const atualizado = await prisma.usuario.update({
      where: { id: alvo.id },
      data: permissionMode
        ? {
            permissoesOperacao: permissions,
            podeDarDescontoOperacao: permissions.includes('discount.apply'),
          }
        : { podeDarDescontoOperacao: body.podeDarDescontoOperacao },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        podeDarDescontoOperacao: true,
        ...(permissionMode ? { permissoesOperacao: true } : {}),
        createdAt: true,
      },
    });

    if (permissionMode) await reconcileRealtimePermissionsForUser(app, alvo.id, user.cervejariaId);

    return atualizado;
  });
}
