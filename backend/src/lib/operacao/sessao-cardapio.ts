import { prisma } from '../prisma.js';
import { cardapioProdutoVolumeKey, mapPrecosCardapioOperacao } from '../cardapio-preco.js';
import { operacaoUsaCardapio } from '../cardapio-toggle.js';
import { isBebidaChopeOperacao, isChopeConfiguravelNaTapOperacao } from '../produto-utils.js';
import { toNumber } from '../utils.js';
import { resolveEffectivePrice } from './preco-efetivo.js';
import { resolveUniqueOpenCashSession } from './cash-session-resolution.js';

type AplicarCardapioTurnoResult = { ok: true; count: number } | { error: string };
import {
  getItensCardapioOperacao,
  listCatalogoCardapioOperacao,
  validateProdutosCardapioOperacao,
} from './cardapio.js';

export function enriquecerProdutosOperacao<
  T extends { id: string; volumeMl?: number; precos?: Array<{ volumeMl: number; preco: unknown }> },
>(
  produtos: T[],
  precosTemplate: Map<string, number> | null,
  precosTurno?: Map<string, number> | null,
) {
  return produtos.map((p) => {
    const volumeMl = p.volumeMl ?? 0;
    const chave = cardapioProdutoVolumeKey(p.id, volumeMl);
    const turnoPreco = precosTurno?.get(chave);
    const templatePreco = precosTemplate?.get(chave);
    const precoCatalogo = toNumber(p.precos?.find((preco) => preco.volumeMl === (volumeMl || 1))?.preco ?? 0);
    const precoEfetivo = resolveEffectivePrice(turnoPreco, templatePreco, precoCatalogo).value;
    return {
      ...p,
      gruposOpcionais: ((p as T & { opcionaisVinculados?: Array<{ opcional: { id: string; nome: string; preco: unknown } }> }).opcionaisVinculados ?? []).length ? [{ id: 'opcionais', nome: 'Opcionais', obrigatorio: false, maximo: 99, opcoes: (p as T & { opcionaisVinculados: Array<{ opcional: { id: string; nome: string; preco: unknown } }> }).opcionaisVinculados.map(({ opcional }) => ({ id: opcional.id, nome: opcional.nome, precoAdicional: toNumber(opcional.preco) })) }] : [],
      precoUnit: String(precoEfetivo),
      precoEfetivo,
      precoOverrideTurno: turnoPreco !== undefined,
      volumeMl,
    };
  });
}

/** Overrides de preço gravados só neste turno (null no banco = herda). */
export async function mapPrecosTurno(sessaoCaixaId: string) {
  const rows = await prisma.sessaoCaixaProdutoOperacao.findMany({
    where: { sessaoCaixaId, precoUnit: { not: null } },
    select: { produtoId: true, volumeMl: true, precoUnit: true },
  });
  return new Map(
    rows.flatMap((row) =>
      row.precoUnit === null ? [] : [[cardapioProdutoVolumeKey(row.produtoId, row.volumeMl), toNumber(row.precoUnit)]],
    ),
  );
}

export async function listProdutosDoTurno(sessaoCaixaId: string) {
  const rows = await prisma.sessaoCaixaProdutoOperacao.findMany({
    where: { sessaoCaixaId },
    include: {
      produto: {
        include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      },
    },
    orderBy: { produto: { nome: 'asc' } },
  });

  const produtosComVolume = new Set(rows.filter((row) => row.volumeMl > 1).map((row) => row.produtoId));
  return rows.flatMap((r) => {
    if (r.volumeMl === 0 && isBebidaChopeOperacao(r.produto)) {
      if (produtosComVolume.has(r.produtoId)) return [];
      return r.produto.precos.filter((preco) => preco.volumeMl > 1)
        .map((preco) => ({ ...r.produto, volumeMl: preco.volumeMl }));
    }
    return [{ ...r.produto, volumeMl: r.volumeMl }];
  });
}

export async function getCardapioTurno(sessaoCaixaId: string, cervejariaId: string) {
  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessaoCaixaId, cervejariaId },
    select: {
      id: true,
      status: true,
      cardapioId: true,
      cardapio: { select: { id: true, nome: true } },
    },
  });
  if (!sessao) return null;

  const usaCardapio = await operacaoUsaCardapio(cervejariaId);
  if (!usaCardapio) {
    const catalogoRaw = await listCatalogoCardapioOperacao(cervejariaId);
    const produtos = enriquecerProdutosOperacao(catalogoRaw, null);
    return {
      produtos,
      produtoIds: [...new Set(produtos.map((p) => p.id))],
      catalogo: produtos,
      editavel: false,
      cardapioId: null,
      cardapioNome: null,
    };
  }

  const [precosTemplate, precosTurno, produtosRaw, catalogoRaw] = await Promise.all([
    sessao.cardapioId
      ? mapPrecosCardapioOperacao(sessao.cardapioId)
      : Promise.resolve(null),
    mapPrecosTurno(sessaoCaixaId),
    listProdutosDoTurno(sessaoCaixaId),
    listCatalogoCardapioOperacao(cervejariaId),
  ]);

  const produtos = enriquecerProdutosOperacao(produtosRaw, precosTemplate, precosTurno);
  const catalogo = enriquecerProdutosOperacao(catalogoRaw, precosTemplate, precosTurno);

  return {
    produtos,
    produtoIds: [...new Set(produtos.map((p) => p.id))],
    catalogo,
    editavel: sessao.status === 'ABERTO',
    cardapioId: sessao.cardapioId,
    cardapioNome: sessao.cardapio?.nome ?? null,
  };
}

