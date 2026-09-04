import {
  isAlertProcessed,
  loadAlertPollerState,
  markAlertProcessed,
  saveAlertPollerState,
  summarizeAlertPollerError,
  type AlertPollerState,
} from './alert-poller-state.js';
import { handleKibanaAlertWebhook, isAlertNotifyConfigured } from './kibana-alert-email.js';
import { isTelegramAlertConfigured } from './telegram-alert.js';

const DEFAULT_ES_URL = 'http://127.0.0.1:9200';
const DEFAULT_INDEX = 'quiver-tap-alert-events';
const DEFAULT_INTERVAL_MS = 30_000;

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
  lastPollAttemptAt?: string;
  lastSuccessfulPollAt?: string;
  lastPollError?: string;
  lastEventProcessedAt?: string;
  lastSuccessfulDeliveryAt?: string;
  lastDeliveryError?: string;
  stale: boolean;
};

/** Three polling intervals tolerate a single delayed request without inventing an SLA. */
export function getAlertPollerHealth(now = Date.now()): AlertPollerHealth {
  state = loadAlertPollerState();
  const lastSuccess = state.lastSuccessfulPollAt ? Date.parse(state.lastSuccessfulPollAt) : NaN;
  const stale = !Number.isFinite(lastSuccess) || now - lastSuccess > pollIntervalMs() * 3;
  const hasRecentError = Boolean(state.lastPollErrorAt && (!Number.isFinite(lastSuccess) || Date.parse(state.lastPollErrorAt) >= lastSuccess));
  return {
    status: stale || hasRecentError ? 'degraded' : 'healthy',
    process: 'up',
    elasticsearch: hasRecentError ? 'error' : Number.isFinite(lastSuccess) ? 'ok' : 'unknown',
    lastPollAttemptAt: state.lastPollAttemptAt,
    lastSuccessfulPollAt: state.lastSuccessfulPollAt,
    lastPollError: state.lastPollError,
    lastEventProcessedAt: state.lastEventProcessedAt,
    lastSuccessfulDeliveryAt: state.lastSuccessfulDeliveryAt,
    lastDeliveryError: state.lastDeliveryError,
    stale,
  };
}

export async function pollOnce(log: {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    state = loadAlertPollerState();
    state = { ...state, lastPollAttemptAt: new Date().toISOString() };

    const res = await fetch(`${esUrl()}/${encodeURIComponent(esIndex())}/_search`, {
      method: 'POST',
      headers: esAuthHeaders(),
      body: JSON.stringify({
        query: {
          bool: {
            must: [{ range: { '@timestamp': { gt: state.lastPollIso } } }],
            must_not: [{ term: { processed: true } }],
          },
        },
        sort: [{ '@timestamp': 'asc' }],
        size: 50,
      }),
    });

    if (!res.ok) {
      const now = new Date().toISOString();
      state = { ...state, lastPollErrorAt: now, lastPollError: `Elasticsearch HTTP ${res.status}` };
      saveAlertPollerState(state);
      log.warn({ status: res.status, index: esIndex() }, 'Kibana alert poller: falha ao consultar ES');
      return;
    }

    const data = (await res.json()) as { hits?: { hits?: EsHit[] } };
    const hits = data.hits?.hits ?? [];
    state = { ...state, lastSuccessfulPollAt: new Date().toISOString(), lastPollErrorAt: undefined, lastPollError: undefined };
    if (!hits.length) {
      saveAlertPollerState(state);
      return;
    }

    let maxTs = state.lastPollIso;

    for (const hit of hits) {
      const src = hit._source ?? {};
      const ts = typeof src['@timestamp'] === 'string' ? src['@timestamp'] : undefined;
      if (ts && ts > maxTs) maxTs = ts;

      if (isAlertProcessed(state, hit._id)) continue;

      try {
        state = { ...state, lastDeliveryAttemptAt: new Date().toISOString() };
        const result = await handleKibanaAlertWebhook(src, hit._id);
        if (result.sent) {
          state = { ...state, lastSuccessfulDeliveryAt: new Date().toISOString(), lastDeliveryErrorAt: undefined, lastDeliveryError: undefined };
          log.info(
            {
              ruleName: src.ruleName ?? src.rule_name,
              alertId: hit._id,
              channels: result.channels,
            },
            'Alerta Kibana enviado (poller ES)',
          );
        }
        if (hit._id) {
          state = markAlertProcessed(state, hit._id);
          state = { ...state, lastEventProcessedAt: new Date().toISOString() };
          void markProcessedInEs(hit._id);
        }
      } catch (err) {
        const msg = summarizeAlertPollerError(err);
        state = { ...state, lastDeliveryErrorAt: new Date().toISOString(), lastDeliveryError: msg };
        log.warn({ err: msg, alertId: hit._id }, 'Kibana alert poller: falha ao enviar alerta');
      }
    }

    state = { ...state, lastPollIso: maxTs };
    saveAlertPollerState(state);
  } catch (err) {
    const msg = summarizeAlertPollerError(err);
    state = { ...state, lastPollErrorAt: new Date().toISOString(), lastPollError: msg };
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
