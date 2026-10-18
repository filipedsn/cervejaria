import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { isBebidaChopeOperacao, isChopeConfiguravelNaTapOperacao } from './produto-utils.js';
import { ensureDefaultTaps } from './trailer-defaults.js';
import { lockCaixaEmTx } from './operacao/caixa-lock.js';

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
    trailerId: string | null;
    pontoVendaId?: string | null;
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
    pontoVendaId: tap.pontoVendaId ?? null,
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

async function loadTapsDoPontoVenda(pontoVendaId: string, cervejariaId: string, opts?: { apenasAtivos?: boolean }) {
  return prisma.tap.findMany({
    where: { pontoVendaId, cervejariaId, ...(opts?.apenasAtivos !== false ? { ativo: true } : {}) },
    orderBy: { numero: 'asc' },
    include: { produto: produtoInclude },
  });
}

export async function hasUnmappedCanonicalTaps(cervejariaId: string) {
  return (await prisma.tap.count({ where: { cervejariaId, pontoVendaId: null } })) > 0;
}

/** Canonical Por Caixa mounts are scoped to the session and its PDV, without a Trailer lookup. */
export async function inicializarMontagemPdv(sessaoCaixaId: string, pontoVendaId: string, cervejariaId: string) {
  return prisma.$transaction(async (tx) => {
    const lockScope = await tx.sessaoCaixaOperacao.findUnique({ where: { id: sessaoCaixaId }, select: { cervejariaId: true, pontoVendaId: true, diaOperacional: true } });
    if (!lockScope?.pontoVendaId) return { criados: 0 };
    await lockCaixaEmTx(tx, lockScope.cervejariaId, lockScope.pontoVendaId, lockScope.diaOperacional);
    const sessao = await tx.sessaoCaixaOperacao.findFirst({ where: { id: sessaoCaixaId, cervejariaId, pontoVendaId, status: 'ABERTO' }, select: { id: true } });
    if (!sessao) return { criados: 0 };
    const taps = await tx.tap.findMany({ where: { pontoVendaId, cervejariaId, ativo: true }, select: { id: true, produtoId: true } });
    // Historical mounts record operator intent, including an explicitly removed mount.
    const history = await tx.tapMontagem.findMany({ where: { sessaoCaixaId }, select: { tapId: true } });
    const mounted = new Set(history.map((mount) => mount.tapId));
    const toCreate = taps.filter((tap) => tap.produtoId && !mounted.has(tap.id));
    if (!toCreate.length) return { criados: 0 };
    await tx.tapMontagem.createMany({ data: toCreate.map((tap) => ({ tapId: tap.id, produtoId: tap.produtoId!, sessaoCaixaId })), skipDuplicates: true });
    return { criados: toCreate.length };
  }, { maxWait: 15_000, timeout: 20_000 });
}

export async function listTapsComChopeAtualPdv(sessaoCaixaId: string, pontoVendaId: string, cervejariaId: string) {
  const [taps, montagens] = await Promise.all([
    loadTapsDoPontoVenda(pontoVendaId, cervejariaId, { apenasAtivos: false }),
    prisma.tapMontagem.findMany({ where: { sessaoCaixaId, encerradoEm: null }, include: { produto: produtoInclude } }),
  ]);
  const byTap = new Map(montagens.map((m) => [m.tapId, m]));
  return taps.map((tap) => mapTapComChope(tap, byTap.get(tap.id), 'evento'));
}

export async function posicionarChopeNoPdv(params: { sessaoCaixaId: string; pontoVendaId: string; tapId: string; produtoId: string; cervejariaId: string }) {
  const { sessaoCaixaId, pontoVendaId, tapId, produtoId, cervejariaId } = params;
  return prisma.$transaction(async (tx) => {
    const lockScope = await tx.sessaoCaixaOperacao.findUnique({ where: { id: sessaoCaixaId }, select: { cervejariaId: true, pontoVendaId: true, diaOperacional: true } });
    if (!lockScope?.pontoVendaId) return { error: 'Sessão de caixa inválida' as const };
    await lockCaixaEmTx(tx, lockScope.cervejariaId, lockScope.pontoVendaId, lockScope.diaOperacional);
    const sessao = await tx.sessaoCaixaOperacao.findFirst({ where: { id: sessaoCaixaId, cervejariaId, pontoVendaId, status: 'ABERTO' }, select: { id: true } });
    if (!sessao) return { error: 'Sessão de caixa inválida' as const };
    const tap = await tx.tap.findFirst({ where: { id: tapId, pontoVendaId, cervejariaId, ativo: true }, include: { produto: { select: { nome: true } } } });
    if (!tap) return { error: 'Tap não encontrado neste PDV' as const };
    const produto = await tx.produto.findFirst({ where: { id: produtoId, cervejariaId, pontoVendaId, ativo: true }, include: { precos: { select: { volumeMl: true } } } });
    if (!produto || !isChopeConfiguravelNaTapOperacao(produto)) return { error: 'Chope inválido para esta empresa' as const };
    const anterior = await tx.tapMontagem.findFirst({ where: { sessaoCaixaId, tapId, encerradoEm: null }, include: { produto: { select: { nome: true } } } });
    await tx.tapMontagem.updateMany({ where: { sessaoCaixaId, tapId, encerradoEm: null }, data: { encerradoEm: new Date() } });
    await tx.tapMontagem.create({ data: { tapId, produtoId, sessaoCaixaId } });
    return { ok: true as const, tapNumero: tap.numero, chopeAnterior: anterior?.produto.nome ?? tap.produto?.nome ?? null, chopeNovo: produto.nome };
  }, { maxWait: 15_000, timeout: 20_000 });
}

