import { prisma } from './prisma.js';
import { isBebidaChope } from './produto-utils.js';
import { ensureDefaultTaps } from './trailer-defaults.js';

const produtoInclude = {
  include: { precos: { orderBy: { volumeMl: 'asc' as const } } },
};

export async function findEventoSessao(eventoId: string, cervejariaId: string) {
  return prisma.evento.findFirst({
    where: { id: eventoId, cervejariaId, recorrencia: 'NENHUMA' },
    select: { id: true, trailerId: true, status: true },
  });
}

function mapTapComChope(
  tap: {
    id: string;
    numero: number;
    nome: string | null;
    trailerId: string;
    ativo: boolean;
    produtoId: string | null;
    produto: Awaited<ReturnType<typeof loadTapsDoTrailer>>[number]['produto'];
  },
  montagem: { produtoId: string; produto: NonNullable<typeof tap.produto> } | undefined,
  modo: 'evento' | 'prevista',
) {
  const chopeCadastro = tap.produto ?? null;
  const chopeAtual =
    modo === 'evento'
      ? montagem?.produto ?? null
      : chopeCadastro;

  return {
    id: tap.id,
    numero: tap.numero,
    nome: tap.nome,
    trailerId: tap.trailerId,
    ativo: tap.ativo,
    produtoId: tap.produtoId,
    chopeAtual,
    chopeCadastro,
    temMontagemAtiva: !!montagem,
    trocadoNoEvento: montagem ? montagem.produtoId !== tap.produtoId : false,
    montagemPrevista: modo === 'prevista',
  };
}

async function loadTapsDoTrailer(trailerId: string, opts?: { apenasAtivos?: boolean }) {
  return prisma.tap.findMany({
    where: {
      trailerId,
      ...(opts?.apenasAtivos !== false ? { ativo: true } : {}),
    },
    orderBy: { numero: 'asc' },
    include: { produto: produtoInclude },
  });
}

/** Cria montagem inicial a partir do chope cadastrado em cada tap (somente taps sem montagem ativa). */
export async function inicializarMontagemEvento(eventoId: string, trailerId: string) {
  const [taps, montagensAtivas] = await Promise.all([
    loadTapsDoTrailer(trailerId, { apenasAtivos: true }),
    prisma.tapMontagem.findMany({
      where: { eventoId, encerradoEm: null },
      select: { tapId: true },
    }),
  ]);

  const montados = new Set(montagensAtivas.map((m) => m.tapId));
  const toCreate = taps.filter((t) => t.produtoId && !montados.has(t.id));

  if (toCreate.length === 0) return { criados: 0 };

  await prisma.tapMontagem.createMany({
    data: toCreate.map((t) => ({
      tapId: t.id,
      produtoId: t.produtoId!,
      eventoId,
    })),
  });

  return { criados: toCreate.length };
}

export async function ensureMontagemEvento(eventoId: string, trailerId: string, cervejariaId?: string) {
  if (cervejariaId) {
    await ensureDefaultTaps(trailerId, cervejariaId);
  }
  return inicializarMontagemEvento(eventoId, trailerId);
}

export async function listTapsMontagemPrevista(trailerId: string) {
  const taps = await loadTapsDoTrailer(trailerId, { apenasAtivos: false });
  return taps.map((tap) => mapTapComChope(tap, undefined, 'prevista'));
}

export async function listTapsComChopeAtual(eventoId: string, trailerId: string) {
  const [taps, montagensAtivas] = await Promise.all([
    loadTapsDoTrailer(trailerId, { apenasAtivos: false }),
    prisma.tapMontagem.findMany({
      where: { eventoId, encerradoEm: null },
      include: { produto: produtoInclude },
    }),
  ]);

  const montagemPorTap = new Map(montagensAtivas.map((m) => [m.tapId, m]));

  return taps.map((tap) => mapTapComChope(tap, montagemPorTap.get(tap.id), 'evento'));
}

