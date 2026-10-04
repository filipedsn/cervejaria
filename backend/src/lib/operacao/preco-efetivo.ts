import { toNumber } from '../utils.js';

export interface EffectivePrice {
  value: number;
  source: 'TURNO' | 'CARDAPIO' | 'CATALOGO';
}

/** Shared by the live shift menu consumer and migration QA. Null means inherit; zero is explicit. */
export function resolveEffectivePrice(turno: unknown, cardapio: unknown, catalogo: unknown): EffectivePrice {
  if (turno !== null && turno !== undefined) return { value: toNumber(turno), source: 'TURNO' };
  if (cardapio !== null && cardapio !== undefined) return { value: toNumber(cardapio), source: 'CARDAPIO' };
  return { value: toNumber(catalogo ?? 0), source: 'CATALOGO' };
}