export async function assertProdutoNoCardapioTurno(sessaoCaixaId: string, produtoId: string, volumeMl = 0) {
  const row = await prisma.sessaoCaixaProdutoOperacao.findFirst({ where: { sessaoCaixaId, produtoId, volumeMl } });
  if (row || volumeMl <= 1) return !!row;
  const hasVariantRows = await prisma.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId, produtoId, volumeMl: { gt: 1 } } });
  if (hasVariantRows > 0) return false;
  return Boolean(await prisma.sessaoCaixaProdutoOperacao.findFirst({ where: { sessaoCaixaId, produtoId, volumeMl: 0 } }));
}

export async function setProdutosDoTurno(sessaoCaixaId: string, itens: Array<{ produtoId: string; volumeMl: number }>) {
  const unique = new Map(itens.map((item) => [`${item.produtoId}:${item.volumeMl}`, item]));
  await prisma.$transaction(async (tx) => {
    await tx.sessaoCaixaProdutoOperacao.deleteMany({ where: { sessaoCaixaId } });
    if (unique.size > 0) {
      await tx.sessaoCaixaProdutoOperacao.createMany({
        data: [...unique.values()].map((item) => ({ sessaoCaixaId, produtoId: item.produtoId, volumeMl: item.volumeMl })),
      });
    }
  });
}

async function expandirProdutosEmVariantes(cervejariaId: string, produtoIds: string[]) {
  const produtos = await prisma.produto.findMany({
    where: { cervejariaId, ativo: true, id: { in: [...new Set(produtoIds)] } },
    include: { precos: { select: { volumeMl: true } } },
  });
  return produtos.flatMap((produto) => isBebidaChopeOperacao(produto)
    ? produto.precos.filter((preco) => preco.volumeMl > 1).map((preco) => ({ produtoId: produto.id, volumeMl: preco.volumeMl }))
    : [{ produtoId: produto.id, volumeMl: 0 }]);
}

export async function aplicarCardapioInicialTurno(params: {
  sessaoCaixaId: string;
  cervejariaId: string;
  cardapioId?: string;
  produtoIds?: string[];
}): Promise<AplicarCardapioTurnoResult> {
  const { sessaoCaixaId, cervejariaId, cardapioId, produtoIds } = params;
  if (!cardapioId && !produtoIds?.length) return { ok: true as const, count: 0 };

  let itens: Array<{ produtoId: string; volumeMl: number }>;
  if (cardapioId) {
    const fromTemplate = await getItensCardapioOperacao(cardapioId, cervejariaId);
    if ('error' in fromTemplate) return fromTemplate;
    itens = fromTemplate.itens;
    await prisma.sessaoCaixaOperacao.update({
      where: { id: sessaoCaixaId },
      data: { cardapioId },
    });
  } else {
    const validated = await validateProdutosCardapioOperacao(cervejariaId, produtoIds ?? []);
    if ('error' in validated) return validated;
    itens = await expandirProdutosEmVariantes(cervejariaId, validated.produtoIds);
  }

  await setProdutosDoTurno(sessaoCaixaId, itens);
  return { ok: true as const, count: itens.length };
}

