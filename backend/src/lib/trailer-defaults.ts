import { prisma } from './prisma.js';

const DEFAULT_TAP_COUNT = 4;

/** Garante taps básicos no trailer (cervejarias novas vinham sem nenhum tap). */
export async function ensureDefaultTaps(trailerId: string, cervejariaId: string) {
  const count = await prisma.tap.count({ where: { trailerId } });
  if (count > 0) return { criados: 0 };

  await prisma.tap.createMany({
    data: Array.from({ length: DEFAULT_TAP_COUNT }, (_, i) => ({
      numero: i + 1,
      nome: `Tap ${i + 1}`,
      cervejariaId,
      trailerId,
    })),
  });

  return { criados: DEFAULT_TAP_COUNT };
}
