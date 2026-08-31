import type { IncidentClass, IncidentReason, NormalizedEvent } from '../types.js';

export type Classification = { class: IncidentClass; ruleId: string; reasons: IncidentReason[] };

const dbFailureCategories = new Set(['CONNECTION', 'TIMEOUT', 'DEADLOCK', 'LOCK_TIMEOUT', 'TRANSACTION', 'CONSTRAINT']);
const includesAny = (value: string | undefined, expressions: readonly string[]) => Boolean(value && expressions.some((expression) => value.toLowerCase().includes(expression)));

/** Ordered, pure rules. Free text is never used as incident evidence. */
export function classifyEvent(event: NormalizedEvent): Classification {
  const eventType = event.eventType?.toLowerCase();
  const action = event.action?.toLowerCase();
  const realtime = event.realtime?.action?.toLowerCase();
  const availability = includesAny(eventType, ['health.failed', 'availability', 'service.unavailable']) ||
    (event.source === 'alert' && event.outcome === 'failure' && includesAny(event.alert?.ruleName, ['health', 'availability', 'unavailable']));
  if (availability) return decision('AVAILABILITY', 'CLASS_AVAILABILITY_SIGNAL');
  if (eventType === 'db.operation.slow' || (event.db?.durationMs ?? 0) >= 1_000) return decision('DATABASE_SLOW', 'CLASS_DATABASE_SLOW');
  if (event.db?.category && dbFailureCategories.has(event.db.category)) return decision('DATABASE_FAILURE', 'CLASS_DATABASE_FAILURE', event.db.category);
  if (includesAny(realtime, ['auth', 'denied', 'rejected']) || (event.realtime && includesAny(event.realtime.reasonCode, ['AUTH', 'DENIED']))) return decision('REALTIME_AUTH_FAILURE', 'CLASS_REALTIME_AUTH_FAILURE');
  if (includesAny(action, ['authorization', 'permission', 'access.denied']) || event.http?.statusCode === 403) return decision('AUTHORIZATION_DENIED', 'CLASS_AUTHORIZATION_DENIED');
  if (includesAny(action, ['auth.', 'login', 'session']) && event.outcome === 'failure' || event.http?.statusCode === 401) return decision('AUTH_FAILURE', 'CLASS_AUTH_FAILURE');
  if ((event.http?.statusCode ?? 0) >= 500 || includesAny(eventType, ['exception', '.failed', '.error'])) return decision('APPLICATION_ERROR', 'CLASS_APPLICATION_ERROR');
  if (includesAny(eventType, ['frontend', 'ui.', 'browser'])) return decision('FRONTEND_ERROR', 'CLASS_FRONTEND_ERROR');
  if ((event.http?.durationMs ?? 0) >= 1_000) return decision('PERFORMANCE', 'CLASS_PERFORMANCE');
  if (includesAny(eventType, ['business', 'domain.']) || (event.outcome === 'failure' && Boolean(action))) return decision('BUSINESS_FAILURE', 'CLASS_BUSINESS_FAILURE');
  if (event.source === 'alert' && includesAny(event.alert?.ruleName, ['telemetry', 'ingest', 'observability']) || includesAny(eventType, ['telemetry', 'ingest'])) return decision('TELEMETRY_FAILURE', 'CLASS_TELEMETRY_FAILURE');
  return decision('UNKNOWN', 'CLASS_UNKNOWN');
}

function decision(incidentClass: IncidentClass, ruleId: string, detail?: string): Classification {
  return { class: incidentClass, ruleId, reasons: [{ code: ruleId, ...(detail ? { detail } : {}) }] };
}
