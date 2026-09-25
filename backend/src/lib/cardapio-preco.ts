import { prisma } from './prisma.js';
import { toNumber } from './utils.js';

export type CardapioItemInput = { produtoId: string; precoUnit: number };

/** Preco do item no template de cardapio da cervejaria, ou null se nao encontrado. */
export async function resolvePrecoCardapioCervejaria(
  cardapioId: string,
  produtoId: string,
): Promise<number | null> {
  const row = await prisma.cardapioProduto.findUnique({
    where: { cardapioId_produtoId: { cardapioId, produtoId } },
    select: { precoUnit: true },
  });
  return row ? toNumber(row.precoUnit) : null;
}

/** Mapa produtoId -> precoUnit para todos os itens de um template. */
export async function mapPrecosCardapioCervejaria(cardapioId: string) {
  const rows = await prisma.cardapioProduto.findMany({
    where: { cardapioId },
    select: { produtoId: true, precoUnit: true },
  });
  return new Map(rows.map((r) => [r.produtoId, toNumber(r.precoUnit)]));
}

/** Preco do item no template do operacao, ou null se nao encontrado. */
export async function resolvePrecoCardapioOperacao(
  cardapioId: string,
  produtoId: string,
): Promise<number | null> {
  const row = await prisma.cardapioOperacaoProduto.findUnique({
    where: {
      cardapioId_produtoId: { cardapioId, produtoId },
    },
    select: { precoUnit: true },
  });
  return row ? toNumber(row.precoUnit) : null;
}

/** Mapa produtoId -> precoUnit para todos os itens de um template operacao. */
export async function mapPrecosCardapioOperacao(cardapioId: string) {
  const rows = await prisma.cardapioOperacaoProduto.findMany({
    where: { cardapioId },
    select: { produtoId: true, precoUnit: true },
  });
  return new Map(rows.map((r) => [r.produtoId, toNumber(r.precoUnit)]));
}
