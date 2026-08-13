import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canAttemptFix, dailyRunLimit, estimatedCostUsd } from './circuit-breaker.js';
import { config } from './config.js';
import type { AgentState, DayCounters } from './state.js';

function hoje(overrides: Partial<DayCounters> = {}): DayCounters {
  return {
    day: new Date().toISOString().slice(0, 10),
    prsOpened: 0,
    runs: 0,
    cliDurationMs: 0,
    ...overrides,
  };
}

function estado(overrides: Partial<AgentState> = {}): AgentState {
  return {
    version: 2,
    lastPollIso: '2026-08-11T21:00:00.000Z',
    processedAlertIds: [],
    fingerprints: {},
    today: hoje(),
    reviewedPrs: [],
    ...overrides,
  };
}

function registro(fixAttempts: number) {
  return {
    'rule:abc': {
      fingerprint: 'rule:abc',
      issueNumber: 42,
      firstSeenIso: '2026-08-11T20:00:00.000Z',
      lastSeenIso: '2026-08-11T21:00:00.000Z',
      fixAttempts,
      prNumbers: [] as number[],
    },
  };
}

test('permite a primeira tentativa', () => {
  assert.equal(canAttemptFix(estado(), 'rule:abc').allowed, true);
});

test('bloqueia depois do limite de tentativas por fingerprint', () => {
  const state = estado({ fingerprints: registro(config.fixer.maxAttemptsPerFingerprint) });
  const verdict = canAttemptFix(state, 'rule:abc');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : '', /por fingerprint/);
});

test('ainda permite quando esta uma tentativa abaixo do limite', () => {
  const state = estado({ fingerprints: registro(config.fixer.maxAttemptsPerFingerprint - 1) });
  assert.equal(canAttemptFix(state, 'rule:abc').allowed, true);
});

test('bloqueia no teto de PRs por dia', () => {
  const state = estado({ today: hoje({ prsOpened: config.fixer.maxPrsPerDay }) });
  const verdict = canAttemptFix(state, 'rule:novo');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : '', /PR\(s\) automatico/);
});

test('bloqueia no limite diario de execucoes', () => {
  const limit = dailyRunLimit();
  const state = estado({ today: hoje({ runs: limit.runs }) });
  const verdict = canAttemptFix(state, 'rule:novo');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : '', /execucao/);
});

test('permite uma execucao antes do limite diario', () => {
  const limit = dailyRunLimit();
  const state = estado({ today: hoje({ runs: limit.runs - 1 }) });
  assert.equal(canAttemptFix(state, 'rule:novo').allowed, true);
});

test('o limite diario nunca deixa o custo estimado passar do orcamento', () => {
  const limit = dailyRunLimit();
  assert.ok(
    estimatedCostUsd(limit.runs) <= config.fixer.maxCostUsdPerDay,
    `${limit.runs} execucoes custariam US$ ${estimatedCostUsd(limit.runs)}, ` +
      `acima do teto US$ ${config.fixer.maxCostUsdPerDay}`,
  );
});

test('o limite diario nunca excede o teto de execucoes configurado', () => {
  assert.ok(dailyRunLimit().runs <= config.fixer.maxRunsPerDay);
});

test('custo estimado e linear no numero de execucoes', () => {
  assert.equal(estimatedCostUsd(0), 0);
  assert.equal(estimatedCostUsd(2), 2 * config.fixer.estCostUsdPerRun);
});
