import type { FormatoBebida, ProdutoTipo } from '@prisma/client';

export const UNIT_ML = 1;

export function isBebidaChope(tipo: ProdutoTipo | string, formato: FormatoBebida | string | null | undefined): boolean {
  return tipo === 'BEBIDA' && (formato ?? 'CHOPE') === 'CHOPE';
}

/**
 * The former cash-operation product form stored unit prices at volume 1 but
 * left formato null. Preserve those products as unit sales inside operation;
 * event and legacy catalog flows keep using isBebidaChope's null fallback.
 */
export function isBebidaChopeOperacao(produto: {
  tipo: ProdutoTipo | string;
  formato: FormatoBebida | string | null | undefined;
  categoria?: string | null;
  precos?: Array<{ volumeMl: number }>;
}): boolean {
  if (produto.tipo !== 'BEBIDA') return false;
  if (produto.formato === 'CHOPE') return true;
  if (produto.formato) return false;
  const precoUnitarioLegado = produto.categoria?.toLowerCase() !== 'chope'
    && produto.precos?.length === 1
    && produto.precos[0]?.volumeMl === UNIT_ML;
  return !precoUnitarioLegado;
}

/** Only explicitly identified draft beer products may be assigned to an operation tap. */
export function isChopeConfiguravelNaTapOperacao(produto: {
  tipo: ProdutoTipo | string;
  formato: FormatoBebida | string | null | undefined;
  categoria?: string | null;
}): boolean {
  if (produto.tipo !== 'BEBIDA') return false;
  if (produto.formato === 'CHOPE') return true;
  return produto.formato == null && produto.categoria?.trim().toLocaleLowerCase('pt-BR') === 'chope';
}

/** Rótulo sintético quando o chope existe só por torneira/formato, sem categoria PDV. */
export const CATEGORIA_CHOPE = 'Chope';

/** Categoria usada no gate do alerta de balcão (null + chope → "Chope"). */
export function categoriaParaAlertaBalcao(produto: {
  categoria?: string | null;
  tipo?: string | null;
  formato?: string | null;
}): string {
  const named = produto.categoria?.trim();
  if (named) return named;
  if (
    produto.tipo &&
    isChopeConfiguravelNaTapOperacao({
      tipo: produto.tipo,
      formato: produto.formato,
      categoria: produto.categoria,
    })
  ) {
    return CATEGORIA_CHOPE;
  }
  return 'Outros';
}

export function isVendaUnitaria(tipo: ProdutoTipo, formato: FormatoBebida | null | undefined): boolean {
  return tipo === 'COMIDA' || (tipo === 'BEBIDA' && !isBebidaChope(tipo, formato));
}

export function normalizePrecos(
  tipo: ProdutoTipo,
  formato: FormatoBebida | null | undefined,
  precos: { volumeMl: number; preco: number }[],
) {
  if (isVendaUnitaria(tipo, formato)) {
    return [{ volumeMl: UNIT_ML, preco: precos[0]!.preco }];
  }
  return precos;
}

export function produtoFieldsForSave(
  tipo: ProdutoTipo,
  formato: FormatoBebida | null | undefined,
  body: { nome?: string; descricao?: string | null; cor?: string | null; estilo?: string | null },
) {
  const chope = isBebidaChope(tipo, formato);
  return {
    cor: chope ? body.cor ?? null : null,
    estilo: chope ? body.estilo ?? null : null,
    formato: tipo === 'BEBIDA' ? (formato ?? 'CHOPE') : null,
  };
}
