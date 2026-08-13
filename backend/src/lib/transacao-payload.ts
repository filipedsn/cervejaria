import { redactObject } from './audit/redact.js';

/** Serializa objeto de negócio para audit/Elastic (JSON-safe + redação). */
export function prepareTransacaoPayload(value: unknown): unknown {
  if (value == null) return null;
  const jsonSafe = JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val instanceof Date) return val.toISOString();
      if (
        typeof val === 'object' &&
        val !== null &&
        'toNumber' in val &&
        typeof (val as { toNumber: () => number }).toNumber === 'function'
      ) {
        return (val as { toNumber: () => number }).toNumber();
      }
      return val;
    }),
  );
  return redactObject(jsonSafe);
}

export function mergeTransacaoMetadata(
  metadata: Record<string, unknown> | undefined,
  payload: unknown,
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  if (payload != null) {
    base.payload = prepareTransacaoPayload(payload);
  }
  return base;
}
