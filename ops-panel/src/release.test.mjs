import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_REQUIRED_CHECKS,
  checkVerdict,
  evaluateReleaseGate,
  isAgentBranch,
  readDeployRecovery,
  shouldAutoSyncMain,
  summarizeChecks,
} from './release.mjs';

const HEAD = 'a'.repeat(40);

/** Estado que passa em todas as regras; cada teste piora um fato de cada vez. */
function estadoLimpo(overrides = {}) {
  return {
    gitAvailable: true,
    head: { sha: HEAD, branch: 'main', author: 'Filipe', date: '2026-08-12T10:00:00Z', message: 'fix: algo' },
    workingTreeDirty: false,
    dirtyCount: 0,
    originMain: { sha: HEAD, fetchOk: true, fetchError: null },
    headOnOriginMain: true,
    behindOriginMain: 0,
    deployed: { gitSha: 'b'.repeat(7), deployedAt: '2026-08-11T10:00:00Z' },
    pending: [{ sha: HEAD, shortSha: HEAD.slice(0, 7), message: 'fix: algo', fromAgent: false }],
    migrationsChanged: [],
    checks: DEFAULT_REQUIRED_CHECKS.map((name) => ({
      name,
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-08-12T10:01:00Z',
    })),
    ...overrides,
  };
}

function codigos(result) {
  return result.blockers.map((b) => b.code);
}

test('libera quando main, working tree limpa e CI verde', () => {
  const result = evaluateReleaseGate(estadoLimpo());
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});

test('bloqueia quando o CI nao pode ser verificado', () => {
  const semToken = evaluateReleaseGate(estadoLimpo({ checksConfigured: false, checks: [] }));
  assert.equal(semToken.allowed, false);
  assert.deepEqual(codigos(semToken), ['ci-nao-verificavel'], 'um impedimento so, nao um por check');

  const comErro = evaluateReleaseGate(estadoLimpo({ checksError: 'GitHub API 403' }));
  assert.ok(codigos(comErro).includes('ci-nao-verificavel'));
  assert.match(comErro.blockers[0].message, /403/);
});

test('avisa quando nao ha manifest publicado', () => {
  const result = evaluateReleaseGate(estadoLimpo({ deployed: null }));
  assert.equal(result.allowed, true);
  assert.match(result.warnings.join(' '), /Sem manifest/);
});

test('propaga o erro de listagem de commits como aviso', () => {
  const result = evaluateReleaseGate(estadoLimpo({ pendingError: 'commit publicado nao existe local' }));
  assert.match(result.warnings.join(' '), /nao existe local/);
});

test('bloqueia sem git — sem procedencia nao ha deploy', () => {
  const result = evaluateReleaseGate({ gitAvailable: false });
  assert.equal(result.allowed, false);
  assert.deepEqual(codigos(result), ['git-indisponivel']);
  assert.equal(result.blockers[0].overridable, false);
});

test('bloqueia commit que nao esta em origin/main', () => {
  const result = evaluateReleaseGate(estadoLimpo({ headOnOriginMain: false, head: { sha: HEAD, branch: 'feat/x' } }));
  assert.equal(result.allowed, false);
  assert.ok(codigos(result).includes('head-fora-do-main'));
  assert.match(result.blockers[0].message, /feat\/x/);
});

test('bloqueia working tree suja, porque o deploy compila o local', () => {
  const result = evaluateReleaseGate(estadoLimpo({
    workingTreeDirty: true,
    dirtyCount: 2,
    dirtyFiles: ['backend/foo.txt', 'deploy/logs/x.log'],
  }));
  assert.equal(result.allowed, false);
  assert.ok(codigos(result).includes('working-tree-suja'));
  assert.match(result.blockers[0].message, /backend\/foo\.txt/);
});

