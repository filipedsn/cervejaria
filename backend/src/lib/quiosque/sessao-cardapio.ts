import { prisma } from '../prisma.js';
import { mapPrecosCardapioQuiosque } from '../cardapio-preco.js';
import { quiosqueUsaCardapio } from '../cardapio-toggle.js';
import { toNumber } from '../utils.js';

type AplicarCardapioTurnoResult = { ok: true; count: number } | { error: string };
import {
  getProdutoIdsFromCardapioQuiosque,
  listCatalogoCardapioQuiosque,
  validateProdutosCardapioQuiosque,
} from './cardapio.js';

function enriquecerProdutosQuiosque<
  T extends { id: string; precoUnit: unknown },
>(
  produtos: T[],
  precosTemplate: Map<string, number> | null,
  precosTurno?: Map<string, number> | null,
) {
  return produtos.map((p) => {
    const turnoPreco = precosTurno?.get(p.id);
    const templatePreco = precosTemplate?.get(p.id);
    const precoEfetivo = turnoPreco ?? templatePreco ?? toNumber(p.precoUnit);
    return {
      ...p,
      precoUnit: String(precoEfetivo),
      precoEfetivo,
      precoOverrideTurno: turnoPreco !== undefined,
    };
  });
}

/** Overrides de preço gravados só neste turno (null no banco = herda). */
export async function mapPrecosTurno(sessaoCaixaId: string) {
  const rows = await prisma.sessaoCaixaProdutoQuiosque.findMany({
    where: { sessaoCaixaId, precoUnit: { not: null } },
    select: { produtoQuiosqueId: true, precoUnit: true },
  });
  return new Map(
    rows.flatMap((row) =>
      row.precoUnit === null ? [] : [[row.produtoQuiosqueId, toNumber(row.precoUnit)]],
    ),
  );
}

export async function listProdutosDoTurno(sessaoCaixaId: string) {
  const rows = await prisma.sessaoCaixaProdutoQuiosque.findMany({
    where: { sessaoCaixaId },
    include: { produto: true },
    orderBy: { produto: { nome: 'asc' } },
  });

  return rows.map((r) => r.produto);
}

export async function getCardapioTurno(sessaoCaixaId: string, cervejariaId: string) {
  const sessao = await prisma.sessaoCaixaQuiosque.findFirst({
    where: { id: sessaoCaixaId, cervejariaId },
    select: {
      id: true,
      status: true,
      cardapioQuiosqueId: true,
      cardapio: { select: { id: true, nome: true } },
    },
  });
  if (!sessao) return null;

  const usaCardapio = await quiosqueUsaCardapio(cervejariaId);
  if (!usaCardapio) {
    const catalogoRaw = await listCatalogoCardapioQuiosque(cervejariaId);
    const produtos = enriquecerProdutosQuiosque(catalogoRaw, null);
    return {
      produtos,
      produtoIds: produtos.map((p) => p.id),
      catalogo: produtos,
      editavel: false,
      cardapioId: null,
      cardapioNome: null,
    };
  }

  const [precosTemplate, precosTurno, produtosRaw, catalogoRaw] = await Promise.all([
    sessao.cardapioQuiosqueId
      ? mapPrecosCardapioQuiosque(sessao.cardapioQuiosqueId)
      : Promise.resolve(null),
    mapPrecosTurno(sessaoCaixaId),
    listProdutosDoTurno(sessaoCaixaId),
    listCatalogoCardapioQuiosque(cervejariaId),
  ]);

  const produtos = enriquecerProdutosQuiosque(produtosRaw, precosTemplate, precosTurno);
  const catalogo = enriquecerProdutosQuiosque(catalogoRaw, precosTemplate, precosTurno);

  return {
    produtos,
    produtoIds: produtos.map((p) => p.id),
    catalogo,
    editavel: sessao.status === 'ABERTO',
    cardapioId: sessao.cardapioQuiosqueId,
    cardapioNome: sessao.cardapio?.nome ?? null,
  };
}

export async function assertProdutoNoCardapioTurno(sessaoCaixaId: string, produtoId: string) {
  const row = await prisma.sessaoCaixaProdutoQuiosque.findUnique({
    where: { sessaoCaixaId_produtoQuiosqueId: { sessaoCaixaId, produtoQuiosqueId: produtoId } },
  });
  return !!row;
}

