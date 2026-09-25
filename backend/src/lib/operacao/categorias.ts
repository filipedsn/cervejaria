import { z } from 'zod';

/** Categorias padrao do catalogo do quiosque (agrupamento no PDV). */
export const CATEGORIAS_PRODUTO_QUIOSQUE = [
  'Bebidas',
  'Cervejas',
  'Drinks',
  'Porções',
  'Lanches',
  'Salgados',
  'Doces e sobremesas',
  'Combos',
  'Outros',
] as const;

export type CategoriaProdutoQuiosque = (typeof CATEGORIAS_PRODUTO_QUIOSQUE)[number];

const categoriasSet = new Set<string>(CATEGORIAS_PRODUTO_QUIOSQUE);

export function isCategoriaProdutoQuiosque(value: string): value is CategoriaProdutoQuiosque {
  return categoriasSet.has(value);
}

/** Normaliza texto livre legado para a categoria canonica mais proxima. */
export function normalizeCategoriaProduto(value: string | null | undefined): CategoriaProdutoQuiosque {
  if (!value?.trim()) return 'Outros';
  const trimmed = value.trim();
  const exact = CATEGORIAS_PRODUTO_QUIOSQUE.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  if (lower.includes('cervej')) return 'Cervejas';
  if (lower.includes('drink') || lower.includes('coquetel')) return 'Drinks';
  if (lower.includes('porç') || lower.includes('porc')) return 'Porções';
  if (lower.includes('lanche') || lower.includes('hamb')) return 'Lanches';
  if (lower.includes('salg') || lower.includes('pastel') || lower.includes('coxinh')) return 'Salgados';
  if (lower.includes('doce') || lower.includes('sobremesa') || lower.includes('sobremesas')) return 'Doces e sobremesas';
  if (lower.includes('combo') || lower.includes('promo')) return 'Combos';
  if (lower.includes('beb')) return 'Bebidas';

  return 'Outros';
}

export const categoriaProdutoQuiosqueSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeCategoriaProduto)
  .refine(isCategoriaProdutoQuiosque, { message: 'Categoria invalida' });
