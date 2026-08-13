import { prisma } from './prisma.js';

export async function cervejariaUsaCardapio(cervejariaId: string): Promise<boolean> {
  const row = await prisma.cervejaria.findUnique({
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
