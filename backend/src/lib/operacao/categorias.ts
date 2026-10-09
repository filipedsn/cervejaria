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

export const CATEGORIAS_ABA_COMANDA = ['chope', 'comidas', 'bebidas', 'outros'] as const;

export function normalizarOrdemCategoriasComanda(value: unknown): string[] {
  const config = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { comanda?: unknown }).comanda
    : undefined;
  const custom = Array.isArray(config)
    ? config.filter((item): item is string => typeof item === 'string' && CATEGORIAS_ABA_COMANDA.includes(item as typeof CATEGORIAS_ABA_COMANDA[number]))
    : [];
  const unique = [...new Set(custom)];
  return [...unique, ...CATEGORIAS_ABA_COMANDA.filter((categoria) => !unique.includes(categoria))];
}

export function normalizarOrdemCategoriasProduto(value: unknown, incluirChope = false): string[] {
  const categorias = incluirChope ? [...CATEGORIAS_PRODUTO_OPERACAO, 'Chope'] : [...CATEGORIAS_PRODUTO_OPERACAO];
  const disponiveis = new Set<string>(categorias);
  const ordemCatalogo = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { catalogo?: unknown }).catalogo
    : value;
  const custom = Array.isArray(ordemCatalogo)
    ? ordemCatalogo.filter((item): item is string => typeof item === 'string' && disponiveis.has(item))
    : [];
  const unique = [...new Set(custom)];
  return [...unique, ...categorias.filter((categoria) => !unique.includes(categoria))];
}

export type CategoriaProdutoOperacao = (typeof CATEGORIAS_PRODUTO_OPERACAO)[number] | 'Chope';

const categoriasSet = new Set<string>(CATEGORIAS_PRODUTO_OPERACAO);

export function isCategoriaProdutoOperacao(value: string): value is CategoriaProdutoOperacao {
  return categoriasSet.has(value) || value === 'Chope';
}

/** Normaliza texto livre legado para a categoria canonica mais proxima. */
export function normalizeCategoriaProduto(value: string | null | undefined): string {
  if (!value?.trim()) return 'Outros';
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'chope') return 'Chope';
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

  return trimmed;
}

export const categoriaProdutoOperacaoSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.toLowerCase() === 'chope' || categoriasSet.has(normalizeCategoriaProduto(value)), { message: 'Categoria invalida' })
  .transform(normalizeCategoriaProduto)
  .refine(isCategoriaProdutoOperacao, { message: 'Categoria invalida' });
