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

/** Preco do item no template do quiosque, ou null se nao encontrado. */
export async function resolvePrecoCardapioQuiosque(
  cardapioId: string,
  produtoQuiosqueId: string,
): Promise<number | null> {
  const row = await prisma.cardapioQuiosqueProduto.findUnique({
    where: {
      cardapioId_produtoQuiosqueId: { cardapioId, produtoQuiosqueId },
    },
    select: { precoUnit: true },
  });
  return row ? toNumber(row.precoUnit) : null;
}

/** Mapa produtoId -> precoUnit para todos os itens de um template quiosque. */
export async function mapPrecosCardapioQuiosque(cardapioId: string) {
  const rows = await prisma.cardapioQuiosqueProduto.findMany({
    where: { cardapioId },
    select: { produtoQuiosqueId: true, precoUnit: true },
  });
  return new Map(rows.map((r) => [r.produtoQuiosqueId, toNumber(r.precoUnit)]));
}
