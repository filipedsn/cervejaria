import { prisma } from './prisma.js';
import { getProdutoIdsFromCardapio, validateProdutosCardapio } from './cardapio.js';
import { mapPrecosCardapioCervejaria } from './cardapio-preco.js';
import { cervejariaUsaCardapio } from './cardapio-toggle.js';
import { isVendaUnitaria } from './produto-utils.js';
import { toNumber } from './utils.js';

type AplicarCardapioResult = { ok: true; count: number } | { error: string };

const produtoInclude = {
  precos: { orderBy: { volumeMl: 'asc' as const } },
  opcionaisVinculados: { include: { opcional: true }, orderBy: [{ ordem: 'asc' as const }] },
};

export async function findEventoCardapioSessao(eventoId: string, cervejariaId: string) {
  return prisma.evento.findFirst({
    where: { id: eventoId, cervejariaId, recorrencia: 'NENHUMA' },
    select: { id: true, status: true, cardapioId: true },
  });
}

function enriquecerProdutosComPrecoTemplate<
  T extends { id: string; precos: { volumeMl: number; preco: unknown }[] },
>(produtos: T[], precosTemplate: Map<string, number> | null) {
  if (!precosTemplate) {
    return produtos.map((p) => ({
      ...p,
      precoEfetivo: p.precos[0] ? toNumber(p.precos[0].preco) : 0,
    }));
  }

  return produtos.map((p) => {
    const templatePreco = precosTemplate.get(p.id);
    if (templatePreco === undefined) {
      return { ...p, precoEfetivo: p.precos[0] ? toNumber(p.precos[0].preco) : 0 };
    }
    return {
      ...p,
      precoEfetivo: templatePreco,
      precos: p.precos.length
        ? p.precos.map((pr, idx) => (idx === 0 ? { ...pr, preco: templatePreco } : pr))
        : [{ volumeMl: 0, preco: templatePreco }],
    };
  });
}

export async function listCatalogoCardapio(cervejariaId: string) {
  const produtos = await prisma.produto.findMany({
    where: { cervejariaId, ativo: true },
    include: produtoInclude,
    orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
  });

  return produtos.filter((p) => isVendaUnitaria(p.tipo, p.formato));
}

export async function listProdutosDoEvento(eventoId: string) {
  const rows = await prisma.eventoProduto.findMany({
    where: { eventoId },
    include: { produto: { include: produtoInclude } },
    orderBy: { produto: { nome: 'asc' } },
  });

  return rows.map((r) => r.produto);
}

export async function getEventoCardapio(eventoId: string, cervejariaId: string) {
  const evento = await findEventoCardapioSessao(eventoId, cervejariaId);
  if (!evento) return null;

  const usaCardapio = await cervejariaUsaCardapio(cervejariaId);
  if (!usaCardapio) {
    const catalogoRaw = await listCatalogoCardapio(cervejariaId);
    const produtos = enriquecerProdutosComPrecoTemplate(catalogoRaw, null);
    return {
      produtos,
      produtoIds: produtos.map((p) => p.id),
      catalogo: produtos,
      editavel: false,
      cardapioId: null,
    };
  }

  const [produtosRaw, catalogoRaw] = await Promise.all([
    listProdutosDoEvento(eventoId),
    listCatalogoCardapio(cervejariaId),
  ]);

  const precosTemplate = evento.cardapioId
    ? await mapPrecosCardapioCervejaria(evento.cardapioId)
    : null;

  const produtos = enriquecerProdutosComPrecoTemplate(produtosRaw, precosTemplate);
  const catalogo = enriquecerProdutosComPrecoTemplate(catalogoRaw, precosTemplate);

  return {
    produtos,
    produtoIds: produtos.map((p) => p.id),
    catalogo,
    editavel: true,
    cardapioId: evento.cardapioId,
  };
}

export async function assertProdutoNoCardapioEvento(eventoId: string, produtoId: string) {
  const row = await prisma.eventoProduto.findUnique({
    where: { eventoId_produtoId: { eventoId, produtoId } },
  });
  return !!row;
}