export async function assertChopeAtivoNoTap(eventoId: string, tapId: string, produtoId: string) {
  const montagem = await prisma.tapMontagem.findFirst({
    where: { eventoId, tapId, produtoId, encerradoEm: null },
  });
  return !!montagem;
}

export async function posicionarChopeNoTap(params: {
  eventoId: string;
  trailerId: string;
  tapId: string;
  produtoId: string;
  cervejariaId: string;
}) {
  const { eventoId, trailerId, tapId, produtoId, cervejariaId } = params;

  const tap = await prisma.tap.findFirst({
    where: { id: tapId, trailerId, cervejariaId, ativo: true },
    include: { produto: { select: { id: true, nome: true } } },
  });
  if (!tap) return { error: 'Tap não encontrado' as const };

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId, ativo: true },
  });
  if (!produto) return { error: 'Chope inválido' as const };
  if (!isBebidaChope(produto.tipo, produto.formato)) {
    return { error: 'Apenas chope pode ser posicionado no tap' as const };
  }

  const now = new Date();
  const chopeAnterior = await prisma.tapMontagem.findFirst({
    where: { eventoId, tapId, encerradoEm: null },
    include: { produto: { select: { nome: true } } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.tapMontagem.updateMany({
      where: { eventoId, tapId, encerradoEm: null },
      data: { encerradoEm: now },
    });

    await tx.tapMontagem.create({
      data: { tapId, produtoId, eventoId },
    });
  });

  return {
    ok: true as const,
    tapNumero: tap.numero,
    chopeAnterior: chopeAnterior?.produto.nome ?? tap.produto?.nome ?? null,
    chopeNovo: produto.nome,
  };
}

export async function removerChopeDoTap(params: {
  eventoId: string;
  trailerId: string;
  tapId: string;
  cervejariaId: string;
}) {
  const { eventoId, trailerId, tapId, cervejariaId } = params;

  const tap = await prisma.tap.findFirst({
    where: { id: tapId, trailerId, cervejariaId },
    select: { numero: true },
  });
  if (!tap) return { error: 'Tap não encontrado' as const };

  const updated = await prisma.tapMontagem.updateMany({
    where: { eventoId, tapId, encerradoEm: null },
    data: { encerradoEm: new Date() },
  });

  if (updated.count === 0) return { error: 'Este tap não possui chope montado no evento' as const };
  return { ok: true as const, tapNumero: tap.numero };
}

export async function setTapAtivoNoEvento(params: {
  eventoId: string;
  trailerId: string;
  tapId: string;
  ativo: boolean;
  cervejariaId: string;
}) {
  const { eventoId, trailerId, tapId, ativo, cervejariaId } = params;

  const tap = await prisma.tap.findFirst({
    where: { id: tapId, trailerId, cervejariaId },
    select: { id: true, numero: true, produtoId: true },
  });
  if (!tap) return { error: 'Tap não encontrado' as const };

  if (!ativo) {
    await prisma.tapMontagem.updateMany({
      where: { eventoId, tapId, encerradoEm: null },
      data: { encerradoEm: new Date() },
    });
  }

  await prisma.tap.update({
    where: { id: tapId },
    data: { ativo },
  });

  if (ativo && tap.produtoId) {
    const montagemAtiva = await prisma.tapMontagem.findFirst({
      where: { eventoId, tapId, encerradoEm: null },
    });
    if (!montagemAtiva) {
      await prisma.tapMontagem.create({
        data: { tapId, produtoId: tap.produtoId, eventoId },
      });
    }
  }

  return { ok: true as const, tapNumero: tap.numero, ativo };
}

/** Eventos abertos que usam o trailer (para aviso ao editar cadastro do tap). */
export async function countEventosAbertosDoTrailer(trailerId: string, cervejariaId: string) {
  return prisma.evento.count({
    where: {
      trailerId,
      cervejariaId,
      status: 'ABERTO',
      recorrencia: 'NENHUMA',
    },
  });
}
