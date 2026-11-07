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
  /** Narrativa operacional (empresa/usuario/funcionalidade/motivo). */
  cenario?: string;
  /** Linhas tecnicas para o bloco Detalhamento. */
  technicalDetails?: string[];
};

const DEFAULT_ES_URL = 'http://127.0.0.1:9200';
const WINDOW_BEFORE_MS = 15 * 60_000;
const WINDOW_AFTER_MS = 2 * 60_000;
const JSON_MAX_CHARS = 1500;
const STACK_MAX_CHARS = 1200;

export type ParsedLog = {
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
  clientAddress?: string;
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

/** Aceita objeto ou string JSON (como chega do Elasticsearch OTel). */
export function parseMetadataValue(raw: unknown): Record<string, unknown> | undefined {
  const asObj = asRecord(raw);
  if (asObj) return asObj;
  const str = asString(raw);
  if (!str) return undefined;
  try {
    return asRecord(JSON.parse(str));
  } catch {
    return undefined;
  }
}

export function extractResponseErrorMessage(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined;
  const nested = asRecord(metadata.responseError);
  return asString(nested?.error) ?? asString(metadata.error);
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

function parseBodyMessage(source: Record<string, unknown>): string | undefined {
  const body = source.body;
  const bodyRec = asRecord(body);
  return asString(bodyRec?.text) ?? asString(body);
}

export function parseAuditLogSource(source: Record<string, unknown>): ParsedLog {
  const attrs = asRecord(source.attributes);
  const resourceAttrs = asRecord(asRecord(source.resource)?.attributes);
  const metadata = parseMetadataValue(pick(attrs, 'metadata'));

  return {
    timestamp: normalizeTimestamp(source['@timestamp']),
    message:
      asString(pick(attrs, 'message')) ??
      parseBodyMessage(source) ??
      '',
    eventAction: asString(pick(attrs, 'event.action')),
    eventOutcome: asString(pick(attrs, 'event.outcome')),
    eventCategory: asString(pick(attrs, 'event.category')),
    cervejariaId: asString(pick(attrs, 'cervejaria.id')),
    cervejariaSlug: asString(pick(attrs, 'cervejaria.slug')),
    actorType: asString(pick(attrs, 'actor.type')),
    actorId: asString(pick(attrs, 'actor.id')) ?? asString(pick(attrs, 'actor.cliente_id')),
    actorName: asString(pick(attrs, 'actor.name')),
    actorEmail: asString(pick(attrs, 'actor.email')),
    entityType: asString(pick(attrs, 'entity.type')),
    entityId: asString(pick(attrs, 'entity.id')),
    httpMethod: asString(pick(attrs, 'http.request.method')),
    httpRoute: asString(pick(attrs, 'http.route')),
    httpStatus: asNumber(pick(attrs, 'http.response.status_code')),
    clientAddress: asString(pick(attrs, 'client.address')),
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

function is401SurgeRule(ruleName?: string): boolean {
  return (ruleName ?? '').toLowerCase().includes('401-surge');
}

function matchesRule(log: ParsedLog, ruleName?: string): boolean {
  const key = (ruleName ?? '').toLowerCase();
  const action = log.eventAction?.toLowerCase() ?? '';

  if (is401SurgeRule(ruleName)) {
    return log.httpStatus === 401;
  }
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

export function formatUsuario(log: ParsedLog): string | undefined {
  if (log.actorName && log.actorEmail) return `${log.actorName} (${log.actorEmail})`;
  if (log.actorName) return log.actorName;
  if (log.actorEmail) return log.actorEmail;

  if (log.actorType === 'cliente-pdv') {
    return log.actorId ? `Cliente do PDV (${log.actorId})` : 'Cliente do PDV';
  }

  const publicRoute = log.httpRoute?.includes('/api/public/') ?? false;
  if ((log.actorType === 'anonymous' || !log.actorType) && publicRoute) {
    return 'Cliente do portal PDV (nao identificado)';
  }

  if (log.actorId) {
    const tipo = log.actorType ? `${log.actorType} ` : '';
    return `${tipo}(${log.actorId})`.trim();
  }

  return undefined;
}

function interpret401Reason(apiError?: string): { short: string; causes: string; includesAttackNote: boolean } {
  const err = (apiError ?? '').toLowerCase();
  if (err.includes('sessão expirada') || err.includes('sessao expirada')) {
    return {
      short: 'estava sem sessao valida (cookie ausente ou expirado)',
      causes:
        'Possiveis causas: sessao expirou, cookie limpo, ou aba aberta apos logout.',
      includesAttackNote: false,
    };
  }
  if (err.includes('comanda encerrada')) {
    return {
      short: 'a comanda nao esta mais aberta',
      causes:
        'Possiveis causas: comanda ja foi encerrada/fechada ou o turno/caixa fechou.',
      includesAttackNote: false,
    };
  }
  if (err.includes('sessão inválida') || err.includes('sessao invalida') || err.includes('sessão inválida')) {
    return {
      short: 'a sessao foi rejeitada (token invalido)',
      causes:
        'Possiveis causas: cookie adulterado, chave JWT trocada apos deploy, ou sessao de outro ambiente.',
      includesAttackNote: false,
    };
  }
  if (apiError) {
    return {
      short: `a API recusou com "${apiError}"`,
      causes:
        'Possiveis causas: sessao expirada, comanda encerrada, turno fechado ou tentativa invalida. Nao indica necessariamente ataque.',
      includesAttackNote: true,
    };
  }
  return {
    short: 'o acesso veio sem autorizacao valida',
    causes:
      'Possiveis causas: sessao expirada, comanda encerrada, turno fechado ou tentativa invalida. Nao indica necessariamente ataque.',
    includesAttackNote: true,
  };
}

function dominantValue(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value?.trim()) continue;
    const key = value.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function extractCountFromReason(reason?: string): number | undefined {
  const match = reason?.match(/document count is (\d+)/i);
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

function resolveOperacao(log: ParsedLog): string {
  return resolveOperationLabel(log.eventAction, log.message, log.httpRoute, log.httpMethod);
}

function buildErrorDescription(log: ParsedLog, payload: KibanaAlertPayload): string {
  const apiError = extractResponseErrorMessage(log.metadata);
  if (apiError) return apiError;
  if (log.message.trim()) return log.message.trim();

  const reason = payload.reason?.trim();
  if (reason) return reason;

  return 'Falha registrada sem mensagem detalhada nos logs.';
}

export function build401Cenario(
  logs: ParsedLog[],
  primary: ParsedLog,
  payload: KibanaAlertPayload,
): string {
  const matched = logs.filter((row) => matchesRule(row, payload.ruleName));
  const set = matched.length > 0 ? matched : [primary];
  const reasonCount = extractCountFromReason(payload.reason);
  const count = Math.max(reasonCount ?? 0, set.length);

  const slug =
    dominantValue(set.map((row) => row.cervejariaSlug)) ?? primary.cervejariaSlug;
  const empresa = slugToDisplayName(slug) ?? slug ?? 'empresa nao identificada';
  const dominantError =
    dominantValue(set.map((row) => extractResponseErrorMessage(row.metadata))) ??
    extractResponseErrorMessage(primary.metadata);
  const interp = interpret401Reason(dominantError);
  const usuario = formatUsuario(primary) ?? 'usuario nao identificado';
  const operacao = resolveOperacao(primary).toLowerCase();

  const parts = [
    `Pico de ${count} respostas 401 na janela analisada (~10 min).`,
    `Dominante: ${usuario} tentando ${operacao} em ${empresa}, mas ${interp.short}.`,
  ];
  if (dominantError) {
    parts.push(`Motivo da API: "${dominantError}".`);
  }
  parts.push(interp.causes);
  if (!interp.includesAttackNote) {
    parts.push('Nao indica necessariamente ataque.');
  }
  return parts.join(' ');
}

function buildGenericCenario(log: ParsedLog, payload: KibanaAlertPayload): string {
  const empresa =
    slugToDisplayName(log.cervejariaSlug) ?? log.cervejariaSlug ?? 'empresa nao identificada';
  const usuario = formatUsuario(log) ?? 'usuario nao identificado';
  const operacao = resolveOperacao(log);
  const apiError = extractResponseErrorMessage(log.metadata);
  const detail = apiError ?? log.message.trim() ?? payload.reason?.trim() ?? 'falha sem detalhe';
  return `${usuario} em ${empresa} ao executar "${operacao}": ${detail}.`;
}

function appendMetadataDetails(lines: string[], metadata?: Record<string, unknown>): void {
  if (!metadata) return;

  const apiError = extractResponseErrorMessage(metadata);
  if (apiError) pushLine(lines, 'Erro da API', apiError);

  const error = asString(metadata.error);
  if (error && error !== apiError) pushLine(lines, 'Erro registrado', error);

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

  const known = new Set<string>([
    'error',
    'tipo',
    'stack',
    'payload',
    'responseError',
    ...businessKeys,
  ]);
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

  pushLine(lines, 'IP cliente', log.clientAddress);

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

function buildFailureSearchBody(ruleName: string | undefined, from: string, to: string): unknown {
  if (is401SurgeRule(ruleName)) {
    return {
      size: 30,
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: from, lte: to } } },
            { term: { 'attributes.http.response.status_code': 401 } },
          ],
        },
      },
      sort: [{ '@timestamp': 'desc' }],
    };
  }

  return {
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
  };
}

async function fetchFailureLogs(payload: KibanaAlertPayload): Promise<ParsedLog[]> {
  const center = pickTimestamp(payload);
  const from = new Date(center.getTime() - WINDOW_BEFORE_MS).toISOString();
  const to = new Date(center.getTime() + WINDOW_AFTER_MS).toISOString();
  const index = auditIndexForRule(payload.ruleName);

  const res = await fetch(`${esUrl()}/${encodeURIComponent(index)}/_search`, {
    method: 'POST',
    headers: esAuthHeaders(),
    body: JSON.stringify(buildFailureSearchBody(payload.ruleName, from, to)),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
  };

  return (data.hits?.hits ?? [])
    .map((hit) => parseAuditLogSource(hit._source ?? {}))
    .filter(isFailureLog);
}

/** Monta contexto a partir de logs ja parseados (testavel sem Elasticsearch). */
export function buildEnrichedContextFromLogs(
  payload: KibanaAlertPayload,
  logs: ParsedLog[],
): AlertEnrichedContext | undefined {
  const log = logs.find((row) => matchesRule(row, payload.ruleName)) ?? logs[0];
  if (!log) return fallbackContext(payload);

  const operacao = resolveOperacao(log);
  const empresa = slugToDisplayName(log.cervejariaSlug) ?? log.cervejariaSlug;
  const usuario = formatUsuario(log);
  const cenario = is401SurgeRule(payload.ruleName)
    ? build401Cenario(logs, log, payload)
    : buildGenericCenario(log, payload);

  return {
    empresa,
    usuario,
    operacao,
    errorDescription: buildErrorDescription(log, payload),
    cenario,
    technicalDetails: buildTechnicalDetailsFromLog(log, payload),
  };
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

  return buildEnrichedContextFromLogs(payload, logs);
}

function fallbackContext(payload: KibanaAlertPayload): AlertEnrichedContext | undefined {
  const reason = payload.reason?.trim();
  if (!reason) return undefined;
  return {
    empresa: undefined,
    usuario: undefined,
    operacao: resolveOperationLabel(undefined, reason),
    errorDescription: reason,
    cenario: reason,
    technicalDetails: buildTechnicalDetailsFromPayload(payload),
  };
}

/** Detalhamento tecnico para alertas de infra/SLO (sem contexto de empresa). */
export function buildInfraTechnicalDetails(payload: KibanaAlertPayload): string[] {
  return buildTechnicalDetailsFromPayload(payload);
}
