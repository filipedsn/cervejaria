import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import type { CardapioItemInput } from '../cardapio-preco.js';
import type { ProdutoIdsCardapioResult } from '../cardapio.js';

export type QuiosqueCardapioItemInput = { produtoId: string; precoUnit: number };

type ItensCardapioQuiosqueResult =
  | { ok: true; itens: QuiosqueCardapioItemInput[] }
  | { error: string };

function defaultPrecoCatalogoQuiosque(produto: { precos: Array<{ preco: unknown }> }): number {
  return toNumber(produto.precos[0]?.preco ?? 0);
}

export async function normalizeItensCardapioQuiosque(
  cervejariaId: string,
  itens?: QuiosqueCardapioItemInput[],
  produtoIds?: string[],
): Promise<ItensCardapioQuiosqueResult> {
  if (itens?.length) {
    const ids = itens.map((i) => i.produtoId);
    const validated = await validateProdutosCardapioQuiosque(cervejariaId, ids);
    if ('error' in validated) return validated;

    const invalidPreco = itens.find((i) => !(i.precoUnit > 0));
    if (invalidPreco) return { error: 'Informe preço maior que zero para todos os itens' };

    const unique = new Map<string, QuiosqueCardapioItemInput>();
    for (const item of itens) unique.set(item.produtoId, item);
    return { ok: true, itens: [...unique.values()] };
  }

  if (produtoIds?.length) {
    const validated = await validateProdutosCardapioQuiosque(cervejariaId, produtoIds);
    if ('error' in validated) return validated;

    const produtos = await prisma.produto.findMany({
      where: { id: { in: validated.produtoIds }, cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' }, take: 1 } },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const itensNormalizados: QuiosqueCardapioItemInput[] = [];
    for (const produtoId of validated.produtoIds) {
      const produto = porId.get(produtoId);
      if (!produto) return { error: 'Um ou mais itens do cardápio são inválidos' };
      itensNormalizados.push({ produtoId, precoUnit: defaultPrecoCatalogoQuiosque(produto) });
    }
    return { ok: true, itens: itensNormalizados };
  }

  return { ok: true, itens: [] };
}

export async function validateProdutosCardapioQuiosque(
  cervejariaId: string,
  produtoIds: string[],
): Promise<ProdutoIdsCardapioResult> {
  const uniqueIds = [...new Set(produtoIds)];
  if (uniqueIds.length === 0) return { ok: true as const, produtoIds: [] as string[] };

  const produtos = await prisma.produto.findMany({
    where: { id: { in: uniqueIds }, cervejariaId, ativo: true },
  });

  if (produtos.length !== uniqueIds.length) {
    return { error: 'Um ou mais itens do cardápio são inválidos' as const };
  }

  return { ok: true as const, produtoIds: uniqueIds };
}

export async function listCardapiosQuiosque(cervejariaId: string, opts?: { ativo?: boolean }) {
  return prisma.cardapioQuiosque.findMany({
    where: {
      cervejariaId,
      ...(opts?.ativo !== undefined ? { ativo: opts.ativo } : {}),
    },
    include: {
      produtos: {
        include: { produto: true },
        orderBy: { produto: { nome: 'asc' } },
      },
      _count: { select: { produtos: true } },
    },
    orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
  });
}

export function mapCardapioQuiosqueResponse(
  cardapio: Awaited<ReturnType<typeof listCardapiosQuiosque>>[number],
) {
  return {
    id: cardapio.id,
    nome: cardapio.nome,
    ativo: cardapio.ativo,
    cervejariaId: cardapio.cervejariaId,
    produtoIds: cardapio.produtos.map((p) => p.produtoId),
    itens: cardapio.produtos.map((p) => ({
      produtoId: p.produtoId,
      precoUnit: toNumber(p.precoUnit),
      produto: p.produto,
    })),
    produtos: cardapio.produtos.map((p) => ({
      ...p.produto,
      precoUnit: String(toNumber(p.precoUnit)),
      precoEfetivo: toNumber(p.precoUnit),
    })),
    itemCount: cardapio._count.produtos,
  };
}

export async function getCardapioQuiosqueById(id: string, cervejariaId: string) {
  const cardapio = await prisma.cardapioQuiosque.findFirst({
    where: { id, cervejariaId },
    include: {
      produtos: {
        include: { produto: true },
        orderBy: { produto: { nome: 'asc' } },
      },
      _count: { select: { produtos: true } },
    },
  });
  if (!cardapio) return null;
  return mapCardapioQuiosqueResponse(cardapio);
}

async function replaceCardapioQuiosqueProdutos(
  cardapioId: string,
  itens: QuiosqueCardapioItemInput[],
) {
  await prisma.$transaction(async (tx) => {
    await tx.cardapioQuiosqueProduto.deleteMany({ where: { cardapioId } });
    if (itens.length > 0) {
      await tx.cardapioQuiosqueProduto.createMany({
        data: itens.map((item) => ({
          cardapioId,
          produtoId: item.produtoId,
          precoUnit: item.precoUnit,
        })),
      });
    }
  });
}

export async function createCardapioQuiosque(params: {
  cervejariaId: string;
  nome: string;
  itens?: QuiosqueCardapioItemInput[];
  produtoIds?: string[];
}) {
  const normalized = await normalizeItensCardapioQuiosque(
    params.cervejariaId,
    params.itens,
    params.produtoIds,
  );
  if ('error' in normalized) return normalized;

  const cardapio = await prisma.cardapioQuiosque.create({
    data: {
      nome: params.nome.trim(),
      cervejariaId: params.cervejariaId,
    },
  });

  await replaceCardapioQuiosqueProdutos(cardapio.id, normalized.itens);
  return getCardapioQuiosqueById(cardapio.id, params.cervejariaId);
}

export async function updateCardapioQuiosque(params: {
  id: string;
  cervejariaId: string;
  nome?: string;
  itens?: QuiosqueCardapioItemInput[];
  produtoIds?: string[];
}) {
  const existing = await prisma.cardapioQuiosque.findFirst({
    where: { id: params.id, cervejariaId: params.cervejariaId },
  });
  if (!existing) return { error: 'Cardápio não encontrado' as const };

  if (params.itens !== undefined || params.produtoIds !== undefined) {
    const normalized = await normalizeItensCardapioQuiosque(
      params.cervejariaId,
      params.itens,
      params.produtoIds,
    );
    if ('error' in normalized) return normalized;
    await replaceCardapioQuiosqueProdutos(params.id, normalized.itens);
  }

  if (params.nome !== undefined) {
    await prisma.cardapioQuiosque.update({
      where: { id: params.id },
      data: { nome: params.nome.trim() },
    });
  }

  const updated = await getCardapioQuiosqueById(params.id, params.cervejariaId);
  if (!updated) throw new Error('Cardápio não encontrado');
  return updated;
}

export async function getProdutoIdsFromCardapioQuiosque(
  cardapioId: string,
  cervejariaId: string,
): Promise<ProdutoIdsCardapioResult> {
  const cardapio = await prisma.cardapioQuiosque.findFirst({
    where: { id: cardapioId, cervejariaId, ativo: true },
    include: { produtos: { select: { produtoId: true } } },
  });
  if (!cardapio) return { error: 'Cardápio não encontrado' as const };
  return { ok: true as const, produtoIds: cardapio.produtos.map((p) => p.produtoId) };
}

export async function listCatalogoCardapioQuiosque(cervejariaId: string) {
  return prisma.produto.findMany({
    where: { cervejariaId, ativo: true },
    include: { precos: { orderBy: { volumeMl: 'asc' }, take: 1 } },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
}

// re-export for typing compatibility
export type { CardapioItemInput };
