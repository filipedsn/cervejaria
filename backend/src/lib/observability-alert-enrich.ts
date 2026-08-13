import type { KibanaAlertPayload } from './kibana-alert-email.js';
import { redactObject } from './audit/redact.js';
import { resolveOperationLabel, slugToDisplayName } from './operation-labels.js';
import { isOperationalAlertRule } from './observability-alert-copy.js';

export type AlertEnrichedContext = {
  empresa?: string;
  usuario?: string;
  operacao?: string;
  /** Resumo legivel do erro (uma linha). */
  errorDescription?: string;
  /** Linhas tecnicas para o bloco Detalhamento. */
  technicalDetails?: string[];
};

const DEFAULT_ES_URL = 'http://127.0.0.1:9200';
const WINDOW_BEFORE_MS = 15 * 60_000;
const WINDOW_AFTER_MS = 2 * 60_000;
const JSON_MAX_CHARS = 1500;
const STACK_MAX_CHARS = 1200;

type ParsedLog = {
  timestamp?: string;
  message: string;
  eventAction?: string;
  eventOutcome?: string;
  eventCategory?: string;
  cervejariaId?: string;
  cervejariaSlug?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  entityType?: string;
  entityId?: string;
  httpMethod?: string;
  httpRoute?: string;
  httpStatus?: number;
  dbOperation?: string;
  dbModel?: string;
  dbQuery?: string;
  dbDurationMs?: number;
  uiPage?: string;
  uiElement?: string;
  uiLabel?: string;
  traceId?: string;
  spanId?: string;
  serviceName?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
  transacaoPayload?: unknown;
};

function esUrl(): string {
  return (process.env.KIBANA_ALERT_ES_URL ?? DEFAULT_ES_URL).replace(/\/$/, '');
}

function esAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey =
    process.env.KIBANA_ALERT_ES_API_KEY?.trim() ||
    process.env.ELASTIC_API_KEY_ALERT_POLLER?.trim();
  if (apiKey) {
    headers.Authorization = `ApiKey ${apiKey}`;
    return headers;
  }
  const user = process.env.KIBANA_ALERT_ES_USER?.trim() || 'elastic';
  const pass =
    process.env.KIBANA_ALERT_ES_PASSWORD?.trim() || process.env.ELASTIC_PASSWORD?.trim();
  if (pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return headers;
}

