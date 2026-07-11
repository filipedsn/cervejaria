import type { FormatoBebida, ProdutoTipo } from '@prisma/client';

export const UNIT_ML = 1;

export function isBebidaChope(tipo: ProdutoTipo, formato: FormatoBebida | null | undefined): boolean {
  return tipo === 'BEBIDA' && (formato ?? 'CHOPE') === 'CHOPE';
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
