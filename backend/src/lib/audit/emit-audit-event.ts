import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { afterTransactionCommit, currentTransactionTelemetry } from '../transaction-telemetry.js';
import { BRAZIL_TZ, formatBrazilDateTime } from '../event-datetime.js';
import { logger } from '../logger.js';
import { getReleaseContext } from '../release-context.js';
import { emitAuditLogRecord } from './emit-otel-log.js';
import { redactObject } from './redact.js';
import {
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
  http?: { method?: string; route?: string; statusCode?: number; durationMs?: number };
  db?: { operation?: string; model?: string; query?: string; durationMs?: number; transactionId?: string; transactionState?: string };
  ui?: { page?: string; element?: string; label?: string };
  metadata?: Record<string, unknown>;
  slug?: string;
  requestId?: string;
  correlationId?: string;
  interactionId?: string;
  cervejariaId?: string | null;
  targetCervejariaId?: string;
};

function actorFields(actor: TelemetryActor): Record<string, string | undefined> {
  return {
    'actor.type': actor.type,
    'actor.id': actor.id,
    'actor.role': actor.role,
    'actor.cliente_id': actor.clienteId,
  };
}

export function buildAuditPayload(input: AuditEventInput): Record<string, unknown> {
  const ctx = getTelemetryContextOrDefault();
  const slug = input.slug === undefined ? ctx.slug : (input.slug ?? 'unknown');
  const env = ctx.env;
  const actor = input.actor ?? ctx.actor;
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  const spanId = span?.spanContext().spanId;
  const release = getReleaseContext();

  const slugSafe = sanitizeSlugForIndex(slug);
  const payload: Record<string, unknown> = {
    'event.id': randomUUID(),
    '@timestamp': new Date().toISOString(),
    'event.category': 'audit',
    'event.action': input.action,
    'event.outcome': input.outcome ?? 'success',
    'event.timezone': BRAZIL_TZ,
    'event.local_time': formatBrazilDateTime(),
    message: input.message,
    releaseSha: release.releaseSha,
    service: release.service,
    environment: release.environment,
    'cervejaria.id': input.cervejariaId === undefined ? ctx.cervejariaId : input.cervejariaId,
    'cervejaria.slug': slug,
    'data_stream.dataset': `audit_${slugSafe}`,
    'data_stream.namespace': env,
    ...actorFields(actor),
    trace_id: traceId,
    span_id: spanId,
    requestId: input.requestId ?? ctx.requestId,
    correlationId: input.correlationId ?? ctx.correlationId,
    interactionId: input.interactionId ?? ctx.interactionId,
  };

  if (input.entityType) payload['entity.type'] = input.entityType;
  if (input.entityId) payload['entity.id'] = input.entityId;
  if (input.targetCervejariaId) payload['target.cervejaria.id'] = input.targetCervejariaId;
  if (ctx.clientCountryCode) payload['client.geo.country_iso_code'] = ctx.clientCountryCode;
  if (input.http?.method) payload['http.request.method'] = input.http.method;
  if (input.http?.route) payload['http.route'] = input.http.route;
  if (input.http?.statusCode != null) payload['http.response.status_code'] = input.http.statusCode;
  if (input.http?.durationMs != null) payload['http.response.duration_ms'] = input.http.durationMs;
  if (input.db?.operation) payload['db.operation'] = input.db.operation;
  if (input.db?.model) payload['db.model'] = input.db.model;
  if (input.db?.query) payload['db.query'] = input.db.query;
  if (input.db?.durationMs != null) payload['db.duration_ms'] = input.db.durationMs;
  if (input.db?.transactionId) payload['db.transaction.id'] = input.db.transactionId;
  if (input.db?.transactionState) payload['db.transaction.state'] = input.db.transactionState;
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

  // The disposable QA runner assigns this process-local ID. Keep it on audit
  // logs only; never attach it to metric dimensions or trust request headers.
  const qaRunId = process.env.PDV_QA_RUN_ID;
  if (process.env.PDV_ISOLATED_QA === '1' && qaRunId && /^[a-f0-9]{16}$/i.test(qaRunId)) {
    payload['test.synthetic'] = true;
    payload['test.run.id'] = qaRunId.toLowerCase();
  }

  return payload;
}

export function emitAuditEvent(input: AuditEventInput): void {
  const payload = buildAuditPayload(input);
  const transaction = currentTransactionTelemetry();
  const publish = () => {
    if (transaction) {
      payload['db.transaction.id'] = transaction.id;
      payload['db.transaction.state'] = (input.outcome ?? 'success') === 'success' ? 'committed' : transaction.state;
    }
    try { emitAuditLogRecord(payload, input.message, input.outcome ?? 'success'); } catch { /* fail open */ }
    try { logger.info(payload, input.message); } catch { /* fail open */ }
  };
  if ((input.outcome ?? 'success') === 'success') afterTransactionCommit(publish);
  else publish();
}
