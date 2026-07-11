import { prisma } from './prisma.js';
import { isBebidaChope, isVendaUnitaria } from './produto-utils.js';

const produtoInclude = {
  include: { precos: { orderBy: { volumeMl: 'asc' as const } } },
};

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
    produtos: cardapio.produtos.map((p) => p.produto),
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

async function replaceCardapioProdutos(cardapioId: string, produtoIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.cardapioProduto.deleteMany({ where: { cardapioId } });
    if (produtoIds.length > 0) {
      await tx.cardapioProduto.createMany({
        data: produtoIds.map((produtoId) => ({ cardapioId, produtoId })),
      });
    }
  });
}

export async function createCardapio(params: {
  cervejariaId: string;
  nome: string;
  produtoIds: string[];
}) {
  const validated = await validateProdutosCardapio(params.cervejariaId, params.produtoIds);
  if ('error' in validated) return validated;

  const cardapio = await prisma.cardapio.create({
    data: {
      nome: params.nome.trim(),
      cervejariaId: params.cervejariaId,
    },
  });

  await replaceCardapioProdutos(cardapio.id, validated.produtoIds);
  return getCardapioById(cardapio.id, params.cervejariaId);
}

export async function updateCardapio(params: {
  id: string;
  cervejariaId: string;
  nome?: string;
  produtoIds?: string[];
}) {
  const existing = await prisma.cardapio.findFirst({
    where: { id: params.id, cervejariaId: params.cervejariaId },
  });
  if (!existing) return { error: 'Cardápio não encontrado' as const };

  if (params.produtoIds !== undefined) {
    const validated = await validateProdutosCardapio(params.cervejariaId, params.produtoIds);
    if ('error' in validated) return validated;
    await replaceCardapioProdutos(params.id, validated.produtoIds);
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
