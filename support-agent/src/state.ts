import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { log } from './logger.js';

/**
 * Estado proprio do agente, separado de deploy/runtime/alert-poller-state.json.
 * O agente roda em paralelo ao alert-poller e nao interfere no fluxo de notificacao.
 */

export type FingerprintRecord = {
  fingerprint: string;
  issueNumber: number | null;
  firstSeenIso: string;
  lastSeenIso: string;
  /** Quantas vezes o fixer tentou corrigir (circuit breaker da Fase 3). */
  fixAttempts: number;
  /** PRs abertos para este fingerprint. */
  prNumbers: number[];
  /** Motivo do ultimo abandono, para aparecer no relatorio semanal. */
  lastGiveUpReason?: string;
};

export type DayCounters = {
  /** Data local em YYYY-MM-DD. */
  day: string;
  prsOpened: number;
  /** Execucoes do Cursor CLI hoje — e o controle de gasto real (ver circuit-breaker.ts). */
  runs: number;
  /** Tempo total gasto pelo CLI hoje, em ms. */
  cliDurationMs: number;
};

export type AgentState = {
  version: 2;
  lastPollIso: string;
  processedAlertIds: string[];
  fingerprints: Record<string, FingerprintRecord>;
  today: DayCounters;
  /**
   * PRs cujo desfecho (merge ou rejeicao) ja foi contabilizado na revisao semanal.
   * Sem isso a metrica de aprovados/rejeitados somaria os mesmos PRs a cada execucao.
   */
  reviewedPrs: number[];
};

const MAX_PROCESSED_IDS = 500;
const MAX_REVIEWED_PRS = 300;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): AgentState {
  return {
    version: 2,
    // primeira execucao olha 1 hora para tras, nao o historico inteiro
    lastPollIso: new Date(Date.now() - 60 * 60_000).toISOString(),
    processedAlertIds: [],
    fingerprints: {},
    today: emptyDay(),
    reviewedPrs: [],
  };
}

function emptyDay(): DayCounters {
  return { day: today(), prsOpened: 0, runs: 0, cliDurationMs: 0 };
}

export function loadState(): AgentState {
  try {
    if (!fs.existsSync(config.stateFile)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(config.stateFile, 'utf8')) as Partial<AgentState>;
    const base = emptyState();
    const state: AgentState = {
      version: 2,
      lastPollIso: parsed.lastPollIso ?? base.lastPollIso,
      processedAlertIds: parsed.processedAlertIds ?? [],
      fingerprints: parsed.fingerprints ?? {},
      today: { ...emptyDay(), ...parsed.today },
      reviewedPrs: parsed.reviewedPrs ?? [],
    };
    // contadores diarios zeram na virada do dia
    if (state.today.day !== today()) state.today = emptyDay();
    return state;
  } catch (err) {
    log.warn('Estado ilegivel, comecando limpo', { err: String(err) });
    return emptyState();
  }
}

export function saveState(state: AgentState): void {
  try {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    const trimmed: AgentState = {
      ...state,
      processedAlertIds: state.processedAlertIds.slice(-MAX_PROCESSED_IDS),
    };
    fs.writeFileSync(config.stateFile, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  } catch (err) {
    log.error('Falha ao salvar estado', { err: String(err) });
  }
}

export function isAlertProcessed(state: AgentState, alertId: string): boolean {
  return state.processedAlertIds.includes(alertId);
}

export function markAlertProcessed(state: AgentState, alertId: string): AgentState {
  if (state.processedAlertIds.includes(alertId)) return state;
  return { ...state, processedAlertIds: [...state.processedAlertIds, alertId] };
}

export function getFingerprint(state: AgentState, fingerprint: string): FingerprintRecord | undefined {
  return state.fingerprints[fingerprint];
}

export function upsertFingerprint(
  state: AgentState,
  fingerprint: string,
  patch: Partial<Omit<FingerprintRecord, 'fingerprint'>>,
): AgentState {
  const now = new Date().toISOString();
  const existing = state.fingerprints[fingerprint];
  const record: FingerprintRecord = {
    fingerprint,
    issueNumber: patch.issueNumber ?? existing?.issueNumber ?? null,
    firstSeenIso: existing?.firstSeenIso ?? now,
    lastSeenIso: now,
    fixAttempts: patch.fixAttempts ?? existing?.fixAttempts ?? 0,
    prNumbers: patch.prNumbers ?? existing?.prNumbers ?? [],
    ...(patch.lastGiveUpReason !== undefined
      ? { lastGiveUpReason: patch.lastGiveUpReason }
      : existing?.lastGiveUpReason !== undefined
        ? { lastGiveUpReason: existing.lastGiveUpReason }
        : {}),
  };
  return { ...state, fingerprints: { ...state.fingerprints, [fingerprint]: record } };
}

function currentDay(state: AgentState): DayCounters {
  return state.today.day === today() ? state.today : emptyDay();
}

export function recordCliRun(state: AgentState, durationMs: number): AgentState {
  const day = currentDay(state);
  return {
    ...state,
    today: { ...day, runs: day.runs + 1, cliDurationMs: day.cliDurationMs + durationMs },
  };
}

export function incrementPrsOpened(state: AgentState): AgentState {
  const day = currentDay(state);
  return { ...state, today: { ...day, prsOpened: day.prsOpened + 1 } };
}

export function isPrReviewed(state: AgentState, prNumber: number): boolean {
  return state.reviewedPrs.includes(prNumber);
}

export function markPrsReviewed(state: AgentState, prNumbers: number[]): AgentState {
  const merged = new Set([...state.reviewedPrs, ...prNumbers]);
  return { ...state, reviewedPrs: [...merged].slice(-MAX_REVIEWED_PRS) };
}
