import type { NormalizedEvent, RawEventDocument } from '../types.js';
import { enumValue, firstNumber, firstString, type SourceRecord } from './shared.js';

export function normalizeAudit(raw: RawEventDocument, source: SourceRecord, timestamp: string): NormalizedEvent {
  const environment = enumValue(firstString(source, 'attributes.environment'), ['dev', 'prd', 'infra'] as const);
  const actorType = enumValue(firstString(source, 'attributes.actor.type'), ['usuario', 'cliente', 'system', 'anonymous'] as const);
  const outcome = enumValue(firstString(source, 'attributes.event.outcome'), ['success', 'failure'] as const);
  const method = firstString(source, 'attributes.http.request.method');
  const route = firstString(source, 'attributes.http.route');
  const statusCode = firstNumber(source, 'attributes.http.response.status_code');
  const http = method || route || statusCode !== undefined ? { method, route, statusCode } : undefined;
  return {
    schemaVersion: 1,
    eventId: '',
    timestamp,
    source: 'audit',
    dataset: firstString(source, 'data_stream.dataset'),
    environment,
    service: firstString(source, 'attributes.service', 'resource.attributes.service.name'),
    releaseSha: firstString(source, 'attributes.releaseSha'),
    correlationId: firstString(source, 'attributes.correlationId'),
    requestId: firstString(source, 'attributes.requestId'),
    traceId: firstString(source, 'trace_id'),
    spanId: firstString(source, 'span_id'),
    tenantId: firstString(source, 'attributes.cervejaria.id', 'attributes.cervejariaId'),
    tenantSlug: firstString(source, 'attributes.cervejaria.slug', 'attributes.cervejariaSlug'),
    actorId: firstString(source, 'attributes.actor.id'),
    actorType,
    role: firstString(source, 'attributes.role'),
    action: firstString(source, 'attributes.event.action'),
    reasonCode: firstString(source, 'attributes.metadata.reasonCode'),
    outcome,
    http,
    rawRef: { index: raw.index, id: raw.id }
  };
}
