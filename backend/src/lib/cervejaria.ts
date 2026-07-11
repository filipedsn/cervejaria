import type { FastifyInstance } from 'fastify';
import { prisma } from './prisma.js';

const MSG_CERVEJARIA_INATIVA =
  'Cervejaria desativada. Entre em contato com o administrador do sistema.';

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
    throw app.httpErrors.forbidden(MSG_CERVEJARIA_INATIVA);
  }
}

export { MSG_CERVEJARIA_INATIVA };
