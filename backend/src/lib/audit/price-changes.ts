import { emitAuditEvent } from './emit-audit-event.js';
import { toNumber } from '../utils.js';

export type PriceSnapshot = {
  produtoId: string;
  volumeMl?: number | null;
  /** Cardápio / turno usam precoUnit; catálogo usa preco. */
  precoUnit?: unknown;
  preco?: unknown;
};

export type PriceChange = {
  produtoId: string;
  volumeMl: number;
  fromCents: number | null;
  toCents: number | null;
};

export function toMoneyCents(value: unknown): number {
  return Math.round(toNumber(value) * 100);
}

function priceKey(produtoId: string, volumeMl: number): string {
  return `${produtoId}:${volumeMl}`;
}

function snapshotCents(row: PriceSnapshot): number | null {
  const raw = row.precoUnit !== undefined && row.precoUnit !== null ? row.precoUnit : row.preco;
  if (raw === undefined || raw === null) return null;
  try {
    return toMoneyCents(raw);
  } catch {
    return null;
  }
}

/** Diff before/after em centavos. Itens só adicionados/removidos entram com from/to null. */
export function diffPriceChanges(before: PriceSnapshot[], after: PriceSnapshot[]): PriceChange[] {
  const beforeMap = new Map<string, number | null>();
  for (const row of before) {
    const volumeMl = row.volumeMl ?? 0;
    beforeMap.set(priceKey(row.produtoId, volumeMl), snapshotCents(row));
  }
  const afterMap = new Map<string, number | null>();
  for (const row of after) {
    const volumeMl = row.volumeMl ?? 0;
    afterMap.set(priceKey(row.produtoId, volumeMl), snapshotCents(row));
  }

  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: PriceChange[] = [];
  for (const key of keys) {
    const [produtoId, volumeRaw] = key.split(':');
    const volumeMl = Number(volumeRaw);
    const fromCents = beforeMap.has(key) ? (beforeMap.get(key) ?? null) : null;
    const toCents = afterMap.has(key) ? (afterMap.get(key) ?? null) : null;
    if (fromCents === toCents) continue;
    if (fromCents === null && toCents === null) continue;
    changes.push({ produtoId, volumeMl, fromCents, toCents });
  }
  return changes.sort((a, b) =>
    a.produtoId === b.produtoId ? a.volumeMl - b.volumeMl : a.produtoId.localeCompare(b.produtoId),
  );
}

export function emitPriceChangeAudit(params: {
  cervejariaId: string;
  entityType: 'Cardapio' | 'Produto' | 'SessaoCaixaProduto';
  entityId: string;
  source: string;
  changes: PriceChange[];
  escopo?: 'TURNO' | 'TEMPLATE';
}): void {
  if (!params.changes.length) return;
  emitAuditEvent({
    action: 'catalog.price_changed',
    message: `Alteracao de preco (${params.changes.length} item(ns)) via ${params.source}`,
    outcome: 'success',
    entityType: params.entityType,
    entityId: params.entityId,
    cervejariaId: params.cervejariaId,
    metadata: {
      source: params.source,
      ...(params.escopo ? { escopo: params.escopo } : {}),
      priceChanges: params.changes,
    },
  });
}