export async function setProdutosDoTurno(sessaoCaixaId: string, produtoIds: string[]) {
  const uniqueIds = [...new Set(produtoIds)];
  await prisma.$transaction(async (tx) => {
    await tx.sessaoCaixaProdutoQuiosque.deleteMany({ where: { sessaoCaixaId } });
    if (uniqueIds.length > 0) {
      await tx.sessaoCaixaProdutoQuiosque.createMany({
        data: uniqueIds.map((produtoQuiosqueId) => ({ sessaoCaixaId, produtoQuiosqueId })),
      });
    }
  });
}

export async function aplicarCardapioInicialTurno(params: {
  sessaoCaixaId: string;
  cervejariaId: string;
  cardapioId?: string;
  produtoIds?: string[];
}): Promise<AplicarCardapioTurnoResult> {
  const { sessaoCaixaId, cervejariaId, cardapioId, produtoIds } = params;
  if (!cardapioId && !produtoIds?.length) return { ok: true as const, count: 0 };

  let ids: string[];
  if (cardapioId) {
    const fromTemplate = await getProdutoIdsFromCardapioQuiosque(cardapioId, cervejariaId);
    if ('error' in fromTemplate) return fromTemplate;
    ids = fromTemplate.produtoIds;
    await prisma.sessaoCaixaQuiosque.update({
      where: { id: sessaoCaixaId },
      data: { cardapioQuiosqueId: cardapioId },
    });
  } else {
    const validated = await validateProdutosCardapioQuiosque(cervejariaId, produtoIds ?? []);
    if ('error' in validated) return validated;
    ids = validated.produtoIds;
  }

  await setProdutosDoTurno(sessaoCaixaId, ids);
  return { ok: true as const, count: ids.length };
}

/** Se o turno ficou sem cardapio, inclui todos os produtos ativos do catalogo. */
export async function aplicarCardapioCatalogoSeVazio(sessaoCaixaId: string, cervejariaId: string) {
  const count = await prisma.sessaoCaixaProdutoQuiosque.count({ where: { sessaoCaixaId } });
  if (count > 0) return count;

  const catalog = await listCatalogoCardapioQuiosque(cervejariaId);
  if (catalog.length === 0) return 0;

  await setProdutosDoTurno(
    sessaoCaixaId,
    catalog.map((p) => p.id),
  );
  return catalog.length;
}

export async function salvarCardapioTurno(params: {
  sessaoCaixaId: string;
  cervejariaId: string;
  cardapioId?: string;
  produtoIds?: string[];
}) {
  const { sessaoCaixaId, cervejariaId, cardapioId, produtoIds } = params;

  if (!(await quiosqueUsaCardapio(cervejariaId))) {
    return { error: 'Cardápio desativado para esta empresa' as const };
  }

  const sessao = await prisma.sessaoCaixaQuiosque.findFirst({
    where: { id: sessaoCaixaId, cervejariaId, status: 'ABERTO' },
  });
  if (!sessao) return { error: 'Turno de caixa não encontrado ou já fechado' as const };

  if (cardapioId && produtoIds !== undefined) {
    return { error: 'Escolha um cardápio salvo ou monte na hora, não os dois' as const };
  }

  if (cardapioId) {
    const applied = await aplicarCardapioInicialTurno({ sessaoCaixaId, cervejariaId, cardapioId });
    if ('error' in applied) return applied;
    return { ok: true as const, count: applied.count };
  }

  const uniqueIds = [...new Set(produtoIds ?? [])];
  if (uniqueIds.length === 0) {
    await setProdutosDoTurno(sessaoCaixaId, []);
    await prisma.sessaoCaixaQuiosque.update({
      where: { id: sessaoCaixaId },
      data: { cardapioQuiosqueId: null },
    });
    return { ok: true as const, count: 0 };
  }

  const validated = await validateProdutosCardapioQuiosque(cervejariaId, uniqueIds);
  if ('error' in validated) return validated;

  await setProdutosDoTurno(sessaoCaixaId, validated.produtoIds);
  await prisma.sessaoCaixaQuiosque.update({
    where: { id: sessaoCaixaId },
    data: { cardapioQuiosqueId: null },
  });

  return { ok: true as const, count: validated.produtoIds.length };
}