/** Se o turno ficou sem cardapio, inclui todos os produtos ativos do catalogo. */
export async function aplicarCardapioCatalogoSeVazio(sessaoCaixaId: string, cervejariaId: string) {
  const count = await prisma.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId } });
  if (count > 0) return count;

  const catalog = await listCatalogoCardapioOperacao(cervejariaId);
  if (catalog.length === 0) return 0;

  await setProdutosDoTurno(
    sessaoCaixaId,
    catalog.flatMap((p) => isBebidaChopeOperacao(p)
      ? p.precos.filter((preco) => preco.volumeMl > 1).map((preco) => ({ produtoId: p.id, volumeMl: preco.volumeMl }))
      : [{ produtoId: p.id, volumeMl: 0 }]),
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

  if (!(await operacaoUsaCardapio(cervejariaId))) {
    return { error: 'Cardápio desativado para esta empresa' as const };
  }

  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
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
    await prisma.sessaoCaixaOperacao.update({
      where: { id: sessaoCaixaId },
      data: { cardapioId: null },
    });
    return { ok: true as const, count: 0 };
  }

  const validated = await validateProdutosCardapioOperacao(cervejariaId, uniqueIds);
  if ('error' in validated) return validated;

  const itens = await expandirProdutosEmVariantes(cervejariaId, validated.produtoIds);
  await setProdutosDoTurno(sessaoCaixaId, itens);
  await prisma.sessaoCaixaOperacao.update({
    where: { id: sessaoCaixaId },
    data: { cardapioId: null },
  });

  return { ok: true as const, count: itens.length };
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
  volumeMl?: number;
  precoUnit: number;
  escopo: 'TURNO' | 'TEMPLATE';
}): Promise<AlterarPrecoCardapioTurnoResult> {
  const { sessaoCaixaId, cervejariaId, produtoId, volumeMl = 0, precoUnit, escopo } = params;

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (produto && (isBebidaChopeOperacao(produto)
    ? volumeMl <= 1 || !produto.precos.some((preco) => preco.volumeMl === volumeMl)
    : volumeMl !== 0)) {
    return { error: 'Volume inválido para o item do cardápio.' as const, statusCode: 400 as const };
  }

  if (!(await operacaoUsaCardapio(cervejariaId))) {
    return { error: 'Cardápio desativado para esta empresa' as const, statusCode: 400 as const };
  }
  if (!(precoUnit > 0)) {
    return { error: 'Informe um preço maior que zero' as const, statusCode: 400 as const };
  }

  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessaoCaixaId, cervejariaId, status: 'ABERTO' },
    select: { id: true, cardapioId: true },
  });
  if (!sessao) {
    return { error: 'Turno de caixa não encontrado ou já fechado' as const, statusCode: 404 as const };
  }

  const noTurno = await prisma.sessaoCaixaProdutoOperacao.findFirst({
    where: { sessaoCaixaId, produtoId, volumeMl },
  });
  if (!noTurno) {
    return { error: 'Produto não está no cardápio deste turno' as const, statusCode: 400 as const };
  }

  if (escopo === 'TURNO') {
    await prisma.sessaoCaixaProdutoOperacao.update({
      where: { id: noTurno.id },
      data: { precoUnit },
    });
    return { ok: true as const, escopo: 'TURNO' as const };
  }

  if (!sessao.cardapioId) {
    return {
      error: 'Nenhum cardápio salvo vinculado a este turno. Use alteração só do turno.',
      statusCode: 400 as const,
    };
  }

  const templateItem = await prisma.cardapioProduto.findFirst({
    where: { cardapioId: sessao.cardapioId, produtoId, volumeMl },
  });
  if (!templateItem) {
    return {
      error: 'Produto não pertence ao cardápio salvo vinculado',
      statusCode: 400 as const,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.cardapioProduto.update({
      where: { id: templateItem.id },
      data: { precoUnit },
    });
    // Limpa override do turno para herdar o novo preço do template.
    await tx.sessaoCaixaProdutoOperacao.update({
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
  tapsEnabled = false,
  incluirTodosChopes = false,
) {
  const usaCardapio = await operacaoUsaCardapio(cervejariaId);
  if (!usaCardapio) {
    const produtos = await prisma.produto.findMany({
      where: { cervejariaId, ativo: true },
      include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    return enriquecerProdutosOperacao(produtos, null);
  }

  const sessoes = await prisma.sessaoCaixaOperacao.findMany({
    where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
    orderBy: { abertoEm: 'desc' },
    select: { id: true, cardapioId: true },
    take: 2,
  });
  const sessao = resolveUniqueOpenCashSession(sessoes);

  if (!sessao) {
    const produtos = await prisma.produto.findMany({
      where: { cervejariaId, ativo: true },
      include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    return enriquecerProdutosOperacao(produtos, null);
  }

  const [produtos, precosTemplate, precosTurno] = await Promise.all([
    listProdutosDoTurno(sessao.id),
    sessao.cardapioId
      ? mapPrecosCardapioOperacao(sessao.cardapioId)
      : Promise.resolve(null),
    mapPrecosTurno(sessao.id),
  ]);
  const produtosAtivos = produtos.filter((produto) => produto.ativo && (tapsEnabled || !isBebidaChopeOperacao(produto)));
  const produtosMapeados = enriquecerProdutosOperacao(produtosAtivos, precosTemplate, precosTurno);
  if (!incluirTodosChopes || !tapsEnabled) return produtosMapeados;
  const chopes = await prisma.produto.findMany({
    where: { cervejariaId, ativo: true, tipo: 'BEBIDA', OR: [{ formato: 'CHOPE' }, { formato: null }] },
    include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
  const chopesMapeados = enriquecerProdutosOperacao(chopes.filter(isChopeConfiguravelNaTapOperacao), null);
  return [...produtosMapeados.filter((produto) => !isBebidaChopeOperacao(produto)), ...chopesMapeados];
}
