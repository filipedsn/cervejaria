import {
  isAlertProcessed,
  loadAlertPollerState,
  markAlertProcessed,
  saveAlertPollerState,
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

function pollIntervalMs(): number {
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

async function pollOnce(log: {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    state = loadAlertPollerState();

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
      log.warn({ status: res.status, index: esIndex() }, 'Kibana alert poller: falha ao consultar ES');
      return;
    }

    const data = (await res.json()) as { hits?: { hits?: EsHit[] } };
    const hits = data.hits?.hits ?? [];
    if (!hits.length) return;

    let maxTs = state.lastPollIso;

    for (const hit of hits) {
      const src = hit._source ?? {};
      const ts = typeof src['@timestamp'] === 'string' ? src['@timestamp'] : undefined;
      if (ts && ts > maxTs) maxTs = ts;

      if (isAlertProcessed(state, hit._id)) continue;

      try {
        const result = await handleKibanaAlertWebhook(src, hit._id);
        if (result.sent) {
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
          void markProcessedInEs(hit._id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, alertId: hit._id }, 'Kibana alert poller: falha ao enviar alerta');
      }
    }

    state = { ...state, lastPollIso: maxTs };
    saveAlertPollerState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