test('bloqueia check que falhou, que esta rodando e que nao existe', () => {
  const result = evaluateReleaseGate(
    estadoLimpo({
      checks: [
        { name: 'frontend', status: 'completed', conclusion: 'failure' },
        { name: 'backend-validate', status: 'completed', conclusion: 'success' },
        { name: 'backend-test', status: 'in_progress', conclusion: null },
      ],
    }),
    { requiredChecks: ['frontend', 'backend-validate', 'backend-test', 'support-agent-test'] },
  );
  assert.equal(result.allowed, false);
  assert.deepEqual(codigos(result), ['check-falhou', 'check-rodando', 'check-ausente']);
});

test('check skipped ou neutral nao bloqueia', () => {
  const result = evaluateReleaseGate(
    estadoLimpo({
      checks: DEFAULT_REQUIRED_CHECKS.map((name) => ({ name, status: 'completed', conclusion: 'skipped' })),
    }),
  );
  assert.equal(result.allowed, true);
});

test('backend-build nao entra no gate por ter continue-on-error', () => {
  assert.equal(DEFAULT_REQUIRED_CHECKS.includes('backend-build'), false);
});

test('migration exige confirmacao explicita', () => {
  const state = estadoLimpo({ migrationsChanged: ['backend/prisma/migrations/20260812_x/migration.sql'] });
  assert.equal(evaluateReleaseGate(state).allowed, false);
  assert.ok(codigos(evaluateReleaseGate(state)).includes('migrations-sem-confirmacao'));
  assert.equal(evaluateReleaseGate(state, { acknowledgeMigrations: true }).allowed, true);
});

test('recovery ativo bloqueia deploy inclusive com override', () => {
  const recovery = { active: true, failurePhase: 'SWAP_STARTED' };
  const result = evaluateReleaseGate(estadoLimpo({ recovery }), { override: true });
  assert.equal(result.allowed, false);
  assert.ok(codigos(result).includes('recovery-manual-required'));
  assert.equal(result.blockers.find((b) => b.code === 'recovery-manual-required').overridable, false);
});