function auditIndexForRule(ruleName?: string): string {
  const key = (ruleName ?? '').toLowerCase();
  if (key.includes('-dev')) return 'logs-audit*.otel-dev';
  return 'logs-audit*.otel-prd';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pick(attrs: Record<string, unknown> | undefined, dotted: string): unknown {
  if (!attrs) return undefined;
  if (dotted in attrs) return attrs[dotted];
  let cursor: unknown = attrs;
  for (const part of dotted.split('.')) {
    const rec = asRecord(cursor);
    if (!rec) return undefined;
    cursor = rec[part];
  }
  return cursor;
}

function normalizeTimestamp(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const millis = Number.parseFloat(raw);
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function formatTimestampBr(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function pushLine(lines: string[], label: string, value?: string | number): void {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  lines.push(`${label}: ${text}`);
}

function formatJsonValue(value: unknown, max = JSON_MAX_CHARS): string {
  try {
    const redacted = redactObject(value);
    return truncate(JSON.stringify(redacted), max);
  } catch {
    return truncate(String(value), max);
  }
}

function parseLog(source: Record<string, unknown>): ParsedLog {
  const attrs = asRecord(source.attributes);
  const resourceAttrs = asRecord(asRecord(source.resource)?.attributes);
  const metadata = asRecord(pick(attrs, 'metadata'));

  return {
    timestamp: normalizeTimestamp(source['@timestamp']),
    message:
      asString(pick(attrs, 'message')) ??
      asString(source.body) ??
      '',
    eventAction: asString(pick(attrs, 'event.action')),
    eventOutcome: asString(pick(attrs, 'event.outcome')),
    eventCategory: asString(pick(attrs, 'event.category')),
    cervejariaId: asString(pick(attrs, 'cervejaria.id')),
    cervejariaSlug: asString(pick(attrs, 'cervejaria.slug')),
    actorType: asString(pick(attrs, 'actor.type')),
    actorId: asString(pick(attrs, 'actor.id')),
    actorName: asString(pick(attrs, 'actor.name')),
    actorEmail: asString(pick(attrs, 'actor.email')),
    entityType: asString(pick(attrs, 'entity.type')),
    entityId: asString(pick(attrs, 'entity.id')),
    httpMethod: asString(pick(attrs, 'http.request.method')),
    httpRoute: asString(pick(attrs, 'http.route')),
    httpStatus: asNumber(pick(attrs, 'http.response.status_code')),
    dbOperation: asString(pick(attrs, 'db.operation')),
    dbModel: asString(pick(attrs, 'db.model')),
    dbQuery: asString(pick(attrs, 'db.query')),
    dbDurationMs: asNumber(pick(attrs, 'db.duration_ms')),
    uiPage: asString(pick(attrs, 'ui.page')),
    uiElement: asString(pick(attrs, 'ui.element')),
    uiLabel: asString(pick(attrs, 'ui.label')),
    traceId: asString(source.trace_id) ?? asString(pick(attrs, 'trace_id')),
    spanId: asString(source.span_id) ?? asString(pick(attrs, 'span_id')),
    serviceName: asString(pick(resourceAttrs, 'service.name')),
    stack:
      asString(pick(attrs, 'metadata.stack')) ??
      asString(metadata?.stack) ??
      asString(pick(attrs, 'error.stack_trace')) ??
      asString(pick(attrs, 'exception.stacktrace')) ??
      asString(pick(attrs, 'stack')),
    metadata,
    transacaoPayload: pick(attrs, 'transacao.payload'),
  };
}

function isFailureLog(log: ParsedLog): boolean {
  if (log.eventOutcome === 'failure') return true;
  if (log.httpStatus != null && log.httpStatus >= 400) return true;
  return false;
}

function matchesRule(log: ParsedLog, ruleName?: string): boolean {
  const key = (ruleName ?? '').toLowerCase();
  const action = log.eventAction?.toLowerCase() ?? '';

  if (key.includes('transacao-failure')) {
    return action.startsWith('transacao.');
  }
  if (key.includes('ui-error')) {
    return action === 'ui.error';
  }
  if (key.includes('5xx')) {
    return log.httpStatus != null && log.httpStatus >= 500;
  }
  return isFailureLog(log);
}

function pickTimestamp(payload: KibanaAlertPayload): Date {
  const raw = payload.raw;
  if (raw && typeof raw === 'object') {
    const ts = (raw as Record<string, unknown>)['@timestamp'];
    if (typeof ts === 'string') {
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

function formatUsuario(log: ParsedLog): string | undefined {
  if (log.actorName && log.actorEmail) return `${log.actorName} (${log.actorEmail})`;
  return log.actorName ?? log.actorEmail;
}

function buildErrorDescription(log: ParsedLog, payload: KibanaAlertPayload): string {
  if (log.message.trim()) return log.message.trim();

  const reason = payload.reason?.trim();
  if (reason) return reason;

  return 'Falha registrada sem mensagem detalhada nos logs.';
}

function appendMetadataDetails(lines: string[], metadata?: Record<string, unknown>): void {
  if (!metadata) return;

  const error = asString(metadata.error);
  if (error) pushLine(lines, 'Erro registrado', error);

  const tipo = asString(metadata.tipo);
  if (tipo) pushLine(lines, 'Tipo transacao', tipo);

  const businessKeys = [
    'comandaId',
    'comandaNumero',
    'eventoId',
    'eventoNome',
    'clienteId',
    'clienteNome',
    'produtoId',
    'produtoNome',
    'valor',
    'formaPagamento',
    'source',
    'line',
    'filename',
  ] as const;

  for (const key of businessKeys) {
    const value = metadata[key];
    if (value == null || value === '') continue;
    pushLine(lines, key, typeof value === 'object' ? formatJsonValue(value, 300) : String(value));
  }

  const known = new Set<string>(['error', 'tipo', 'stack', 'payload', ...businessKeys]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!known.has(key) && value != null && value !== '') {
      extra[key] = value;
    }
  }
  if (Object.keys(extra).length > 0) {
    pushLine(lines, 'Metadata', formatJsonValue(extra));
  }
}

export function buildTechnicalDetailsFromLog(
  log: ParsedLog,
  payload: KibanaAlertPayload,
): string[] {
  const lines: string[] = [];

  pushLine(lines, 'Acao tecnica', log.eventAction);
  pushLine(lines, 'Resultado', log.eventOutcome);
  pushLine(lines, 'Categoria', log.eventCategory);

  if (log.cervejariaSlug || log.cervejariaId) {
    pushLine(
      lines,
      'Cervejaria',
      [log.cervejariaId, log.cervejariaSlug].filter(Boolean).join(' / '),
    );
  }

  if (log.actorType || log.actorId) {
    pushLine(
      lines,
      'Ator',
      [log.actorType, log.actorId, log.actorEmail].filter(Boolean).join(' / '),
    );
  }

  if (log.entityType || log.entityId) {
    pushLine(lines, 'Entidade', `${log.entityType ?? '?'} / ${log.entityId ?? '?'}`);
  }

  if (log.httpMethod || log.httpRoute || log.httpStatus != null) {
    const httpParts = [
      log.httpMethod,
      log.httpRoute,
      log.httpStatus != null ? `status ${log.httpStatus}` : undefined,
    ].filter(Boolean);
    pushLine(lines, 'HTTP', httpParts.join(' '));
  }

  if (log.dbOperation || log.dbModel) {
    const dbParts = [log.dbOperation, log.dbModel, log.dbDurationMs != null ? `${log.dbDurationMs}ms` : undefined]
      .filter(Boolean)
      .join(' ');
    pushLine(lines, 'Banco', dbParts);
    if (log.dbQuery) pushLine(lines, 'Query', truncate(log.dbQuery, 500));
  }

  if (log.uiPage || log.uiElement || log.uiLabel) {
    pushLine(
      lines,
      'UI',
      [log.uiPage, log.uiElement, log.uiLabel].filter(Boolean).join(' / '),
    );
  }

  appendMetadataDetails(lines, log.metadata);

  if (log.transacaoPayload != null) {
    pushLine(lines, 'Payload transacao', formatJsonValue(log.transacaoPayload));
  }

  pushLine(lines, 'Trace ID', log.traceId);
  pushLine(lines, 'Span ID', log.spanId);
  pushLine(lines, 'Servico', log.serviceName);

  const logTimeBr = formatTimestampBr(log.timestamp);
  if (logTimeBr) pushLine(lines, 'Horario do log', `${logTimeBr} (Brasilia)`);

  if (log.stack) {
    lines.push(`Stack trace:\n${truncate(log.stack, STACK_MAX_CHARS)}`);
  }

  const alertReason = payload.reason?.trim();
  if (alertReason && alertReason !== log.message.trim()) {
    pushLine(lines, 'Motivo do alerta', alertReason);
  }

  pushLine(lines, 'Regra', payload.ruleName);

  return lines;
}

function buildTechnicalDetailsFromPayload(payload: KibanaAlertPayload): string[] {
  const lines: string[] = [];
  const reason = payload.reason?.trim();
  if (reason) pushLine(lines, 'Motivo do alerta', reason);
  pushLine(lines, 'Regra', payload.ruleName);
  pushLine(lines, 'Estado', payload.alertState);

  const raw = payload.raw;
  if (raw && typeof raw === 'object') {
    const ts = formatTimestampBr(normalizeTimestamp((raw as Record<string, unknown>)['@timestamp']));
    if (ts) pushLine(lines, 'Horario do alerta', `${ts} (Brasilia)`);
  }

  return lines;
}

async function fetchFailureLogs(payload: KibanaAlertPayload): Promise<ParsedLog[]> {
  const center = pickTimestamp(payload);
  const from = new Date(center.getTime() - WINDOW_BEFORE_MS).toISOString();
  const to = new Date(center.getTime() + WINDOW_AFTER_MS).toISOString();
  const index = auditIndexForRule(payload.ruleName);

  const res = await fetch(`${esUrl()}/${encodeURIComponent(index)}/_search`, {
    method: 'POST',
    headers: esAuthHeaders(),
    body: JSON.stringify({
      size: 30,
      query: {
        bool: {
          must: [{ range: { '@timestamp': { gte: from, lte: to } } }],
          should: [
            { term: { 'attributes.event.outcome': 'failure' } },
            { range: { 'attributes.http.response.status_code': { gte: 500 } } },
          ],
          minimum_should_match: 1,
        },
      },
      sort: [{ '@timestamp': 'desc' }],
    }),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
  };

  return (data.hits?.hits ?? [])
    .map((hit) => parseLog(hit._source ?? {}))
    .filter(isFailureLog);
}

export async function enrichAlertContext(
  payload: KibanaAlertPayload,
): Promise<AlertEnrichedContext | undefined> {
  if (!isOperationalAlertRule(payload.ruleName)) return undefined;

  let logs: ParsedLog[] = [];
  try {
    logs = await fetchFailureLogs(payload);
  } catch {
    return fallbackContext(payload);
  }

  const log = logs.find((row) => matchesRule(row, payload.ruleName)) ?? logs[0];
  if (!log) return fallbackContext(payload);

  const operacao = resolveOperationLabel(log.eventAction, log.message);
  const empresa = slugToDisplayName(log.cervejariaSlug) ?? log.cervejariaSlug;
  const usuario = formatUsuario(log);

  return {
    empresa,
    usuario,
    operacao,
    errorDescription: buildErrorDescription(log, payload),
    technicalDetails: buildTechnicalDetailsFromLog(log, payload),
  };
}

function fallbackContext(payload: KibanaAlertPayload): AlertEnrichedContext | undefined {
  const reason = payload.reason?.trim();
  if (!reason) return undefined;
  return {
    empresa: undefined,
    usuario: undefined,
    operacao: resolveOperationLabel(undefined, reason),
    errorDescription: reason,
    technicalDetails: buildTechnicalDetailsFromPayload(payload),
  };
}

/** Detalhamento tecnico para alertas de infra/SLO (sem contexto de empresa). */
export function buildInfraTechnicalDetails(payload: KibanaAlertPayload): string[] {
  return buildTechnicalDetailsFromPayload(payload);
}
