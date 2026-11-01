import type { JourneyEvent } from './types.js';

/** Reads `a.b.c` whether stored as a dotted key (`attributes['user.id']`) or as nested objects. */
export function readDotted(value: unknown, path: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (path in record) return record[path];
  const parts = path.split('.');
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const head = parts.slice(0, i).join('.');
    if (head in record) {
      const found = readDotted(record[head], parts.slice(i).join('.'));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function text(value: unknown, max = 300): string | undefined {
  if (Array.isArray(value)) value = value.filter((item) => typeof item === 'string' || typeof item === 'number').join(',');
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function first(attributes: unknown, paths: string[], max?: number): string | undefined {
  for (const path of paths) {
    const value = text(readDotted(attributes, path), max);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(attributes: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = number(readDotted(attributes, path));
    if (value !== undefined) return value;
  }
  return undefined;
}

function vital(attributes: unknown): string | undefined {
  const name = first(attributes, ['ui.vital.name']);
  if (!name) return undefined;
  const value = firstNumber(attributes, ['ui.vital.value']);
  const rating = first(attributes, ['ui.vital.rating']);
  return [name, value === undefined ? undefined : name === 'CLS' ? value.toFixed(3) : `${Math.round(value)} ms`, rating].filter(Boolean).join(' ');
}

export function auditHitToEvent(source: Record<string, unknown>): JourneyEvent | undefined {
  const timestamp = text(source['@timestamp']);
  if (!timestamp) return undefined;
  const a = source.attributes;
  return {
    source: 'audit',
    timestamp,
    userId: first(a, ['user.id', 'actor.id', 'userId', 'actorId']),
    userName: first(a, ['user.name']),
    userEmail: first(a, ['user.email']),
    roles: first(a, ['user.roles', 'actor.role', 'role']),
    tenant: first(a, ['cervejaria.slug', 'cervejariaSlug']),
    sessionId: first(a, ['session.id']),
    action: first(a, ['event.action']),
    description: first(a, ['event.description']),
    route: first(a, ['ui.route']),
    page: first(a, ['ui.page']),
    label: first(a, ['ui.label', 'ui.element']),
    searchTerm: first(a, ['ui.search.term']),
    httpMethod: first(a, ['http.request.method']),
    httpRoute: first(a, ['http.route']),
    status: firstNumber(a, ['http.response.status_code']),
    durationMs: firstNumber(a, ['http.response.duration_ms', 'metadata.durationMs', 'durationMs']),
    error: first(a, ['error.message']),
    vital: vital(a),
    ip: first(a, ['client.address']),
    city: first(a, ['client.geo.city_name']),
    region: first(a, ['client.geo.region_name']),
    country: first(a, ['client.geo.country_iso_code']),
    userAgent: first(a, ['user_agent.name']),
    os: first(a, ['user_agent.os.name']),
    correlationId: first(a, ['correlationId', 'requestId']),
    traceId: text(source.trace_id),
  };
}

export function traceHitToEvent(source: Record<string, unknown>): JourneyEvent | undefined {
  const timestamp = text(source['@timestamp']);
  if (!timestamp) return undefined;
  const a = source.attributes;
  const durationNs = number(source.duration);
  return {
    source: 'trace',
    timestamp,
    action: text(source.name) ? `span ${text(source.name)}` : 'span',
    httpMethod: first(a, ['http.request.method']),
    httpRoute: first(a, ['http.route', 'url.path']),
    status: firstNumber(a, ['http.response.status_code']),
    durationMs: durationNs === undefined ? undefined : Math.round(durationNs / 1_000_000),
    ip: first(a, ['client.address']),
    correlationId: first(a, ['correlationId']),
    traceId: text(source.trace_id),
  };
}

export function hitsOf(response: unknown): { sources: Array<Record<string, unknown>>; total: number } {
  const hits = (response as { hits?: { hits?: unknown; total?: unknown } } | undefined)?.hits;
  const list = Array.isArray(hits?.hits) ? hits.hits : [];
  const sources = list
    .map((hit) => (hit && typeof hit === 'object' ? (hit as { _source?: unknown })._source : undefined))
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === 'object' && !Array.isArray(source));
  const total = typeof hits?.total === 'number' ? hits.total : number((hits?.total as { value?: unknown } | undefined)?.value) ?? sources.length;
  return { sources, total };
}
