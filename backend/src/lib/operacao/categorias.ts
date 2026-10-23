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

/** Stable preference key for the synthetic canonical Tap tab; never a catalog category. */
export const CATEGORIA_CHOPE_TAP_ORDEM_ID = '__quiver_pdv_tap_chope__';

function ordemCatalogoSalva(value: unknown): unknown[] {
  const config = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { catalogo?: unknown }).catalogo
    : value;
  return Array.isArray(config) ? config : [];
}

function categoriasUnicasSalvas(raw: readonly unknown[], categorias: readonly string[]): string[] {
  const permitidas = new Set(categorias);
  return [...new Set(raw.filter((item): item is string => typeof item === 'string' && permitidas.has(item)))];
}

/**
 * Canonical shared order includes the Tap tab only while taps are enabled.
 * An old preference has no Tap position, so append it without changing the
 * saved categories' relative order until an operator explicitly reorders them.
 */
export function normalizarOrdemCategoriasCanonicas(
  value: unknown,
  categorias: readonly string[],
  tapsEnabled: boolean,
): string[] {
  const raw = ordemCatalogoSalva(value);
  const saved = categoriasUnicasSalvas(raw, [...categorias, CATEGORIA_CHOPE_TAP_ORDEM_ID]);
  const order = [...saved, ...categorias.filter((categoria) => !saved.includes(categoria))];
  if (!tapsEnabled) return order.filter((item) => item !== CATEGORIA_CHOPE_TAP_ORDEM_ID);
  return order.includes(CATEGORIA_CHOPE_TAP_ORDEM_ID) ? order : [...order, CATEGORIA_CHOPE_TAP_ORDEM_ID];
}

/**
 * Old clients submit only real categories. Preserve a previously saved
 * synthetic Tap position in that case, including while the Tap tab is hidden.
 */
export function persistirOrdemCategoriasCanonicas(
  submitted: readonly string[],
  categorias: readonly string[],
  tapsEnabled: boolean,
  currentValue: unknown,
): string[] {
  const allowed = new Set(categorias);
  const submittedTapKeys = submitted.filter((item) => item === CATEGORIA_CHOPE_TAP_ORDEM_ID);
  const submittedCategories = submitted.filter((item) => item !== CATEGORIA_CHOPE_TAP_ORDEM_ID);
  if (new Set(submitted).size !== submitted.length
    || submittedCategories.length !== categorias.length
    || new Set(submittedCategories).size !== categorias.length
    || submittedCategories.some((item) => !allowed.has(item))
    || submittedTapKeys.length > 1
    || (!tapsEnabled && submittedTapKeys.length > 0)) {
    throw new Error('A ordem deve conter cada categoria disponível uma única vez e somente abas permitidas.');
  }

  if (tapsEnabled && submittedTapKeys.length === 1) return [...submitted];

  const current = ordemCatalogoSalva(currentValue);
  const currentUnique = categoriasUnicasSalvas(current, [...categorias, CATEGORIA_CHOPE_TAP_ORDEM_ID]);
  const tapIndex = currentUnique.indexOf(CATEGORIA_CHOPE_TAP_ORDEM_ID);
  if (tapIndex < 0) return tapsEnabled ? [...submittedCategories, CATEGORIA_CHOPE_TAP_ORDEM_ID] : [...submittedCategories];
  const next = [...submittedCategories];
  next.splice(Math.min(tapIndex, next.length), 0, CATEGORIA_CHOPE_TAP_ORDEM_ID);
  return next;
}

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