export async function setProdutosDoEvento(eventoId: string, produtoIds: string[]) {
  const uniqueIds = [...new Set(produtoIds)];
  await prisma.$transaction(async (tx) => {
    await tx.eventoProduto.deleteMany({ where: { eventoId } });
    if (uniqueIds.length > 0) {
      await tx.eventoProduto.createMany({
        data: uniqueIds.map((produtoId) => ({ eventoId, produtoId })),
      });
    }
  });
}

export async function copiarCardapioEntreEventos(deEventoId: string, paraEventoId: string) {
  const rows = await prisma.eventoProduto.findMany({
    where: { eventoId: deEventoId },
    select: { produtoId: true },
  });
  await setProdutosDoEvento(
    paraEventoId,
    rows.map((r) => r.produtoId),
  );
}

export async function aplicarCardapioInicialEvento(params: {
  eventoId: string;
  cervejariaId: string;
  cardapioId?: string;
  produtoIds?: string[];
}): Promise<AplicarCardapioResult> {
  const { eventoId, cervejariaId, cardapioId, produtoIds } = params;
  if (!cardapioId && !produtoIds?.length) return { ok: true as const, count: 0 };

  let ids: string[];
  if (cardapioId) {
    const fromTemplate = await getProdutoIdsFromCardapio(cardapioId, cervejariaId);
    if ('error' in fromTemplate) return fromTemplate;
    ids = fromTemplate.produtoIds;
    await prisma.evento.update({
      where: { id: eventoId },
      data: { cardapioId },
    });
  } else {
    const validated = await validateProdutosCardapio(cervejariaId, produtoIds ?? []);
    if ('error' in validated) return validated;
    ids = validated.produtoIds;
  }

  await setProdutosDoEvento(eventoId, ids);
  return { ok: true as const, count: ids.length };
}

/** Se o evento ficou sem cardápio, inclui comidas e bebidas unitárias do catálogo. */
export async function aplicarCardapioCatalogoSeVazio(eventoId: string, cervejariaId: string) {
  const count = await prisma.eventoProduto.count({ where: { eventoId } });
  if (count > 0) return count;

  const catalog = await listCatalogoCardapio(cervejariaId);
  if (catalog.length === 0) return 0;

  await setProdutosDoEvento(
    eventoId,
    catalog.map((p) => p.id),
  );
  return catalog.length;
}

export async function salvarCardapioEvento(params: {
  eventoId: string;
  cervejariaId: string;
  cardapioId?: string;
  produtoIds?: string[];
}) {
  const { eventoId, cervejariaId, cardapioId, produtoIds } = params;

  if (!(await cervejariaUsaCardapio(cervejariaId))) {
    return { error: 'Cardápio desativado para esta empresa' as const };
  }

  const evento = await findEventoCardapioSessao(eventoId, cervejariaId);
  if (!evento) return { error: 'Evento não encontrado' as const };

  if (cardapioId && produtoIds !== undefined) {
    return { error: 'Escolha um cardápio salvo ou monte na hora, não os dois' as const };
  }

  if (cardapioId) {
    const applied = await aplicarCardapioInicialEvento({ eventoId, cervejariaId, cardapioId });
    if ('error' in applied) return applied;
    return { ok: true as const, count: applied.count };
  }

  const uniqueIds = [...new Set(produtoIds ?? [])];
  if (uniqueIds.length === 0) {
    await setProdutosDoEvento(eventoId, []);
    await prisma.evento.update({
      where: { id: eventoId },
      data: { cardapioId: null },
    });
    return { ok: true as const, count: 0 };
  }

  const validated = await validateProdutosCardapio(cervejariaId, uniqueIds);
  if ('error' in validated) return validated;

  await setProdutosDoEvento(eventoId, validated.produtoIds);
  await prisma.evento.update({
    where: { id: eventoId },
    data: { cardapioId: null },
  });

  return { ok: true as const, count: validated.produtoIds.length };
}
