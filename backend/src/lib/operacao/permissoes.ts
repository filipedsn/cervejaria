import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import type { Prisma } from '@prisma/client';
import { getAuthUser, type JwtPayload } from '../../types/auth.js';

export const PERMISSOES_OPERACAO = [
  'cash.open',
  'cash.close',
  'cash.values.read',
  'cash.movement.write',
  'payment.receive',
  'debt.receive',
  'command.close',
  'discount.apply',
  'command.item.cancel',
  'command.cancel',
  'kitchen.cancel',
  'sale.refund',
  'dashboard.read',
  'event.dashboard.read',
  'reports.read',
] as const;

export type PermissaoOperacao = (typeof PERMISSOES_OPERACAO)[number];

export const permissoesOperacaoSchema = z.array(z.enum(PERMISSOES_OPERACAO)).max(PERMISSOES_OPERACAO.length);

/** Enables the canonical permission list only after the additive migration is installed. */
export function permissoesIndividuaisAtivas(): boolean {
  return process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED === '1';
}

function negar(app: FastifyInstance, message = 'Você não tem permissão para esta ação'): never {
  throw app.httpErrors.forbidden(message);
}

export async function usuarioPode(
  user: JwtPayload,
  permissao: PermissaoOperacao,
  options: { allowLegacyDiscount?: boolean } = {},
  db: Pick<Prisma.TransactionClient, 'usuario'> | typeof prisma = prisma,
): Promise<boolean> {
  if (!permissoesIndividuaisAtivas()) {
    if (options.allowLegacyDiscount && (user.papel === 'DONO' || user.papel === 'ADMIN')) return true;
    if (options.allowLegacyDiscount) {
      const legacy = await db.usuario.findFirst({
        where: { id: user.sub, cervejariaId: user.cervejariaId },
        select: { podeDarDescontoOperacao: true },
      });
      return legacy?.podeDarDescontoOperacao === true;
    }
    return true;
  }

  if (!user.cervejariaId) return false;
  const persisted = await db.usuario.findUnique({
    where: { id: user.sub },
    select: { papel: true, cervejariaId: true, permissoesOperacao: true },
  });
  if (!persisted || persisted.cervejariaId !== user.cervejariaId) return false;
  if (persisted.papel === 'DONO') return true;
  return persisted.permissoesOperacao.includes(permissao);
}

export function requirePermissao(
  app: FastifyInstance,
  permissao: PermissaoOperacao | PermissaoOperacao[] | ((request: FastifyRequest) => PermissaoOperacao | PermissaoOperacao[]),
) {
  return async (request: FastifyRequest) => {
    if (!permissoesIndividuaisAtivas()) return;
    const user = getAuthUser(request);
    const required = typeof permissao === 'function' ? permissao(request) : permissao;
    const permissions = Array.isArray(required) ? required : [required];
    for (const permission of permissions) {
      if (!(await usuarioPode(user, permission))) negar(app);
    }
  };
}

export function requirePermissaoOuDono(app: FastifyInstance, permissao: PermissaoOperacao) {
  const requireLegacyDono = app.requireDono;
  return async (request: FastifyRequest) => {
    if (!permissoesIndividuaisAtivas()) return requireLegacyDono(request);
    return requirePermissao(app, permissao)(request);
  };
}

export function requireDonoAtual(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) negar(app, 'Acesso restrito ao proprietário');
    const persisted = await prisma.usuario.findUnique({
      where: { id: user.sub },
      select: { papel: true, cervejariaId: true },
    });
    if (persisted?.papel !== 'DONO' || persisted.cervejariaId !== user.cervejariaId) {
      negar(app, 'Acesso restrito ao proprietário da empresa');
    }
  };
}

export function requireFechamentoComanda(app: FastifyInstance) {
  return requirePermissao(app, (request) => {
    const body = request.body as { deixarPendente?: boolean; pagamentos?: unknown[] } | null;
    const permissions: PermissaoOperacao[] = ['command.close'];
    if (!body?.deixarPendente && (body?.pagamentos?.length ?? 0) > 0) permissions.push('payment.receive');
    return permissions;
  });
}

export function requireFechamentoGrupo(app: FastifyInstance) {
  return requirePermissao(app, (request) => {
    const body = request.body as { pagamentos?: unknown[] } | null;
    return (body?.pagamentos?.length ?? 0) > 0
      ? ['command.close', 'payment.receive']
      : ['command.close'];
  });
}
