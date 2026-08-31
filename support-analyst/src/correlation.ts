import type { NormalizedEvent } from './types.js';

export type CorrelationLevel = 'DETERMINISTIC' | 'STRONG' | 'PROBABLE' | 'WEAK';
export type CorrelationReasonCode = 'SAME_CORRELATION_ID' | 'SAME_REQUEST_ID' | 'SAME_TRACE_ID' | 'SAME_RELEASE' | 'SAME_SERVICE' | 'SAME_TENANT' | 'SAME_ROUTE' | 'SAME_ACTION' | 'SAME_DB_CATEGORY' | 'WITHIN_TIME_WINDOW';
export type CorrelationReason = { code: CorrelationReasonCode; windowMinutes?: number };
export type CorrelationRelation = { anchorEventId: string; relatedEventId: string; level: CorrelationLevel; reasons: CorrelationReason[] };
export type CorrelationConflict = { anchorEventId: string; relatedEventId: string; conflictingKeys: Array<'correlationId' | 'requestId' | 'traceId'> };
/** Supplied by the orchestration layer when an approved source failed. */
export type CorrelationSourceFailure = { source: 'alert' | 'audit' | 'technical'; kind: 'unauthorized' | 'forbidden' | 'rate_limited' | 'timeout' | 'malformed_response' | 'request_failed' };
export type CorrelationResult = { relations: CorrelationRelation[]; conflicts: CorrelationConflict[]; sourceFailures: CorrelationSourceFailure[] };

const STRONG_WINDOW_MINUTES = 5;
const PROBABLE_WINDOW_MINUTES = 15;

/** Pure and replay-safe: it never reads clocks, storage, or Elasticsearch. */
export class CorrelationEngine {
  correlate(anchor: NormalizedEvent, candidates: readonly NormalizedEvent[], sourceFailures: readonly CorrelationSourceFailure[] = []): CorrelationResult {
    const unique = new Map<string, NormalizedEvent>();
    for (const candidate of candidates) if (candidate.eventId !== anchor.eventId && !unique.has(candidate.eventId)) unique.set(candidate.eventId, candidate);
    const relations: CorrelationRelation[] = [];
    const conflicts: CorrelationConflict[] = [];
    for (const candidate of [...unique.values()].sort((a, b) => a.eventId.localeCompare(b.eventId))) {
      const deterministic = deterministicReason(anchor, candidate);
      if (deterministic) {
        relations.push({ anchorEventId: anchor.eventId, relatedEventId: candidate.eventId, level: 'DETERMINISTIC', reasons: [{ code: deterministic }] });
        continue;
      }
      const conflictingKeys = conflictsBetween(anchor, candidate);
      if (conflictingKeys.length) {
        conflicts.push({ anchorEventId: anchor.eventId, relatedEventId: candidate.eventId, conflictingKeys });
        continue;
      }
      const minutes = differenceInMinutes(anchor.timestamp, candidate.timestamp);
      const context = matchingContext(anchor, candidate);
      if (minutes <= STRONG_WINDOW_MINUTES && context.service && context.release && context.tenant && (context.route || context.action)) {
        relations.push(relation(anchor, candidate, 'STRONG', context, minutes));
      } else if (minutes <= PROBABLE_WINDOW_MINUTES && context.service && context.release && (context.route || context.action || context.db)) {
        relations.push(relation(anchor, candidate, 'PROBABLE', context, minutes));
      } else if (minutes <= STRONG_WINDOW_MINUTES) {
        relations.push({ anchorEventId: anchor.eventId, relatedEventId: candidate.eventId, level: 'WEAK', reasons: [{ code: 'WITHIN_TIME_WINDOW', windowMinutes: minutes }] });
      }
    }
    return { relations, conflicts, sourceFailures: [...sourceFailures].sort((a, b) => `${a.source}:${a.kind}`.localeCompare(`${b.source}:${b.kind}`)) };
  }
}

export function differenceInMinutes(first: string, second: string): number {
  const a = Date.parse(first); const b = Date.parse(second);
  return Number.isNaN(a) || Number.isNaN(b) ? Number.POSITIVE_INFINITY : Math.abs(a - b) / 60_000;
}

function deterministicReason(a: NormalizedEvent, b: NormalizedEvent): CorrelationReasonCode | undefined {
  if (a.correlationId && a.correlationId === b.correlationId) return 'SAME_CORRELATION_ID';
  if (a.requestId && a.requestId === b.requestId) return 'SAME_REQUEST_ID';
  if (a.traceId && a.traceId === b.traceId) return 'SAME_TRACE_ID';
  return undefined;
}
function conflictsBetween(a: NormalizedEvent, b: NormalizedEvent): Array<'correlationId' | 'requestId' | 'traceId'> {
  return (['correlationId', 'requestId', 'traceId'] as const).filter((key) => a[key] && b[key] && a[key] !== b[key]);
}
function matchingContext(a: NormalizedEvent, b: NormalizedEvent) {
  return {
    service: same(a.service, b.service), release: same(a.releaseSha, b.releaseSha), tenant: same(a.tenantId, b.tenantId),
    route: same(a.http?.route, b.http?.route), action: same(a.action, b.action), db: same(a.db?.category, b.db?.category),
  };
}
function same(a: string | undefined, b: string | undefined): boolean { return Boolean(a && b && a === b); }
function relation(anchor: NormalizedEvent, candidate: NormalizedEvent, level: Exclude<CorrelationLevel, 'DETERMINISTIC' | 'WEAK'>, context: ReturnType<typeof matchingContext>, minutes: number): CorrelationRelation {
  const reasons: CorrelationReason[] = [];
  if (context.service) reasons.push({ code: 'SAME_SERVICE' }); if (context.release) reasons.push({ code: 'SAME_RELEASE' }); if (context.tenant) reasons.push({ code: 'SAME_TENANT' }); if (context.route) reasons.push({ code: 'SAME_ROUTE' }); if (context.action) reasons.push({ code: 'SAME_ACTION' }); if (context.db) reasons.push({ code: 'SAME_DB_CATEGORY' });
  reasons.push({ code: 'WITHIN_TIME_WINDOW', windowMinutes: minutes });
  return { anchorEventId: anchor.eventId, relatedEventId: candidate.eventId, level, reasons };
}
