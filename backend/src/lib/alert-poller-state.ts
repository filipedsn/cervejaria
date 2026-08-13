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
    return { lastPollIso: raw.lastPollIso, processedIds: ids.slice(-MAX_PROCESSED_IDS) };
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
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), 'utf8');
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
