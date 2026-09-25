import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import type { CardapioItemInput } from '../cardapio-preco.js';
import type { ProdutoIdsCardapioResult } from '../cardapio.js';

export type OperacaoCardapioItemInput = { produtoId: string; precoUnit: number };

type ItensCardapioOperacaoResult =
  | { ok: true; itens: OperacaoCardapioItemInput[] }
  | { error: string };

function defaultPrecoCatalogoOperacao(produto: { precos: Array<{ preco: unknown }> }): number {
  return toNumber(produto.precos[0]?.preco ?? 0);
}

export async function normalizeItensCardapioOperacao(
  cervejariaId: string,
  itens?: OperacaoCardapioItemInput[],
  produtoIds?: string[],
): Promise<ItensCardapioOperacaoResult> {
  if (itens?.length) {
    const ids = itens.map((i) => i.produtoId);
    const validated = await validateProdutosCardapioOperacao(cervejariaId, ids);
    if ('error' in validated) return validated;

    const invalidPreco = itens.find((i) => !(i.precoUnit > 0));
    if (invalidPreco) return { error: 'Informe preço maior que zero para todos os itens' };

    const unique = new Map<string, OperacaoCardapioItemInput>();
    for (const item of itens) unique.set(item.produtoId, item);
    return { ok: true, itens: [...unique.values()] };
  }

  if (produtoIds?.length) {
    const validated = await validateProdutosCardapioOperacao(cervejariaId, produtoIds);
    if ('error' in validated) return validated;

    const produtos = await prisma.produto.findMany({
      where: { id: { in: validated.produtoIds }, cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' }, take: 1 } },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const itensNormalizados: OperacaoCardapioItemInput[] = [];
    for (const produtoId of validated.produtoIds) {
      const produto = porId.get(produtoId);
      if (!produto) return { error: 'Um ou mais itens do cardápio são inválidos' };
      itensNormalizados.push({ produtoId, precoUnit: defaultPrecoCatalogoOperacao(produto) });
    }
    return { ok: true, itens: itensNormalizados };
  }

  return { ok: true, itens: [] };
}

export async function validateProdutosCardapioOperacao(
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

export async function listCardapiosOperacao(cervejariaId: string, opts?: { ativo?: boolean }) {
  return prisma.cardapioOperacao.findMany({
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

export function mapCardapioOperacaoResponse(
  cardapio: Awaited<ReturnType<typeof listCardapiosOperacao>>[number],
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

export async function getCardapioOperacaoById(id: string, cervejariaId: string) {
  const cardapio = await prisma.cardapioOperacao.findFirst({
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
  return mapCardapioOperacaoResponse(cardapio);
}

async function replaceCardapioOperacaoProdutos(
  cardapioId: string,
  itens: OperacaoCardapioItemInput[],
) {
  await prisma.$transaction(async (tx) => {
    await tx.cardapioOperacaoProduto.deleteMany({ where: { cardapioId } });
    if (itens.length > 0) {
      await tx.cardapioOperacaoProduto.createMany({
        data: itens.map((item) => ({
          cardapioId,
          produtoId: item.produtoId,
          precoUnit: item.precoUnit,
        })),
      });
    }
  });
}

export async function createCardapioOperacao(params: {
  cervejariaId: string;
  nome: string;
  itens?: OperacaoCardapioItemInput[];
  produtoIds?: string[];
}) {
  const normalized = await normalizeItensCardapioOperacao(
    params.cervejariaId,
    params.itens,
    params.produtoIds,
  );
  if ('error' in normalized) return normalized;

  const cardapio = await prisma.cardapioOperacao.create({
    data: {
      nome: params.nome.trim(),
      cervejariaId: params.cervejariaId,
    },
  });

  await replaceCardapioOperacaoProdutos(cardapio.id, normalized.itens);
  return getCardapioOperacaoById(cardapio.id, params.cervejariaId);
}

export async function updateCardapioOperacao(params: {
  id: string;
  cervejariaId: string;
  nome?: string;
  itens?: OperacaoCardapioItemInput[];
  produtoIds?: string[];
}) {
  const existing = await prisma.cardapioOperacao.findFirst({
    where: { id: params.id, cervejariaId: params.cervejariaId },
  });
  if (!existing) return { error: 'Cardápio não encontrado' as const };

  if (params.itens !== undefined || params.produtoIds !== undefined) {
    const normalized = await normalizeItensCardapioOperacao(
      params.cervejariaId,
      params.itens,
      params.produtoIds,
    );
    if ('error' in normalized) return normalized;
    await replaceCardapioOperacaoProdutos(params.id, normalized.itens);
  }

  if (params.nome !== undefined) {
    await prisma.cardapioOperacao.update({
      where: { id: params.id },
      data: { nome: params.nome.trim() },
    });
  }

  const updated = await getCardapioOperacaoById(params.id, params.cervejariaId);
  if (!updated) throw new Error('Cardápio não encontrado');
  return updated;
}

export async function getProdutoIdsFromCardapioOperacao(
  cardapioId: string,
  cervejariaId: string,
): Promise<ProdutoIdsCardapioResult> {
  const cardapio = await prisma.cardapioOperacao.findFirst({
    where: { id: cardapioId, cervejariaId, ativo: true },
    include: { produtos: { select: { produtoId: true } } },
  });
  if (!cardapio) return { error: 'Cardápio não encontrado' as const };
  return { ok: true as const, produtoIds: cardapio.produtos.map((p) => p.produtoId) };
}

export async function listCatalogoCardapioOperacao(cervejariaId: string) {
  return prisma.produto.findMany({
    where: { cervejariaId, ativo: true },
    include: { precos: { orderBy: { volumeMl: 'asc' }, take: 1 } },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
}

// re-export for typing compatibility
export type { CardapioItemInput };