/**
 * Altera o preço de um produto do cardápio do turno.
 * TURNO = só esta sessão; TEMPLATE = grava no cardápio salvo vinculado.
 */
type AlterarPrecoCardapioTurnoResult =
  | { ok: true; escopo: 'TURNO' | 'TEMPLATE' }
  | { error: string; statusCode: 400 | 404 };

export async function alterarPrecoCardapioTurno(params: {
  sessaoCaixaId: string;
  cervejariaId: string;
  produtoId: string;
  precoUnit: number;
  escopo: 'TURNO' | 'TEMPLATE';
}): Promise<AlterarPrecoCardapioTurnoResult> {
  const { sessaoCaixaId, cervejariaId, produtoId, precoUnit, escopo } = params;

  if (!(await quiosqueUsaCardapio(cervejariaId))) {
    return { error: 'Cardápio desativado para esta empresa' as const, statusCode: 400 as const };
  }
  if (!(precoUnit > 0)) {
    return { error: 'Informe um preço maior que zero' as const, statusCode: 400 as const };
  }

  const sessao = await prisma.sessaoCaixaQuiosque.findFirst({
    where: { id: sessaoCaixaId, cervejariaId, status: 'ABERTO' },
    select: { id: true, cardapioQuiosqueId: true },
  });
  if (!sessao) {
    return { error: 'Turno de caixa não encontrado ou já fechado' as const, statusCode: 404 as const };
  }

  const noTurno = await prisma.sessaoCaixaProdutoQuiosque.findUnique({
    where: {
      sessaoCaixaId_produtoQuiosqueId: { sessaoCaixaId, produtoQuiosqueId: produtoId },
    },
  });
  if (!noTurno) {
    return { error: 'Produto não está no cardápio deste turno' as const, statusCode: 400 as const };
  }

  if (escopo === 'TURNO') {
    await prisma.sessaoCaixaProdutoQuiosque.update({
      where: { id: noTurno.id },
      data: { precoUnit },
    });
    return { ok: true as const, escopo: 'TURNO' as const };
  }

  if (!sessao.cardapioQuiosqueId) {
    return {
      error: 'Nenhum cardápio salvo vinculado a este turno. Use alteração só do turno.',
      statusCode: 400 as const,
    };
  }

  const templateItem = await prisma.cardapioQuiosqueProduto.findUnique({
    where: {
      cardapioId_produtoQuiosqueId: {
        cardapioId: sessao.cardapioQuiosqueId,
        produtoQuiosqueId: produtoId,
      },
    },
  });
  if (!templateItem) {
    return {
      error: 'Produto não pertence ao cardápio salvo vinculado',
      statusCode: 400 as const,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.cardapioQuiosqueProduto.update({
      where: { id: templateItem.id },
      data: { precoUnit },
    });
    // Limpa override do turno para herdar o novo preço do template.
    await tx.sessaoCaixaProdutoQuiosque.update({
      where: { id: noTurno.id },
      data: { precoUnit: null },
    });
  });

  return { ok: true as const, escopo: 'TEMPLATE' as const };
}

export async function listProdutosOperacionaisTurno(
  cervejariaId: string,
  pontoVendaId: string,
  dia: Date,
) {
  const usaCardapio = await quiosqueUsaCardapio(cervejariaId);
  if (!usaCardapio) {
    return prisma.produtoQuiosque.findMany({
      where: { cervejariaId, ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  const sessao = await prisma.sessaoCaixaQuiosque.findFirst({
    where: { cervejariaId, pontoVendaId, diaOperacional: dia, status: 'ABERTO' },
    orderBy: { abertoEm: 'desc' },
    select: { id: true, cardapioQuiosqueId: true },
  });

  if (!sessao) {
    return prisma.produtoQuiosque.findMany({
      where: { cervejariaId, ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  const [produtos, precosTemplate, precosTurno] = await Promise.all([
    listProdutosDoTurno(sessao.id),
    sessao.cardapioQuiosqueId
      ? mapPrecosCardapioQuiosque(sessao.cardapioQuiosqueId)
      : Promise.resolve(null),
    mapPrecosTurno(sessao.id),
  ]);
  return enriquecerProdutosQuiosque(produtos.filter((p) => p.ativo), precosTemplate, precosTurno);
}
