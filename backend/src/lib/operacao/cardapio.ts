import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import type { CardapioItemInput } from '../cardapio-preco.js';
import type { ProdutoIdsCardapioResult } from '../cardapio.js';
import { syncOpenEventsWithCardapio } from '../cardapio-event-sync.js';
import { isBebidaChopeOperacao } from '../produto-utils.js';

export type OperacaoCardapioItemInput = { produtoId: string; volumeMl?: number; precoUnit: number };

type ItensCardapioOperacaoResult =
  | { ok: true; itens: OperacaoCardapioItemInput[] }
  | { error: string };

function defaultPrecoCatalogoOperacao(produto: { precos: Array<{ volumeMl: number; preco: unknown }> }, volumeMl = 0): number {
  return toNumber(produto.precos.find((preco) => preco.volumeMl === (volumeMl || 1))?.preco ?? 0);
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

    const produtos = await prisma.produto.findMany({
      where: { id: { in: validated.produtoIds }, cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });
    const porId = new Map(produtos.map((produto) => [produto.id, produto]));
    const unique = new Map<string, OperacaoCardapioItemInput>();
    for (const item of itens) {
      const produto = porId.get(item.produtoId);
      if (!produto) return { error: 'Um ou mais itens do cardápio são inválidos' };
      const chope = isBebidaChopeOperacao(produto);
      const volumes = item.volumeMl === undefined && chope
        ? produto.precos.filter((preco) => preco.volumeMl > 1).map((preco) => preco.volumeMl)
        : [item.volumeMl ?? 0];
      for (const volumeMl of volumes) {
        if (chope ? volumeMl <= 1 || !produto.precos.some((preco) => preco.volumeMl === volumeMl) : volumeMl !== 0) {
          return { error: 'Volume inválido para o item do cardápio' };
        }
        const precoUnit = item.volumeMl === undefined && chope
          ? defaultPrecoCatalogoOperacao(produto, volumeMl)
          : item.precoUnit;
        if (!(precoUnit > 0)) return { error: 'Informe preço maior que zero para todos os itens' };
        unique.set(`${item.produtoId}:${volumeMl}`, { produtoId: item.produtoId, volumeMl, precoUnit });
      }
    }
    return { ok: true, itens: [...unique.values()] };
  }

  if (produtoIds?.length) {
    const validated = await validateProdutosCardapioOperacao(cervejariaId, produtoIds);
    if ('error' in validated) return validated;

    const produtos = await prisma.produto.findMany({
      where: { id: { in: validated.produtoIds }, cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const itensNormalizados: OperacaoCardapioItemInput[] = [];
    for (const produtoId of validated.produtoIds) {
      const produto = porId.get(produtoId);
      if (!produto) return { error: 'Um ou mais itens do cardápio são inválidos' };
      if (isBebidaChopeOperacao(produto)) {
        for (const preco of produto.precos.filter((item) => item.volumeMl > 1)) {
          itensNormalizados.push({ produtoId, volumeMl: preco.volumeMl, precoUnit: toNumber(preco.preco) });
        }
      } else {
        itensNormalizados.push({ produtoId, volumeMl: 0, precoUnit: defaultPrecoCatalogoOperacao(produto) });
      }
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
  return prisma.cardapio.findMany({
    where: {
      cervejariaId,
      ...(opts?.ativo !== undefined ? { ativo: opts.ativo } : {}),
    },
    include: {
      produtos: {
        include: { produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } } },
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
  const produtosComVolume = new Set(cardapio.produtos.filter((item) => item.volumeMl > 1).map((item) => item.produtoId));
  const itens = cardapio.produtos.flatMap((item) => {
    if (item.volumeMl === 0 && isBebidaChopeOperacao(item.produto)) {
      if (cardapio.chopeVolumesConfigurados) return [];
      if (produtosComVolume.has(item.produtoId)) return [];
      return item.produto.precos
        .filter((preco) => preco.volumeMl > 1)
        .map((preco) => ({ produtoId: item.produtoId, volumeMl: preco.volumeMl, precoUnit: toNumber(preco.preco), produto: item.produto }));
    }
    return [{ produtoId: item.produtoId, volumeMl: item.volumeMl, precoUnit: toNumber(item.precoUnit), produto: item.produto }];
  });
  return {
    id: cardapio.id,
    nome: cardapio.nome,
    ativo: cardapio.ativo,
    cervejariaId: cardapio.cervejariaId,
    produtoIds: [...new Set(cardapio.produtos.map((p) => p.produtoId))],
    itens: itens.map((item) => ({ produtoId: item.produtoId, volumeMl: item.volumeMl, precoUnit: item.precoUnit, produto: item.produto })),
    produtos: itens.map((item) => ({
      ...item.produto,
      volumeMl: item.volumeMl,
      precoUnit: String(item.precoUnit),
      precoEfetivo: item.precoUnit,
    })),
    itemCount: itens.length,
  };
}

export async function getCardapioOperacaoById(id: string, cervejariaId: string) {
  const cardapio = await prisma.cardapio.findFirst({
    where: { id, cervejariaId },
    include: {
      produtos: {
        include: { produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } } },
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
  cervejariaId: string,
  itens: OperacaoCardapioItemInput[],
) {
  await prisma.$transaction(async (tx) => {
    const sessoesAbertas = await tx.sessaoCaixaOperacao.findMany({
      where: { cardapioId, status: 'ABERTO' },
      select: { id: true },
    });
    const sessaoIds = sessoesAbertas.map((sessao) => sessao.id);
    const produtosDosTurnos = sessaoIds.length
      ? await tx.sessaoCaixaProdutoOperacao.findMany({
          where: { sessaoCaixaId: { in: sessaoIds } },
          select: { sessaoCaixaId: true, produtoId: true, volumeMl: true, precoUnit: true },
        })
      : [];
    const precosPersonalizados = new Map(
      produtosDosTurnos.flatMap((item) => item.precoUnit === null
        ? []
        : [[`${item.sessaoCaixaId}:${item.produtoId}:${item.volumeMl}`, item.precoUnit] as const]),
    );

    const existentes = await tx.cardapioProduto.findMany({
      where: { cardapioId },
      include: { produto: { include: { precos: { select: { volumeMl: true } } } } },
    });
    const chopesLegados = new Set([
      ...existentes.filter((item) => isBebidaChopeOperacao(item.produto)).map((item) => item.produtoId),
      ...itens.filter((item) => (item.volumeMl ?? 0) > 1).map((item) => item.produtoId),
    ]);
    await tx.cardapioProduto.deleteMany({
      where: {
        cardapioId,
        OR: [
          { volumeMl: { gt: 0 } },
          { volumeMl: 0, ...(chopesLegados.size ? { produtoId: { notIn: [...chopesLegados] } } : {}) },
        ],
      },
    });
    if (itens.length > 0) {
      await tx.cardapioProduto.createMany({
        data: itens.map((item) => ({
          cardapioId,
          produtoId: item.produtoId,
          volumeMl: item.volumeMl ?? 0,
          precoUnit: item.precoUnit,
        })),
      });
    }
    await syncOpenEventsWithCardapio(tx, {
      cardapioId,
      cervejariaId,
      produtoIds: [...new Set(itens.filter((item) => (item.volumeMl ?? 0) === 0).map((item) => item.produtoId))],
    });
    await tx.cardapio.update({ where: { id: cardapioId }, data: { chopeVolumesConfigurados: true } });

    // Atualiza a lista materializada de produtos dos turnos vinculados ao
    // template. Overrides de preço são mantidos apenas para itens preservados.
    if (sessaoIds.length > 0) {
      await tx.sessaoCaixaProdutoOperacao.deleteMany({ where: { sessaoCaixaId: { in: sessaoIds } } });
      const produtosAtualizados = sessaoIds.flatMap((sessaoCaixaId) => itens.map((item) => ({
        sessaoCaixaId,
        produtoId: item.produtoId,
        volumeMl: item.volumeMl ?? 0,
        precoUnit: precosPersonalizados.get(`${sessaoCaixaId}:${item.produtoId}:${item.volumeMl ?? 0}`) ?? null,
      })));
      if (produtosAtualizados.length > 0) {
        await tx.sessaoCaixaProdutoOperacao.createMany({ data: produtosAtualizados });
      }
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

  const cardapio = await prisma.cardapio.create({
    data: {
      nome: params.nome.trim(),
      cervejariaId: params.cervejariaId,
    },
  });

  await replaceCardapioOperacaoProdutos(cardapio.id, params.cervejariaId, normalized.itens);
  return getCardapioOperacaoById(cardapio.id, params.cervejariaId);
}

export async function updateCardapioOperacao(params: {
  id: string;
  cervejariaId: string;
  nome?: string;
  itens?: OperacaoCardapioItemInput[];
  produtoIds?: string[];
}) {
  const existing = await prisma.cardapio.findFirst({
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
    await replaceCardapioOperacaoProdutos(params.id, params.cervejariaId, normalized.itens);
  }

  if (params.nome !== undefined) {
    await prisma.cardapio.update({
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
  const cardapio = await prisma.cardapio.findFirst({
    where: { id: cardapioId, cervejariaId, ativo: true },
    include: { produtos: { select: { produtoId: true } } },
  });
  if (!cardapio) return { error: 'Cardápio não encontrado' as const };
  return { ok: true as const, produtoIds: cardapio.produtos.map((p) => p.produtoId) };
}

export async function getItensCardapioOperacao(
  cardapioId: string,
  cervejariaId: string,
): Promise<{ ok: true; itens: Array<{ produtoId: string; volumeMl: number }> } | { error: string }> {
  const cardapio = await prisma.cardapio.findFirst({
    where: { id: cardapioId, cervejariaId, ativo: true },
    include: { produtos: { include: { produto: { include: { precos: { orderBy: { volumeMl: 'asc' } } } } } } },
  });
  if (!cardapio) return { error: 'Cardápio não encontrado' };
  const produtosComVolume = new Set(cardapio.produtos.filter((item) => item.volumeMl > 1).map((item) => item.produtoId));
  const itens = cardapio.produtos.flatMap((item) => {
    if (item.volumeMl === 0 && isBebidaChopeOperacao(item.produto)) {
      if (cardapio.chopeVolumesConfigurados) return [];
      if (produtosComVolume.has(item.produtoId)) return [];
      return item.produto.precos.filter((preco) => preco.volumeMl > 1)
        .map((preco) => ({ produtoId: item.produtoId, volumeMl: preco.volumeMl }));
    }
    return [{ produtoId: item.produtoId, volumeMl: item.volumeMl }];
  });
  return { ok: true, itens };
}

export async function listCatalogoCardapioOperacao(cervejariaId: string) {
  return prisma.produto.findMany({
    where: { cervejariaId, ativo: true },
    include: { precos: { orderBy: { volumeMl: 'asc' } } },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
}

// re-export for typing compatibility
export type { CardapioItemInput };
