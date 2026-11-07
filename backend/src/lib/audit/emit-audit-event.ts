import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { afterTransactionCommit, currentTransactionTelemetry } from '../transaction-telemetry.js';
import { BRAZIL_TZ, formatBrazilDateTime } from '../event-datetime.js';
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
  ui?: { page?: string; element?: string; label?: string; route?: string; searchTerm?: string; viewport?: string };
  vital?: { name: string; value: number; rating?: string };
  error?: { message?: string; stackTrace?: string; type?: string };
  client?: { sessionId?: string; userAgent?: string };
  metadata?: Record<string, unknown>;
  slug?: string;
  requestId?: string;
  correlationId?: string;
  interactionId?: string;
  cervejariaId?: string | null;
  targetCervejariaId?: string;
};

/**
 * OTel ships `metadata` as one JSON keyword (ignore_above 1024), so its inner keys are not
 * searchable. These are also written as dotted attributes (`metadata.kind`, `metadata.context.comandaNumero`…)
 * for Discover and alert rules; the allowlist keeps the mapping bounded.
 */
const SEARCHABLE_METADATA_KEYS = [
  'handled', 'kind', 'feature', 'operation', 'scenario', 'httpStatus', 'apiCode', 'actionOutcome', 'durationMs',
  'tipo', 'comandaId', 'comandaNumero', 'eventoId', 'clienteId', 'produtoId',
] as const;
const MAX_SEARCHABLE_NESTED_KEYS = 30;

type SearchableValue = string | number | boolean;

function searchableValue(value: unknown): SearchableValue | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 500);
  return undefined;
}

export function searchableMetadataFields(metadata: Record<string, unknown>): Record<string, SearchableValue> {
  const out: Record<string, SearchableValue> = {};
  for (const key of SEARCHABLE_METADATA_KEYS) {
    const value = searchableValue(metadata[key]);
    if (value !== undefined) out[`metadata.${key}`] = value;
  }
  for (const group of ['context', 'intent'] as const) {
    const nested = metadata[group];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    let count = 0;
    for (const [key, raw] of Object.entries(nested as Record<string, unknown>)) {
      if (count >= MAX_SEARCHABLE_NESTED_KEYS) break;
      const value = searchableValue(raw);
      if (value === undefined) continue;
      out[`metadata.${group}.${key}`] = value;
      count += 1;
    }
  }
  return out;
}

function actorFields(actor: TelemetryActor): Record<string, string | undefined> {
  return {
    'actor.type': actor.type,
    'actor.id': actor.id,
    'actor.role': actor.role,
    'actor.cliente_id': actor.clienteId,
  };
}

function userFields(actor: TelemetryActor): Record<string, string> {
  const fields: Record<string, string> = {};
  if (actor.id) fields['user.id'] = actor.id;
  if (actor.name) fields['user.name'] = actor.name;
  if (actor.email) fields['user.email'] = actor.email;
  if (actor.role) fields['user.roles'] = actor.role;
  return fields;
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
    ...userFields(actor),
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
  if (ctx.clientIp) payload['client.address'] = ctx.clientIp;
  if (ctx.clientIp && ctx.clientIpSource) payload['client.ip_source'] = ctx.clientIpSource;
  if (input.client?.sessionId) payload['session.id'] = input.client.sessionId;
  if (input.client?.userAgent) payload['user_agent.original'] = input.client.userAgent;
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
  if (input.ui?.route) payload['ui.route'] = input.ui.route;
  if (input.ui?.searchTerm) payload['ui.search.term'] = input.ui.searchTerm;
  if (input.ui?.viewport) payload['ui.viewport'] = input.ui.viewport;
  if (input.vital) {
    payload['ui.vital.name'] = input.vital.name;
    payload['ui.vital.value'] = input.vital.value;
    if (input.vital.rating) payload['ui.vital.rating'] = input.vital.rating;
  }
  if (input.error?.message) payload['error.message'] = input.error.message;
  if (input.error?.stackTrace) payload['error.stack_trace'] = input.error.stackTrace;
  if (input.error?.type) payload['error.type'] = input.error.type;
  const metadata = input.metadata ? (redactObject(input.metadata) as Record<string, unknown>) : undefined;
  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
    Object.assign(payload, searchableMetadataFields(metadata));
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
    // Single sink: the pino instrumentation also forwards logger.* to OTLP, so logging the payload
    // here as well would index every audit event twice.
    try { emitAuditLogRecord(payload, input.message, input.outcome ?? 'success'); } catch { /* fail open */ }
  };
  if ((input.outcome ?? 'success') === 'success') afterTransactionCommit(publish);
  else publish();
}
