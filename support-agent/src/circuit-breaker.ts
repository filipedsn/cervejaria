import { config } from './config.js';
import type { AgentState } from './state.js';

/**
 * Fase 3 — circuit breakers.
 *
 * O Cursor CLI nao tem `--max-turns` e o `stream-json` nao emite custo, so
 * `duration_ms`. Isso define o que da e o que nao da para controlar:
 *
 * - dentro de uma execucao: apenas timeout de processo
 * - entre execucoes: tentativas por fingerprint, execucoes por dia, PRs por dia
 *
 * O custo diario e estimado a partir do numero de execucoes. Para um teto real de
 * gasto, configure spend limit na conta ou na service account key do Cursor.
 */

export type BreakerVerdict = { allowed: true } | { allowed: false; reason: string };

export function canAttemptFix(state: AgentState, fingerprint: string): BreakerVerdict {
  const record = state.fingerprints[fingerprint];
  const attempts = record?.fixAttempts ?? 0;
  const max = config.fixer.maxAttemptsPerFingerprint;

  if (attempts >= max) {
    return {
      allowed: false,
      reason:
        `Limite de ${max} tentativa(s) por fingerprint atingido (${attempts} ja feitas). ` +
        'Este bug precisa de analise humana.',
    };
  }

  if (state.today.prsOpened >= config.fixer.maxPrsPerDay) {
    return {
      allowed: false,
      reason: `Limite de ${config.fixer.maxPrsPerDay} PR(s) automatico(s) por dia atingido.`,
    };
  }

  const limit = dailyRunLimit();
  if (state.today.runs >= limit.runs) {
    return {
      allowed: false,
      reason:
        `Limite de ${limit.runs} execucao(oes) do Cursor CLI por dia atingido ` +
        `(${state.today.runs} ja feitas). Restricao ativa: ${limit.boundBy}.`,
    };
  }

  return { allowed: true };
}

/**
 * Execucoes permitidas por dia. Ha duas configuracoes que limitam isso — o teto de
 * execucoes e o orcamento diario — e vale a mais restritiva. Retornar qual delas
 * manda evita a duvida de "por que parou em 6 se configurei 10".
 */
export function dailyRunLimit(): { runs: number; boundBy: 'execucoes' | 'orcamento' } {
  const byRuns = Math.max(0, config.fixer.maxRunsPerDay);
  const perRun = config.fixer.estCostUsdPerRun;
  const byBudget = perRun > 0 ? Math.floor(config.fixer.maxCostUsdPerDay / perRun) : byRuns;

  return byBudget < byRuns
    ? { runs: byBudget, boundBy: 'orcamento' }
    : { runs: byRuns, boundBy: 'execucoes' };
}

/** Gasto estimado do dia, derivado do numero de execucoes. */
export function estimatedCostUsd(runs: number): number {
  return runs * config.fixer.estCostUsdPerRun;
}