test('le recovery sem expor campos fora do contrato operacional', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiver-recovery-'));
  const file = path.join(dir, 'deploy-recovery.json');
  fs.writeFileSync(file, JSON.stringify({
    active: true,
    failurePhase: 'MIGRATION_STARTED',
    failureReason: 'SQL falhou em postgresql://usuario:senha@host/banco',
    previousRelease: { gitSha: 'old1234' },
    candidateRelease: { gitSha: 'new5678' },
    migration: { started: true, completed: false },
    backfill: { started: false, completed: false },
    swap: { started: false, completed: false },
    watchdog: { paused: true },
    databaseUrl: 'postgres://nao-deve-sair',
  }));
  try {
    const recovery = readDeployRecovery(file);
    assert.equal(recovery.active, true);
    assert.equal(recovery.migration.started, true);
    assert.equal('databaseUrl' in recovery, false);
    assert.doesNotMatch(recovery.failureReason, /usuario:senha/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('override libera impedimentos overridable', () => {
  const state = estadoLimpo({ workingTreeDirty: true, dirtyCount: 5, headOnOriginMain: false });
  const result = evaluateReleaseGate(state, { override: true });
  assert.equal(result.allowed, true);
  assert.equal(result.overridden, true);
  assert.equal(result.blockers.length, 2, 'os impedimentos continuam visiveis para o audit');
});

test('override nao libera falta de git', () => {
  const result = evaluateReleaseGate({ gitAvailable: false }, { override: true });
  assert.equal(result.allowed, false);
  assert.equal(result.overridden, false);
});

test('override em estado limpo nao marca overridden', () => {
  const result = evaluateReleaseGate(estadoLimpo(), { override: true });
  assert.equal(result.allowed, true);
  assert.equal(result.overridden, false);
});

test('avisa quando nao ha commit novo', () => {
  const result = evaluateReleaseGate(estadoLimpo({ pending: [] }));
  assert.equal(result.allowed, true);
  assert.match(result.warnings.join(' '), /Nenhum commit novo/);
});

test('avisa quando o HEAD esta atras de origin/main', () => {
  const result = evaluateReleaseGate(estadoLimpo({ behindOriginMain: 3 }));
  assert.match(result.warnings.join(' '), /3 commit/);
});

test('avisa quando ha commit de agente', () => {
  const state = estadoLimpo({ pending: [{ sha: HEAD, shortSha: 'aaaaaaa', message: 'fix', fromAgent: true }] });
  assert.match(evaluateReleaseGate(state).warnings.join(' '), /agente automatico/);
});

test('summarizeChecks mantem a execucao mais recente de cada check', () => {
  const checks = summarizeChecks([
    { name: 'backend-test', status: 'completed', conclusion: 'failure', started_at: '2026-08-12T10:00:00Z' },
    { name: 'backend-test', status: 'completed', conclusion: 'success', started_at: '2026-08-12T11:00:00Z' },
    { name: 'frontend', status: 'completed', conclusion: 'success', started_at: '2026-08-12T10:00:00Z' },
  ]);
  assert.equal(checks.length, 2);
  assert.equal(checks.find((c) => c.name === 'backend-test').conclusion, 'success');
});

test('summarizeChecks tolera lista vazia ou ausente', () => {
  assert.deepEqual(summarizeChecks([]), []);
  assert.deepEqual(summarizeChecks(undefined), []);
});

test('checkVerdict cobre os estados do GitHub', () => {
  assert.equal(checkVerdict(undefined), 'ausente');
  assert.equal(checkVerdict({ status: 'queued' }), 'rodando');
  assert.equal(checkVerdict({ status: 'completed', conclusion: 'success' }), 'sucesso');
  assert.equal(checkVerdict({ status: 'completed', conclusion: 'timed_out' }), 'falhou');
  assert.equal(checkVerdict({ status: 'completed', conclusion: 'skipped' }), 'ignorado');
});

test('isAgentBranch reconhece so o padrao do fixer', () => {
  assert.equal(isAgentBranch('fix/auto-42'), true);
  assert.equal(isAgentBranch('fix/auto-manual'), false);
  assert.equal(isAgentBranch('feat/modo-quiosque'), false);
  assert.equal(isAgentBranch(undefined), false);
});

function estadoGit(overrides = {}) {
  return {
    gitAvailable: true,
    workingTreeDirty: false,
    originMain: { sha: HEAD },
    head: { sha: HEAD, branch: 'main' },
    headOnOriginMain: true,
    behindOriginMain: 0,
    aheadOriginMain: 0,
    ...overrides,
  };
}

test('shouldAutoSyncMain nao sincroniza quando main ja esta alinhada', () => {
  assert.equal(shouldAutoSyncMain(estadoGit()), false);
});

test('shouldAutoSyncMain sincroniza main atrasada', () => {
  assert.equal(shouldAutoSyncMain(estadoGit({ behindOriginMain: 1 })), true);
});

test('shouldAutoSyncMain sincroniza branch de feature apos merge', () => {
  assert.equal(shouldAutoSyncMain(estadoGit({
    head: { sha: 'b'.repeat(40), branch: 'feat/x' },
    headOnOriginMain: false,
  })), true);
});

test('shouldAutoSyncMain nao sincroniza com working tree suja', () => {
  assert.equal(shouldAutoSyncMain(estadoGit({ workingTreeDirty: true, behindOriginMain: 2 })), false);
});

test('shouldAutoSyncMain nao sincroniza main a frente do remoto', () => {
  assert.equal(shouldAutoSyncMain(estadoGit({ aheadOriginMain: 1 })), false);
});

test('shouldAutoSyncMain nao sincroniza sem origin/main', () => {
  assert.equal(shouldAutoSyncMain(estadoGit({ originMain: { sha: null } })), false);
});
