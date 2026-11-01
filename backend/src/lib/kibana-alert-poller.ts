import {
  clearDeliveryFailure,
  isAlertProcessed,
  loadAlertPollerState,
  markAlertProcessed,
  recordDeliveryFailure,
  saveAlertPollerState,
  summarizeAlertPollerError,
  type AlertPollerState,
} from './alert-poller-state.js';
import { handleKibanaAlertWebhook, isAlertNotifyConfigured, type AlertNotifyResult } from './kibana-alert-email.js';
import { isTelegramAlertConfigured } from './telegram-alert.js';

const DEFAULT_ES_URL = 'http://127.0.0.1:9200';
const DEFAULT_INDEX = 'quiver-tap-alert-events';
const DEFAULT_INTERVAL_MS = 30_000;
/** About five minutes with the default 30s interval. */
const MAX_DELIVERY_ATTEMPTS = 10;

type EsHit = {
  _id?: string;
  _source?: Record<string, unknown>;
};

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let state: AlertPollerState = loadAlertPollerState();

function esUrl(): string {
  return (process.env.KIBANA_ALERT_ES_URL ?? DEFAULT_ES_URL).replace(/\/$/, '');
}

function esIndex(): string {
  return process.env.KIBANA_ALERT_ES_INDEX?.trim() || DEFAULT_INDEX;
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

export function pollIntervalMs(): number {
  const raw = process.env.KIBANA_ALERT_POLL_INTERVAL_MS;
  const n = raw ? parseInt(raw, 10) : DEFAULT_INTERVAL_MS;
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_INTERVAL_MS;
}

/** API só inicia poller se explicitamente habilitado (worker usa processo separado). */
export function pollEnabledInApi(): boolean {
  const flag = process.env.KIBANA_ALERT_POLL_IN_API?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return isAlertNotifyConfigured();
  return false;
}

/** Worker standalone habilitado quando e-mail ou Telegram estiver configurado. */
export function pollEnabledInWorker(): boolean {
  const flag = process.env.KIBANA_ALERT_POLL_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  return isAlertNotifyConfigured();
}

function activeNotifyChannels(): string[] {
  const channels: string[] = [];
  if (process.env.OBS_ALERT_EMAIL_TO?.trim()) channels.push('email');
  if (isTelegramAlertConfigured()) channels.push('telegram');
  return channels;
}

async function markProcessedInEs(alertId: string): Promise<void> {
  try {
    await fetch(`${esUrl()}/${encodeURIComponent(esIndex())}/_update/${encodeURIComponent(alertId)}`, {
      method: 'POST',
      headers: esAuthHeaders(),
      body: JSON.stringify({
        doc: { processed: true, processedAt: new Date().toISOString() },
      }),
    });
  } catch {
    // best-effort — estado local é fonte primária
  }
}

export type AlertPollerHealth = {
  status: 'healthy' | 'degraded';
  process: 'up';
  elasticsearch: 'ok' | 'error' | 'unknown';
  pollingActive: boolean;
  pollInFlight: boolean;
  notifyChannels: string[];
  authentication: 'api-key' | 'basic' | 'none';
  target: { origin: string | null; customPath: boolean; queryPresent: boolean; index: string };
  lastPollAttemptAt?: string;
  lastSuccessfulPollAt?: string;
  lastPollError?: string;
  lastPollErrorAt?: string;
  lastPollErrorIsHistorical: boolean;
  lastEventProcessedAt?: string;
  lastSuccessfulDeliveryAt?: string;
  lastDeliveryError?: string;
  pendingRetries: number;
  lastAbandonedAlertId?: string;
  lastAbandonedAt?: string;
  stale: boolean;
};

/** Three polling intervals tolerate a single delayed request without inventing an SLA. */
export function getAlertPollerHealth(now = Date.now()): AlertPollerHealth {
  state = loadAlertPollerState();
  const lastSuccess = state.lastSuccessfulPollAt ? Date.parse(state.lastSuccessfulPollAt) : NaN;
  const stale = !Number.isFinite(lastSuccess) || now - lastSuccess > pollIntervalMs() * 3;
  const errorAt = state.lastPollErrorAt ? Date.parse(state.lastPollErrorAt) : NaN;
  const errorIsHistorical = Boolean(state.lastPollError && (!Number.isFinite(errorAt) || now - errorAt > pollIntervalMs() * 3));
  const hasRecentError = Boolean(!errorIsHistorical && state.lastPollErrorAt && (!Number.isFinite(lastSuccess) || errorAt >= lastSuccess));
  const pendingRetries = Object.keys(state.deliveryFailures ?? {}).length;
  let origin: string | null = null;
  let customPath = false;
  let queryPresent = false;
  try {
    const url = new URL(esUrl());
    if (['http:', 'https:'].includes(url.protocol)) origin = url.origin;
    customPath = url.pathname !== '/';
    queryPresent = Boolean(url.search);
  } catch { /* Invalid configuration is metadata, never a place to echo secrets. */ }
  const keyConfigured = Boolean(process.env.KIBANA_ALERT_ES_API_KEY?.trim() || process.env.ELASTIC_API_KEY_ALERT_POLLER?.trim());
  const passwordConfigured = Boolean(process.env.KIBANA_ALERT_ES_PASSWORD?.trim() || process.env.ELASTIC_PASSWORD?.trim());
  return {
    status: stale || hasRecentError || pendingRetries > 0 ? 'degraded' : 'healthy',
    process: 'up',
    elasticsearch: hasRecentError ? 'error' : !stale && Number.isFinite(lastSuccess) ? 'ok' : 'unknown',
    pollingActive: timer !== null,
    pollInFlight: polling,
    notifyChannels: activeNotifyChannels(),
    authentication: keyConfigured ? 'api-key' : passwordConfigured ? 'basic' : 'none',
    target: { origin, customPath, queryPresent, index: esIndex() },
    lastPollAttemptAt: state.lastPollAttemptAt,
    lastSuccessfulPollAt: state.lastSuccessfulPollAt,
    lastPollError: state.lastPollError,
    lastPollErrorAt: state.lastPollErrorAt,
    lastPollErrorIsHistorical: errorIsHistorical,
    lastEventProcessedAt: state.lastEventProcessedAt,
    lastSuccessfulDeliveryAt: state.lastSuccessfulDeliveryAt,
    lastDeliveryError: state.lastDeliveryError,
    pendingRetries,
    lastAbandonedAlertId: state.lastAbandonedAlertId,
    lastAbandonedAt: state.lastAbandonedAt,
    stale,
  };
}

export type PollOnceDependencies = {
  notify?: (body: unknown, alertId?: string) => Promise<AlertNotifyResult>;
  now?: () => Date;
};

export async function pollOnce(log: {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}, dependencies: PollOnceDependencies = {}): Promise<void> {
  if (polling) return;
  polling = true;
  const now = dependencies.now ?? (() => new Date());
  const notify = dependencies.notify ?? handleKibanaAlertWebhook;

  try {
    state = loadAlertPollerState();
    state = { ...state, lastPollAttemptAt: now().toISOString() };

    // gte: an alert that failed delivery keeps the cursor at its timestamp and is read again.
    const res = await fetch(`${esUrl()}/${encodeURIComponent(esIndex())}/_search`, {
      method: 'POST',
      headers: esAuthHeaders(),
      body: JSON.stringify({
        query: {
          bool: {
            must: [{ range: { '@timestamp': { gte: state.lastPollIso } } }],
            must_not: [{ term: { processed: true } }],
          },
        },
        sort: [{ '@timestamp': 'asc' }],
        size: 50,
      }),
    });

    if (!res.ok) {
      const failedAt = now().toISOString();
      state = { ...state, lastPollErrorAt: failedAt, lastPollError: `Elasticsearch HTTP ${res.status}` };
      saveAlertPollerState(state);
      log.warn({ status: res.status, index: esIndex() }, 'Kibana alert poller: falha ao consultar ES');
      return;
    }

    const data = (await res.json()) as { hits?: { hits?: EsHit[] } };
    const hits = data.hits?.hits ?? [];
    state = { ...state, lastSuccessfulPollAt: now().toISOString(), lastPollErrorAt: undefined, lastPollError: undefined };
    if (!hits.length) {
      saveAlertPollerState(state);
      return;
    }

    let safeCursor = state.lastPollIso;
    let blocked = false;
    const advance = (ts?: string) => {
      if (!blocked && ts && ts > safeCursor) safeCursor = ts;
    };

    for (const hit of hits) {
      const src = hit._source ?? {};
      const ts = typeof src['@timestamp'] === 'string' ? src['@timestamp'] : undefined;
      if (!hit._id || isAlertProcessed(state, hit._id)) {
        advance(ts);
        continue;
      }
      const alertId = hit._id;

      try {
        state = { ...state, lastDeliveryAttemptAt: now().toISOString() };
        const result = await notify(src, alertId);
        if (result.sent) {
          state = { ...state, lastSuccessfulDeliveryAt: now().toISOString(), lastDeliveryErrorAt: undefined, lastDeliveryError: undefined };
          log.info(
            {
              ruleName: src.ruleName ?? src.rule_name,
              alertId,
              channels: result.channels,
            },
            'Alerta Kibana enviado (poller ES)',
          );
        }
        state = clearDeliveryFailure(markAlertProcessed(state, alertId), alertId);
        state = { ...state, lastEventProcessedAt: now().toISOString() };
        void markProcessedInEs(alertId);
        advance(ts);
      } catch (err) {
        const msg = summarizeAlertPollerError(err);
        const failed = recordDeliveryFailure(state, alertId);
        state = { ...failed.state, lastDeliveryErrorAt: now().toISOString(), lastDeliveryError: msg };
        if (failed.attempts >= MAX_DELIVERY_ATTEMPTS) {
          state = clearDeliveryFailure(markAlertProcessed(state, alertId), alertId);
          state = { ...state, lastAbandonedAlertId: alertId, lastAbandonedAt: now().toISOString() };
          void markProcessedInEs(alertId);
          log.warn({ err: msg, alertId, attempts: failed.attempts }, 'Kibana alert poller: alerta DESCARTADO apos tentativas maximas');
          advance(ts);
        } else {
          blocked = true;
          log.warn({ err: msg, alertId, attempts: failed.attempts }, 'Kibana alert poller: falha ao enviar alerta; nova tentativa no proximo ciclo');
        }
      }
    }

    state = { ...state, lastPollIso: safeCursor };
    saveAlertPollerState(state);
  } catch (err) {
    const msg = summarizeAlertPollerError(err);
    state = { ...state, lastPollErrorAt: now().toISOString(), lastPollError: msg };
    saveAlertPollerState(state);
    log.warn({ err: msg }, 'Kibana alert poller: erro inesperado');
  } finally {
    polling = false;
  }
}

export function startKibanaAlertPoller(
  log: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void },
  mode: 'api' | 'worker' = 'api',
): void {
  const enabled = mode === 'worker' ? pollEnabledInWorker() : pollEnabledInApi();
  if (!enabled) return;
  if (timer) return;

  const interval = pollIntervalMs();
  const channels = activeNotifyChannels();
  log.info(
    { index: esIndex(), intervalMs: interval, esUrl: esUrl(), mode, channels },
    'Kibana alert poller iniciado (connector .index → ES → notificação)',
  );

  void pollOnce(log);
  timer = setInterval(() => {
    void pollOnce(log);
  }, interval);
}

export function stopKibanaAlertPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
