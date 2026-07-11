import { prisma } from './prisma.js';
import { isBebidaChope } from './produto-utils.js';

const DEFAULT_TAP_COUNT = 4;

export const TRAILER_SEM_CHOPE_MSG =
  'Este trailer não tem chope disponível. Em Config. → Trailers, associe um chope (do catálogo) a pelo menos um tap ativo antes de abrir o evento.';

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

/** Impede abrir evento sem chope configurado nos taps do trailer. */
export async function assertTrailerChopeDisponivel(trailerId: string, cervejariaId: string) {
  await ensureDefaultTaps(trailerId, cervejariaId);

  const taps = await prisma.tap.findMany({
    where: { trailerId, cervejariaId, ativo: true },
    include: { produto: { include: { precos: true } } },
  });

  if (taps.length === 0) {
    return { error: TRAILER_SEM_CHOPE_MSG as const };
  }

  const comChope = taps.filter(
    (t) =>
      t.produto &&
      t.produto.ativo &&
      isBebidaChope(t.produto.tipo, t.produto.formato) &&
      t.produto.precos.length > 0,
  );

  if (comChope.length === 0) {
    return { error: TRAILER_SEM_CHOPE_MSG as const };
  }

  return { ok: true as const };
}