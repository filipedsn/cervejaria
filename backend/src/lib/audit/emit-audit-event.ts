import { trace } from '@opentelemetry/api';
import { logger } from '../logger.js';
import {
  auditIndexName,
  getTelemetryContextOrDefault,
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

export function emitAuditEvent(input: AuditEventInput): void {
  const ctx = getTelemetryContextOrDefault();
  const slug = input.slug ?? ctx.slug;
  const env = ctx.env;
  const actor = input.actor ?? ctx.actor;
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  const spanId = span?.spanContext().spanId;

  const payload: Record<string, unknown> = {
    'event.category': 'audit',
    'event.action': input.action,
    'event.outcome': input.outcome ?? 'success',
    message: input.message,
    'cervejaria.id': ctx.cervejariaId,
    'cervejaria.slug': slug,
    'data_stream.dataset': `audit-${slug}`,
    'data_stream.namespace': env,
    'elasticsearch.index': auditIndexName(slug, env),
    ...actorFields(actor),
    trace_id: traceId,
    span_id: spanId,
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
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    payload.metadata = input.metadata;
  }

  logger.info(payload, input.message);
}
