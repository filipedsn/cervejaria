import { config } from './config.js';
import { esSearch } from './es.js';
import type { Alert, Evidence, LogEvent } from './types.js';

/**
 * Fase 2 — enriquecimento.
 *
 * O documento de alerta traz apenas ruleName / alertState / reason / viewInAppUrl.
 * Sozinho ele nao sustenta uma correcao. Aqui buscamos os logs da janela do alerta
 * e extraimos rota, tenant, trace_id, stack e frequencia.
 *
 * Decisao de projeto: os campos sao lidos do `_source` em JavaScript, nao via
 * agregacao do Elasticsearch. O mapping `otel` do exporter decide sozinho se
 * `attributes.event.action` e keyword, text ou objeto, e isso muda entre versoes.
 * Filtrar em JS custa alguns hits a mais e nunca retorna vazio por causa de mapping.
 */

const WINDOW_BEFORE_MS = 10 * 60_000;
const WINDOW_AFTER_MS = 2 * 60_000;
const MAX_HITS = 500;
const HISTORY_DAYS = 7;

type RawLog = Record<string, unknown>;

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

/**
 * Le uma chave que pode estar achatada (`{"event.action": x}`) ou aninhada
 * (`{event: {action: x}}`) — o exporter usa as duas formas conforme a versao.
 */
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

