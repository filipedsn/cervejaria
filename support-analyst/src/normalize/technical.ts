import type { NormalizedEvent, RawEventDocument } from '../types.js';
import { enumValue, firstNumber, firstString, type SourceRecord } from './shared.js';

const dbCategories = ['CONNECTION', 'TIMEOUT', 'DEADLOCK', 'LOCK_TIMEOUT', 'CONSTRAINT', 'NOT_FOUND', 'TRANSACTION'] as const;

export function normalizeTechnical(raw: RawEventDocument, source: SourceRecord, timestamp: string): NormalizedEvent {
  const eventType = firstString(source, 'attributes.event');
  const isDb = eventType?.startsWith('db.') === true;
  const category = firstString(source, 'attributes.category');
  const db = isDb ? {
    category: category ? enumValue(category, dbCategories) ?? 'UNKNOWN' as const : undefined,
    durationMs: firstNumber(source, 'attributes.durationMs'),
    operation: firstString(source, 'attributes.db.operation'),
    model: firstString(source, 'attributes.db.model')
  } : undefined;
  const method = firstString(source, 'attributes.http.request.method');
  const route = firstString(source, 'attributes.http.route');
  const statusCode = firstNumber(source, 'attributes.http.response.status_code');
  const durationMs = firstNumber(source, 'attributes.durationMs');
  const http = method || route || statusCode !== undefined ? { method, route, statusCode, durationMs } : undefined;
  const realtimeAction = firstString(source, 'attributes.realtime.action');
  const realtimeReason = firstString(source, 'attributes.metadata.reasonCode');
  return {
    schemaVersion: 1,
    eventId: '',
    timestamp,
    source: 'technical',
    dataset: firstString(source, 'data_stream.dataset'),
    environment: enumValue(firstString(source, 'attributes.environment'), ['dev', 'prd', 'infra'] as const),
    service: firstString(source, 'attributes.service', 'resource.attributes.service.name'),
    releaseSha: firstString(source, 'attributes.releaseSha'),
    correlationId: firstString(source, 'attributes.correlationId'),
    requestId: firstString(source, 'attributes.requestId'),
    traceId: firstString(source, 'trace_id'),
    spanId: firstString(source, 'span_id'),
    eventType,
    http,
    db,
    realtime: realtimeAction || realtimeReason ? { action: realtimeAction, reasonCode: realtimeReason } : undefined,
    rawRef: { index: raw.index, id: raw.id }
  };
}
