import { prisma } from './prisma.js';

export async function findTrailerForTenant(
  trailerId: string,
  cervejariaId: string,
  options?: { requireAtivo?: boolean },
) {
  return prisma.trailer.findFirst({
    where: {
      id: trailerId,
      cervejariaId,
      ...(options?.requireAtivo ? { ativo: true } : {}),
    },
  });
}

export async function createDefaultTrailer(cervejariaId: string, tx = prisma) {
  return tx.trailer.create({
    data: {
      nome: 'Principal',
      cervejariaId,
    },
  });
}

export const trailerSelect = {
  id: true,
  nome: true,
  identificador: true,
  ativo: true,
} as const;
