import { trace } from '@opentelemetry/api';
import { BRAZIL_TZ, formatBrazilDateTime } from '../event-datetime.js';
import { logger } from '../logger.js';
import { emitAuditLogRecord } from './emit-otel-log.js';
import { redactObject } from './redact.js';
import {
  auditIndexName,
  getTelemetryContextOrDefault,
  sanitizeSlugForIndex,
  type TelemetryActor,
} from '../telemetry-context.js';

export type AuditEventInput = {
  action: string;
  message: string;
  outcome?: 'success' | 'failure';
  entityType?: string;
  entityId?: string;
  actor?: TelemetryActor;
  http?: { method?: string; route?: string; statusCode?: number };
  db?: { operation?: string; model?: string; query?: string; durationMs?: number };
  ui?: { page?: string; element?: string; label?: string };
  metadata?: Record<string, unknown>;
  slug?: string;
  requestId?: string;
  correlationId?: string;
};

function actorFields(actor: TelemetryActor): Record<string, string | undefined> {
  return {
    'actor.type': actor.type,
    'actor.id': actor.id,
    'actor.name': actor.name,
    'actor.email': actor.email,
    'actor.cliente_id': actor.clienteId,
  };
}

export function buildAuditPayload(input: AuditEventInput): Record<string, unknown> {
  const ctx = getTelemetryContextOrDefault();
  const slug = input.slug ?? ctx.slug;
  const env = ctx.env;
  const actor = input.actor ?? ctx.actor;
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  const spanId = span?.spanContext().spanId;

  const slugSafe = sanitizeSlugForIndex(slug);
  const payload: Record<string, unknown> = {
    'event.category': 'audit',
    'event.action': input.action,
    'event.outcome': input.outcome ?? 'success',
    'event.timezone': BRAZIL_TZ,
    'event.local_time': formatBrazilDateTime(),
    message: input.message,
    'cervejaria.id': ctx.cervejariaId,
    'cervejaria.slug': slug,
    'data_stream.dataset': `audit_${slugSafe}`,
    'data_stream.namespace': env,
    'elasticsearch.index': auditIndexName(slug, env),
    ...actorFields(actor),
    trace_id: traceId,
    span_id: spanId,
    requestId: input.requestId ?? ctx.requestId,
    correlationId: input.correlationId ?? ctx.correlationId,
  };

  if (input.entityType) payload['entity.type'] = input.entityType;
  if (input.entityId) payload['entity.id'] = input.entityId;
  if (input.http?.method) payload['http.request.method'] = input.http.method;
  if (input.http?.route) payload['http.route'] = input.http.route;
  if (input.http?.statusCode != null) payload['http.response.status_code'] = input.http.statusCode;
  if (input.db?.operation) payload['db.operation'] = input.db.operation;
  if (input.db?.model) payload['db.model'] = input.db.model;
  if (input.db?.query) payload['db.query'] = input.db.query;
  if (input.db?.durationMs != null) payload['db.duration_ms'] = input.db.durationMs;
  if (input.ui?.page) payload['ui.page'] = input.ui.page;
  if (input.ui?.element) payload['ui.element'] = input.ui.element;
  if (input.ui?.label) payload['ui.label'] = input.ui.label;
  const metadata = input.metadata ? (redactObject(input.metadata) as Record<string, unknown>) : undefined;
  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
    if (metadata.payload != null) {
      payload['transacao.payload'] = metadata.payload;
    }
  }

  return payload;
}

export function emitAuditEvent(input: AuditEventInput): void {
  const payload = buildAuditPayload(input);
  emitAuditLogRecord(payload, input.message, input.outcome ?? 'success');
  logger.info(payload, input.message);
}
