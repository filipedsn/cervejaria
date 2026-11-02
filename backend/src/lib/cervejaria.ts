import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

const MSG_CERVEJARIA_INATIVA =
  'Cervejaria desativada. Entre em contato com o administrador do sistema.';

/** Código estável para o frontend encerrar a sessão em vez de tratar como falta de permissão. */
export const CODE_CERVEJARIA_INATIVA = 'TENANT_INACTIVE';

export class CervejariaInativaError extends Error {
  readonly statusCode = 403;
  readonly code = CODE_CERVEJARIA_INATIVA;

  constructor(message = MSG_CERVEJARIA_INATIVA) {
    super(message);
    this.name = 'CervejariaInativaError';
  }
}

export async function assertCervejariaAtiva(
  app: FastifyInstance,
  cervejariaId: string | null,
  papel: string
): Promise<void> {
  if (papel === 'ADMIN' || !cervejariaId) return;

  const cervejaria = await prisma.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: { ativo: true },
  });

  if (!cervejaria?.ativo) {
    throw Object.assign(app.httpErrors.forbidden(MSG_CERVEJARIA_INATIVA), { code: CODE_CERVEJARIA_INATIVA });
  }
}

/**
 * Trava a linha da empresa em modo compartilhado até o fim da transação: a
 * inativação (FOR UPDATE) espera a abertura de caixa terminar e vice-versa.
 */
export async function assertCervejariaAtivaEmTx(tx: Prisma.TransactionClient, cervejariaId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ ativo: boolean }>>`
    SELECT "ativo" FROM public."Cervejaria" WHERE "id" = ${cervejariaId} FOR SHARE
  `;
  if (!rows[0]?.ativo) throw new CervejariaInativaError();
}

export { MSG_CERVEJARIA_INATIVA };
