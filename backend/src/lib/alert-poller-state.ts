import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE_FILE = path.join(
  process.cwd(),
  '..',
  'deploy',
  'runtime',
  'alert-poller-state.json',
);

const MAX_PROCESSED_IDS = 2000;

export type AlertPollerState = {
  lastPollIso: string;
  processedIds: string[];
  lastPollAttemptAt?: string;
  lastSuccessfulPollAt?: string;
  lastPollErrorAt?: string;
  lastPollError?: string;
  lastEventProcessedAt?: string;
  lastDeliveryAttemptAt?: string;
  lastSuccessfulDeliveryAt?: string;
  lastDeliveryErrorAt?: string;
  lastDeliveryError?: string;
};

function stateFilePath(): string {
  const custom = process.env.KIBANA_ALERT_POLL_STATE_FILE?.trim();
  if (custom) return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  return DEFAULT_STATE_FILE;
}

function defaultState(): AlertPollerState {
  const lookbackMs = 2 * 60 * 1000;
  return {
    lastPollIso: new Date(Date.now() - lookbackMs).toISOString(),
    processedIds: [],
  };
}

export function loadAlertPollerState(): AlertPollerState {
  const file = stateFilePath();
  try {
    if (!fs.existsSync(file)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AlertPollerState>;
    if (!raw.lastPollIso || typeof raw.lastPollIso !== 'string') return defaultState();
    const ids = Array.isArray(raw.processedIds)
      ? raw.processedIds.filter((id): id is string => typeof id === 'string')
      : [];
    const state: AlertPollerState = { lastPollIso: raw.lastPollIso, processedIds: ids.slice(-MAX_PROCESSED_IDS) };
    for (const key of [
      'lastPollAttemptAt', 'lastSuccessfulPollAt', 'lastPollErrorAt', 'lastPollError',
      'lastEventProcessedAt', 'lastDeliveryAttemptAt', 'lastSuccessfulDeliveryAt',
      'lastDeliveryErrorAt', 'lastDeliveryError',
    ] as const) {
      if (typeof raw[key] === 'string') state[key] = raw[key];
    }
    return state;
  } catch {
    return defaultState();
  }
}

export function saveAlertPollerState(state: AlertPollerState): void {
  const file = stateFilePath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const trimmed: AlertPollerState = {
    lastPollIso: state.lastPollIso,
    processedIds: state.processedIds.slice(-MAX_PROCESSED_IDS),
  };
  for (const key of [
    'lastPollAttemptAt', 'lastSuccessfulPollAt', 'lastPollErrorAt', 'lastPollError',
    'lastEventProcessedAt', 'lastDeliveryAttemptAt', 'lastSuccessfulDeliveryAt',
    'lastDeliveryErrorAt', 'lastDeliveryError',
  ] as const) {
    if (state[key]) trimmed[key] = state[key];
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(trimmed, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

/** Error text is operational context, never a place for credentials or headers. */
export function summarizeAlertPollerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(api[_-]?key|authorization|password|token)\s*[:=]\s*[^\s;,]+/gi, '$1=REDACTED')
    .replace(/https?:\/\/[^\s@]+@/gi, 'URL_REDACTED@')
    .replace(/\s+/g, ' ')
    .slice(0, 300) || 'Erro desconhecido';
}

export function markAlertProcessed(state: AlertPollerState, alertId: string): AlertPollerState {
  if (!alertId || state.processedIds.includes(alertId)) return state;
  const processedIds = [...state.processedIds, alertId].slice(-MAX_PROCESSED_IDS);
  return { ...state, processedIds };
}

export function isAlertProcessed(state: AlertPollerState, alertId: string | undefined): boolean {
  if (!alertId) return false;
  return state.processedIds.includes(alertId);
}