export async function removerChopeDoPdv(params: { sessaoCaixaId: string; pontoVendaId: string; tapId: string; cervejariaId: string }) {
  const { sessaoCaixaId, pontoVendaId, tapId, cervejariaId } = params;
  return prisma.$transaction(async (tx) => {
    const lockScope = await tx.sessaoCaixaOperacao.findUnique({ where: { id: sessaoCaixaId }, select: { cervejariaId: true, pontoVendaId: true, diaOperacional: true } });
    if (!lockScope?.pontoVendaId) return { error: 'Sessão de caixa inválida' as const };
    await lockCaixaEmTx(tx, lockScope.cervejariaId, lockScope.pontoVendaId, lockScope.diaOperacional);
    const sessao = await tx.sessaoCaixaOperacao.findFirst({ where: { id: sessaoCaixaId, cervejariaId, pontoVendaId, status: 'ABERTO' }, select: { id: true } });
    if (!sessao) return { error: 'Sessão de caixa inválida' as const };
    const tap = await tx.tap.findFirst({ where: { id: tapId, pontoVendaId, cervejariaId }, select: { numero: true } });
    if (!tap) return { error: 'Tap não encontrado neste PDV' as const };
    const updated = await tx.tapMontagem.updateMany({ where: { sessaoCaixaId, tapId, encerradoEm: null }, data: { encerradoEm: new Date() } });
    if (!updated.count) return { error: 'Este tap n?o possui chope montado no turno' as const };
    return { ok: true as const, tapNumero: tap.numero };
  }, { maxWait: 15_000, timeout: 20_000 });
}

/** Cria montagem inicial para uma ocorrência/evento usando o Trailer histórico. */
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

/** Cria a montagem inicial dos taps para uma sessao de caixa vinculada ao trailer. */
export async function inicializarMontagemSessaoCaixa(sessaoCaixaId: string, trailerId: string) {
  const [taps, montagensAtivas] = await Promise.all([
    loadTapsDoTrailer(trailerId, { apenasAtivos: true }),
    prisma.tapMontagem.findMany({
      where: { sessaoCaixaId, encerradoEm: null },
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
      sessaoCaixaId,
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

export async function listTapsComChopeAtualSessaoCaixa(sessaoCaixaId: string, trailerId: string) {
  const [taps, montagensAtivas] = await Promise.all([
    loadTapsDoTrailer(trailerId, { apenasAtivos: false }),
    prisma.tapMontagem.findMany({
      where: { sessaoCaixaId, encerradoEm: null },
      include: { produto: produtoInclude },
    }),
  ]);

  const montagemPorTap = new Map(montagensAtivas.map((m) => [m.tapId, m]));
  return taps.map((tap) => mapTapComChope(tap, montagemPorTap.get(tap.id), 'evento'));
}

export async function assertChopeAtivoNoTap(eventoId: string, tapId: string, produtoId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const montagem = await db.tapMontagem.findFirst({
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
  if (!isChopeConfiguravelNaTapOperacao(produto)) {
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

export async function posicionarChopeNoTurno(params: {
  sessaoCaixaId: string;
  trailerId: string;
  tapId: string;
  produtoId: string;
  cervejariaId: string;
}) {
  const { sessaoCaixaId, trailerId, tapId, produtoId, cervejariaId } = params;

  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessaoCaixaId, cervejariaId, trailerId, status: 'ABERTO' },
    select: { id: true },
  });
  if (!sessao) return { error: 'Turno de caixa não encontrado ou sem trailer vinculado' as const };

  const tap = await prisma.tap.findFirst({
    where: { id: tapId, trailerId, cervejariaId, ativo: true },
    include: { produto: { select: { id: true, nome: true } } },
  });
  if (!tap) return { error: 'Tap não encontrado' as const };

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId, ativo: true },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (!produto) return { error: 'Chope inválido' as const };
  if (!isChopeConfiguravelNaTapOperacao(produto)) {
    return { error: 'Apenas chope pode ser posicionado no Tap' as const };
  }

  const now = new Date();
  const chopeAnterior = await prisma.tapMontagem.findFirst({
    where: { sessaoCaixaId, tapId, encerradoEm: null },
    include: { produto: { select: { nome: true } } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.tapMontagem.updateMany({
      where: { sessaoCaixaId, tapId, encerradoEm: null },
      data: { encerradoEm: now },
    });
    await tx.tapMontagem.create({
      data: { tapId, produtoId, sessaoCaixaId },
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

export async function removerChopeDoTurno(params: {
  sessaoCaixaId: string;
  trailerId: string;
  tapId: string;
  cervejariaId: string;
}) {
  const { sessaoCaixaId, trailerId, tapId, cervejariaId } = params;
  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessaoCaixaId, cervejariaId, trailerId, status: 'ABERTO' },
    select: { id: true },
  });
  if (!sessao) return { error: 'Turno de caixa não encontrado ou sem trailer vinculado' as const };

  const tap = await prisma.tap.findFirst({
    where: { id: tapId, trailerId, cervejariaId },
    select: { numero: true },
  });
  if (!tap) return { error: 'Tap não encontrado' as const };

  const updated = await prisma.tapMontagem.updateMany({
    where: { sessaoCaixaId, tapId, encerradoEm: null },
    data: { encerradoEm: new Date() },
  });
  if (updated.count === 0) return { error: 'Este Tap não possui chope montado no turno' as const };
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
