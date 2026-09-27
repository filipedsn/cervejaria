import { z } from 'zod';

/** Categorias padrao do catalogo do operacao (agrupamento no PDV). */
export const CATEGORIAS_PRODUTO_OPERACAO = [
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

export function normalizarOrdemCategoriasProduto(value: unknown): string[] {
  const custom = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && categoriasSet.has(item))
    : [];
  const unique = [...new Set(custom)];
  return [...unique, ...CATEGORIAS_PRODUTO_OPERACAO.filter((categoria) => !unique.includes(categoria))];
}

export type CategoriaProdutoOperacao = (typeof CATEGORIAS_PRODUTO_OPERACAO)[number];

const categoriasSet = new Set<string>(CATEGORIAS_PRODUTO_OPERACAO);

export function isCategoriaProdutoOperacao(value: string): value is CategoriaProdutoOperacao {
  return categoriasSet.has(value);
}

/** Normaliza texto livre legado para a categoria canonica mais proxima. */
export function normalizeCategoriaProduto(value: string | null | undefined): CategoriaProdutoOperacao {
  if (!value?.trim()) return 'Outros';
  const trimmed = value.trim();
  const exact = CATEGORIAS_PRODUTO_OPERACAO.find((c) => c.toLowerCase() === trimmed.toLowerCase());
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

export const categoriaProdutoOperacaoSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeCategoriaProduto)
  .refine(isCategoriaProdutoOperacao, { message: 'Categoria invalida' });
