import { prisma } from './prisma.js';
import { isBebidaChope, isVendaUnitaria } from './produto-utils.js';
import { toNumber } from './utils.js';
import type { CardapioItemInput } from './cardapio-preco.js';

export type { CardapioItemInput };

const produtoInclude = {
  include: { precos: { orderBy: { volumeMl: 'asc' as const } } },
};

function defaultPrecoCatalogo(
  produto: { precos: { preco: unknown; volumeMl: number }[] },
): number {
  const primeiro = produto.precos[0];
  if (!primeiro) throw new Error('Produto sem preço no catálogo');
  return toNumber(primeiro.preco);
}

export async function normalizeItensCardapio(
  cervejariaId: string,
  itens?: CardapioItemInput[],
  produtoIds?: string[],
): Promise<{ ok: true; itens: CardapioItemInput[] } | { error: string }> {
  if (itens?.length) {
    const ids = itens.map((i) => i.produtoId);
    const validated = await validateProdutosCardapio(cervejariaId, ids);
    if ('error' in validated) return validated;

    const invalidPreco = itens.find((i) => !(i.precoUnit > 0));
    if (invalidPreco) return { error: 'Informe preço maior que zero para todos os itens' };

    const unique = new Map<string, CardapioItemInput>();
    for (const item of itens) unique.set(item.produtoId, item);
    return { ok: true, itens: [...unique.values()] };
  }

  if (produtoIds?.length) {
    const validated = await validateProdutosCardapio(cervejariaId, produtoIds);
    if ('error' in validated) return validated;

    const produtos = await prisma.produto.findMany({
      where: { id: { in: validated.produtoIds }, cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));
    return {
      ok: true,
      itens: validated.produtoIds.map((produtoId) => ({
        produtoId,
        precoUnit: defaultPrecoCatalogo(porId.get(produtoId)!),
      })),
    };
  }

  return { ok: true, itens: [] };
}

export async function validateProdutosCardapio(cervejariaId: string, produtoIds: string[]) {
  const uniqueIds = [...new Set(produtoIds)];
  if (uniqueIds.length === 0) return { ok: true as const, produtoIds: [] as string[] };

  const produtos = await prisma.produto.findMany({
    where: { id: { in: uniqueIds }, cervejariaId, ativo: true },
  });

  if (produtos.length !== uniqueIds.length) {
    return { error: 'Um ou mais itens do cardápio são inválidos' as const };
  }

  for (const p of produtos) {
    if (!isVendaUnitaria(p.tipo, p.formato) || isBebidaChope(p.tipo, p.formato)) {
      return { error: 'Chope não entra no cardápio — use as taps do evento' as const };
    }
  }

  return { ok: true as const, produtoIds: uniqueIds };
}

export async function listCardapios(cervejariaId: string, opts?: { ativo?: boolean }) {
  return prisma.cardapio.findMany({
    where: {
      cervejariaId,
      ...(opts?.ativo !== undefined ? { ativo: opts.ativo } : {}),
    },
    include: {
      produtos: {
        include: { produto: produtoInclude },
        orderBy: { produto: { nome: 'asc' } },
      },
      _count: { select: { produtos: true } },
    },
    orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
  });
}

export function mapCardapioResponse(
  cardapio: Awaited<ReturnType<typeof listCardapios>>[number],
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
      precoEfetivo: toNumber(p.precoUnit),
    })),
    itemCount: cardapio._count.produtos,
  };
}

export async function getCardapioById(id: string, cervejariaId: string) {
  const cardapio = await prisma.cardapio.findFirst({
    where: { id, cervejariaId },
    include: {
      produtos: {
        include: { produto: produtoInclude },
        orderBy: { produto: { nome: 'asc' } },
      },
      _count: { select: { produtos: true } },
    },
  });
  if (!cardapio) return null;
  return mapCardapioResponse(cardapio);
}

async function replaceCardapioProdutos(cardapioId: string, itens: CardapioItemInput[]) {
  await prisma.$transaction(async (tx) => {
    await tx.cardapioProduto.deleteMany({ where: { cardapioId } });
    if (itens.length > 0) {
      await tx.cardapioProduto.createMany({
        data: itens.map((item) => ({
          cardapioId,
          produtoId: item.produtoId,
          precoUnit: item.precoUnit,
        })),
      });
    }
  });
}

export async function createCardapio(params: {
  cervejariaId: string;
  nome: string;
  itens?: CardapioItemInput[];
  produtoIds?: string[];
}) {
  const normalized = await normalizeItensCardapio(
    params.cervejariaId,
    params.itens,
    params.produtoIds,
  );
  if ('error' in normalized) return normalized;

  const cardapio = await prisma.cardapio.create({
    data: {
      nome: params.nome.trim(),
      cervejariaId: params.cervejariaId,
    },
  });

  await replaceCardapioProdutos(cardapio.id, normalized.itens);
  return getCardapioById(cardapio.id, params.cervejariaId);
}

export async function updateCardapio(params: {
  id: string;
  cervejariaId: string;
  nome?: string;
  itens?: CardapioItemInput[];
  produtoIds?: string[];
}) {
  const existing = await prisma.cardapio.findFirst({
    where: { id: params.id, cervejariaId: params.cervejariaId },
  });
  if (!existing) return { error: 'Cardápio não encontrado' as const };

  if (params.itens !== undefined || params.produtoIds !== undefined) {
    const normalized = await normalizeItensCardapio(
      params.cervejariaId,
      params.itens,
      params.produtoIds,
    );
    if ('error' in normalized) return normalized;
    await replaceCardapioProdutos(params.id, normalized.itens);
  }

  if (params.nome !== undefined) {
    await prisma.cardapio.update({
      where: { id: params.id },
      data: { nome: params.nome.trim() },
    });
  }

  const updated = await getCardapioById(params.id, params.cervejariaId);
  return updated!;
}

export async function getProdutoIdsFromCardapio(cardapioId: string, cervejariaId: string) {
  const cardapio = await prisma.cardapio.findFirst({
    where: { id: cardapioId, cervejariaId, ativo: true },
    include: { produtos: { select: { produtoId: true } } },
  });
  if (!cardapio) return { error: 'Cardápio não encontrado' as const };
  return { ok: true as const, produtoIds: cardapio.produtos.map((p) => p.produtoId) };
}
