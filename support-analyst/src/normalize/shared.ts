import { createHash } from 'node:crypto';
import type { NormalizationFailure, RawEventDocument } from '../types.js';

export type SourceRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is SourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getPath(source: SourceRecord, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function firstString(source: SourceRecord, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function firstNumber(source: SourceRecord, ...paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function normalizedTimestamp(source: SourceRecord): { value?: string; reason?: NormalizationFailure } {
  const timestamp = firstString(source, '@timestamp', 'timestamp');
  if (!timestamp) return { reason: 'missing_timestamp' };
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return { reason: 'invalid_timestamp' };
  return { value: new Date(parsed).toISOString() };
}

export function validRawRef(raw: RawEventDocument): boolean {
  return typeof raw.index === 'string' && raw.index.length > 0 && typeof raw.id === 'string' && raw.id.length > 0;
}

export function eventIdFor(raw: RawEventDocument): string {
  const digest = createHash('sha256').update(`${raw.index}\u0000${raw.id}`, 'utf8').digest('hex');
  return `sa1:${digest}`;
}

export function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}