/** `@timestamp` chega como ISO ou como epoch millis em string ("1786491307718.0"). */
function normalizeTimestamp(value: unknown): string {
  const raw = asString(value);
  if (!raw) return new Date().toISOString();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const millis = Number.parseFloat(raw);
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function parseLogEvent(source: RawLog): LogEvent {
  const attrs = asRecord(source.attributes);
  const resourceAttrs = asRecord(asRecord(source.resource)?.attributes);
  const dataStream = asRecord(source.data_stream);
  const body = asRecord(source.body);

  return {
    timestamp: normalizeTimestamp(source['@timestamp']),
    severity: (asString(source.severity_text) ?? 'unknown').toLowerCase(),
    message:
      asString(pick(attrs, 'message')) ??
      asString(body?.text) ??
      asString(source.body) ??
      '',
    eventAction: asString(pick(attrs, 'event.action')),
    eventOutcome: asString(pick(attrs, 'event.outcome')),
    eventCategory: asString(pick(attrs, 'event.category')),
    httpRoute: asString(pick(attrs, 'http.route')),
    httpMethod: asString(pick(attrs, 'http.request.method')),
    httpStatus: asNumber(pick(attrs, 'http.response.status_code')),
    cervejariaSlug: asString(pick(attrs, 'cervejaria.slug')) ?? asString(pick(attrs, 'cervejariaSlug')),
    actorType: asString(pick(attrs, 'actor.type')),
    traceId: asString(source.trace_id),
    spanId: asString(source.span_id),
    serviceName: asString(pick(resourceAttrs, 'service.name')),
    dataset: asString(dataStream?.dataset),
    stack:
      asString(pick(attrs, 'metadata.stack')) ??
      asString(pick(attrs, 'error.stack_trace')) ??
      asString(pick(attrs, 'exception.stacktrace')) ??
      asString(pick(attrs, 'stack')),
  };
}

/** Um log conta como falha se o outcome, a severidade ou o status HTTP indicarem erro. */
export function isFailure(event: LogEvent): boolean {
  if (event.eventOutcome === 'failure') return true;
  if (event.severity === 'error' || event.severity === 'fatal') return true;
  if (event.httpStatus != null && event.httpStatus >= 400) return true;
  return false;
}

export function isClientError(event: LogEvent): boolean {
  return event.httpStatus != null && event.httpStatus >= 400 && event.httpStatus < 500;
}

/**
 * Falha atribuivel ao servidor. Distinguir isso de `isFailure` importa: um 401 em
 * `/api/auth/me` e o comportamento correto de um endpoint que checa sessao, e a
 * auditoria o registra como `outcome: failure`. Tratar isso como bug faria o agente
 * abrir Issue para o funcionamento normal do login.
 */
export function isServerFailure(event: LogEvent): boolean {
  if (event.httpStatus != null && event.httpStatus >= 500) return true;
  if (isClientError(event)) return false;
  if (event.severity === 'error' || event.severity === 'fatal') return true;
  return event.eventOutcome === 'failure';
}

function topCounts(
  events: LogEvent[],
  key: (e: LogEvent) => string | undefined,
  limit = 5,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const value = key(event);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function fetchWindow(fromIso: string, toIso: string, size: number): Promise<LogEvent[]> {
  const res = await esSearch<RawLog>(config.es.logIndex, {
    size,
    query: { range: { '@timestamp': { gte: fromIso, lte: toIso } } },
    sort: [{ '@timestamp': 'desc' }],
  });
  return (res.hits?.hits ?? []).map((hit) => parseLogEvent(hit._source ?? {}));
}

export async function enrich(alert: Alert): Promise<Evidence> {
  const alertTime = new Date(alert.timestamp).getTime();
  const windowFrom = new Date(alertTime - WINDOW_BEFORE_MS).toISOString();
  const windowTo = new Date(alertTime + WINDOW_AFTER_MS).toISOString();

  let inWindow: LogEvent[] = [];
  let queryError: string | undefined;
  try {
    inWindow = await fetchWindow(windowFrom, windowTo, MAX_HITS);
  } catch (err) {
    queryError = err instanceof Error ? err.message : String(err);
  }

  const failures = inWindow.filter(isFailure);
  // Rotas, acoes e stack saem das falhas de servidor. Erros 4xx entram apenas na
  // listagem de contexto, para nao apontar o agente para um endpoint que esta correto.
  const serverFailures = failures.filter(isServerFailure);
  const clientErrors = failures.filter(isClientError);

  const evidence: Evidence = {
    failures: [...serverFailures, ...clientErrors].slice(0, 20),
    serverFailureCount: serverFailures.length,
    clientErrorCount: clientErrors.length,
    byRoute: topCounts(serverFailures, (e) => e.httpRoute).map((c) => ({ route: c.value, count: c.count })),
    byTenant: topCounts(serverFailures, (e) => e.cervejariaSlug).map((c) => ({ slug: c.value, count: c.count })),
    byAction: topCounts(serverFailures, (e) => e.eventAction).map((c) => ({ action: c.value, count: c.count })),
    totalInWindow: inWindow.length,
    windowFrom,
    windowTo,
  };

  const withStack = serverFailures.find((e) => e.stack) ?? failures.find((e) => e.stack);
  if (withStack?.stack) evidence.stack = withStack.stack;
  evidence.traceId = (serverFailures.find((e) => e.traceId) ?? failures.find((e) => e.traceId))?.traceId;

  if (queryError) {
    evidence.gap = `Nao foi possivel consultar ${config.es.logIndex}: ${queryError}`;
    return evidence;
  }

  if (!serverFailures.length) {
    evidence.gap =
      inWindow.length === 0
        ? `Nenhum log em ${config.es.logIndex} entre ${windowFrom} e ${windowTo}. ` +
          'O alerta pode ser de infraestrutura (a API caiu e parou de logar) ou a telemetria estava com gap.'
        : clientErrors.length
          ? `${clientErrors.length} erro(s) 4xx na janela e nenhuma falha de servidor. ` +
            '4xx costuma ser cliente mandando request invalido ou sessao expirada, nao bug de codigo.'
          : `${inWindow.length} logs na janela, nenhum com marca de falha de servidor ` +
            '(status >= 500, severity error/fatal ou event.outcome=failure). ' +
            'Sem sinal de erro de aplicacao para embasar correcao.';
    return evidence;
  }

  await addHistory(evidence, serverFailures);
  return evidence;
}

/** Primeira aparicao e frequencia em 7 dias, para separar regressao nova de problema cronico. */
async function addHistory(evidence: Evidence, failures: LogEvent[]): Promise<void> {
  const reference = failures[0];
  if (!reference) return;

  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60_000).toISOString();
  try {
    const res = await esSearch<RawLog>(config.es.logIndex, {
      size: MAX_HITS,
      query: { range: { '@timestamp': { gte: since } } },
      sort: [{ '@timestamp': 'asc' }],
    });
    const history = (res.hits?.hits ?? [])
      .map((hit) => parseLogEvent(hit._source ?? {}))
      .filter(isServerFailure)
      .filter(
        (e) =>
          e.eventAction === reference.eventAction ||
          (reference.httpRoute != null && e.httpRoute === reference.httpRoute),
      );
    if (history.length) {
      evidence.occurrences7d = history.length;
      evidence.firstSeen = history[0]?.timestamp;
      if (!evidence.stack) evidence.stack = history.find((e) => e.stack)?.stack;
    }
  } catch {
    // historico e complementar; a ausencia nao invalida o dossie
  }
}
