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
const MAX_DELIVERY_FAILURES = 200;

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
  deliveryFailures?: Record<string, number>;
  lastAbandonedAlertId?: string;
  lastAbandonedAt?: string;
};

const STRING_KEYS = [
  'lastPollAttemptAt', 'lastSuccessfulPollAt', 'lastPollErrorAt', 'lastPollError',
  'lastEventProcessedAt', 'lastDeliveryAttemptAt', 'lastSuccessfulDeliveryAt',
  'lastDeliveryErrorAt', 'lastDeliveryError', 'lastAbandonedAlertId', 'lastAbandonedAt',
] as const;

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

function trimFailures(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0)
    .slice(-MAX_DELIVERY_FAILURES);
  return entries.length ? Object.fromEntries(entries) : undefined;
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
    for (const key of STRING_KEYS) {
      if (typeof raw[key] === 'string') state[key] = raw[key];
    }
    const failures = trimFailures(raw.deliveryFailures);
    if (failures) state.deliveryFailures = failures;
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
  for (const key of STRING_KEYS) {
    if (state[key]) trimmed[key] = state[key];
  }
  const failures = trimFailures(state.deliveryFailures);
  if (failures) trimmed.deliveryFailures = failures;
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

export function recordDeliveryFailure(state: AlertPollerState, alertId: string): { state: AlertPollerState; attempts: number } {
  const attempts = (state.deliveryFailures?.[alertId] ?? 0) + 1;
  return { state: { ...state, deliveryFailures: { ...(state.deliveryFailures ?? {}), [alertId]: attempts } }, attempts };
}

export function clearDeliveryFailure(state: AlertPollerState, alertId: string): AlertPollerState {
  if (!state.deliveryFailures?.[alertId]) return state;
  const rest = { ...state.deliveryFailures };
  delete rest[alertId];
  return { ...state, deliveryFailures: Object.keys(rest).length ? rest : undefined };
}
