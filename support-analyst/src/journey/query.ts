import type { JourneyCriteria } from './types.js';

const USER_ID_FIELDS = ['attributes.user.id', 'attributes.actor.id', 'attributes.userId', 'attributes.actorId'];

function escapeWildcard(value: string): string {
  return value.replace(/[\\*?]/g, (char) => `\\${char}`);
}

function rangeFilter(criteria: Pick<JourneyCriteria, 'from' | 'to'>): unknown {
  return { range: { '@timestamp': { gte: criteria.from.toISOString(), lte: criteria.to.toISOString() } } };
}

/** Matches the criterion on the WI-E fields and on the older field names still present in old events. */
export function criterionClauses(criteria: Pick<JourneyCriteria, 'mode' | 'value'>): unknown[] {
  const value = criteria.value;
  if (criteria.mode === 'sessao') return [{ term: { 'attributes.session.id': value } }];
  if (criteria.mode === 'correlacao') return [{ term: { 'attributes.correlationId': value } }, { term: { 'attributes.requestId': value } }];
  return [
    ...USER_ID_FIELDS.map((field) => ({ term: { [field]: value } })),
    { term: { 'attributes.user.email': { value, case_insensitive: true } } },
    { wildcard: { 'attributes.user.name': { value: `*${escapeWildcard(value)}*`, case_insensitive: true } } },
  ];
}

/** Bounded, read-only audit search ordered by @timestamp. */
export function buildAuditQuery(criteria: JourneyCriteria): Record<string, unknown> {
  return {
    size: criteria.limit,
    timeout: '10s',
    track_total_hits: true,
    sort: [{ '@timestamp': 'asc' }],
    _source: ['@timestamp', 'trace_id', 'attributes'],
    query: { bool: { filter: [rangeFilter(criteria), { bool: { should: criterionClauses(criteria), minimum_should_match: 1 } }] } },
  };
}

/** Spans of the same request: by correlationId and by the trace ids seen in the audit events. */
export function buildTracesQuery(criteria: JourneyCriteria, traceIds: string[]): Record<string, unknown> | undefined {
  const ids = [...new Set(traceIds.filter((id) => /^[A-Za-z0-9]{8,64}$/.test(id)))].slice(0, 20);
  const should: unknown[] = [];
  if (criteria.mode === 'correlacao') should.push({ term: { 'attributes.correlationId': criteria.value } });
  if (ids.length) should.push({ terms: { trace_id: ids } });
  if (!should.length) return undefined;
  return {
    size: 200,
    timeout: '10s',
    track_total_hits: true,
    sort: [{ '@timestamp': 'asc' }],
    _source: ['@timestamp', 'trace_id', 'name', 'kind', 'duration', 'attributes'],
    query: { bool: { filter: [rangeFilter(criteria), { bool: { should, minimum_should_match: 1 } }] } },
  };
}
