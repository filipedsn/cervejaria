import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/** Accept the active transaction so callers never exhaust the pool from inside it. */
export async function cervejariaUsaCardapio(cervejariaId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const row = await db.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: { usaCardapio: true },
  });
  return row?.usaCardapio ?? false;
}

export async function quiosqueUsaCardapio(cervejariaId: string): Promise<boolean> {
  const row = await prisma.configuracaoQuiosque.findUnique({
    where: { cervejariaId },
    select: { usaCardapio: true },
  });
  return row?.usaCardapio ?? false;
}
