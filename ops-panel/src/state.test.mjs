import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveState, isMergeReady } from './state.mjs';

const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-26T18:00:00Z');

function snap({ git = {}, prs = [], runs = [], dev = {}, prd = {} } = {}) {
  return {
    at: new Date(NOW).toISOString(),
    git: {
      ok: true,
      data: {
        branch: 'main', headSha: MAIN, dirtyCount: 0, ahead: 0, behind: 0,
        mainSha: MAIN, mainSubject: 'feat: x', mainDate: '2026-10-26T17:00:00Z',
        recentMain: [{ sha: MAIN, date: '2026-10-26T17:00:00Z', subject: 'feat: x' }, { sha: OLD, date: '2026-10-25T10:00:00Z', subject: 'old' }],
        ...git,
      },
    },
    github: { ok: true, data: { prs, runs } },
    dev: {
      ok: true,
      data: {
        dockerOk: true, dockerError: null,
        containers: [{ name: 'cervejaria-db-dev', status: 'Up', ok: true }, { name: 'elasticsearch', status: 'Up', ok: true }],
        apiReady: true, webOk: true, releaseSha: MAIN, supervisorAlive: true,
        ...dev,
      },
    },
    prd: {
      ok: true,
      data: { url: 'https://tap', healthOk: true, readyOk: true, readyStatus: 200, latencyMs: 100, releaseSha: MAIN, vps: { configured: false }, ...prd },
    },
  };
}

const run = (over) => ({ id: 1, sha: MAIN, status: 'completed', conclusion: 'success', url: 'https://run/1', ...over });
const pr = (over) => ({ number: 7, title: 'PR', url: 'https://pr/7', branch: 'feat/x', baseBranch: 'main', isDraft: false, mergeable: 'MERGEABLE', ci: 'success', ...over });
const stepStatus = (state) => Object.fromEntries(state.delivery.steps.map((s) => [s.id, s.status]));

test('em dia: PRD = main, tudo verde, sem próxima ação', () => {
  const s = deriveState(snap(), NOW);
  assert.equal(s.delivery.state, 'em_dia');
  assert.equal(s.verdict.level, 'ok');
  assert.equal(s.next, null);
  assert.ok(Object.values(stepStatus(s)).every((v) => v === 'done'));
});

test('local: branch com alterações e sem PR', () => {
  const s = deriveState(snap({ git: { branch: 'feat/x', dirtyCount: 3 } }), NOW);
  assert.equal(s.delivery.state, 'local');
  assert.equal(stepStatus(s).local, 'active');
  assert.equal(s.cards.git.state, 'alteracoes');
});

test('git: branch com commits e sem PR', () => {
  const s = deriveState(snap({ git: { branch: 'feat/x', ahead: 2 } }), NOW);
  assert.equal(s.cards.git.state, 'sem_pr');
});

test('pr: CI verde e mergeável sugere Mergear', () => {
  const s = deriveState(snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [pr()] }), NOW);
  assert.equal(s.delivery.state, 'pr');
  assert.equal(stepStatus(s).pr, 'active');
  assert.equal(s.next.name, 'pr.merge');
  assert.deepEqual(s.next.params, { number: 7 });
  assert.equal(s.cards.git.prs[0].action.name, 'pr.merge');
});

test('pr com CI rodando não oferece merge', () => {
  const s = deriveState(snap({ git: { branch: 'feat/x' }, prs: [pr({ ci: 'pending' })] }), NOW);
  assert.equal(s.delivery.state, 'pr');
  assert.equal(s.next, null);
  assert.equal(s.cards.git.prs[0].action, null);
});

test('falhou no PR: CI vermelho', () => {
  const s = deriveState(snap({ git: { branch: 'feat/x' }, prs: [pr({ ci: 'failure' })] }), NOW);
  assert.equal(s.delivery.state, 'falhou');
  assert.equal(stepStatus(s).pr, 'error');
  assert.equal(s.verdict.level, 'bad');
  assert.equal(s.next.href, 'https://pr/7');
});

test('main: merge recente sem run ainda', () => {
  const s = deriveState(snap({ git: { mainDate: new Date(NOW - 60_000).toISOString() }, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'main');
  assert.equal(s.verdict.level, 'run');
});

test('main: run em CI/build', () => {
  const runs = [run({ status: 'in_progress', conclusion: null, jobs: [{ name: 'ci / build-and-unit', status: 'in_progress' }] })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'main');
  assert.equal(stepStatus(s).main, 'active');
  assert.equal(s.cards.pipeline.state, 'rodando');
});

test('aguardando: deploy pendente sugere aprovar', () => {
  const runs = [run({ status: 'waiting', conclusion: null, pending: [{ environmentId: 9 }] })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'aguardando');
  assert.equal(stepStatus(s).aguardando, 'active');
  assert.equal(s.next.name, 'deploy.approve');
  assert.equal(s.next.confirm, 'deploy');
  assert.deepEqual(s.cards.pipeline.actions.map((a) => a.name), ['deploy.approve', 'deploy.reject']);
});

test('publicando: job deploy-prd rodando', () => {
  const runs = [run({ status: 'in_progress', conclusion: null, jobs: [{ name: 'deploy-prd', status: 'in_progress' }] })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'publicando');
  assert.equal(stepStatus(s).prd, 'active');
});

test('falhou no deploy', () => {
  const runs = [run({ conclusion: 'failure' })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'falhou');
  assert.equal(stepStatus(s).prd, 'error');
  assert.equal(s.next.href, 'https://run/1');
  assert.equal(s.cards.pipeline.state, 'falhou');
});

test('atrasada: run rejeitado/cancelado sugere publicar main', () => {
  const runs = [run({ conclusion: 'cancelled' })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'atrasada');
  assert.equal(stepStatus(s).aguardando, 'warn');
  assert.equal(s.next.name, 'deploy.dispatch');
  assert.equal(s.verdict.level, 'warn');
});

test('atrasada: sem run para a main há mais de 3 min', () => {
  const s = deriveState(snap({ prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'atrasada');
});

test('desconhecido: produção sem releaseSha', () => {
  const s = deriveState(snap({ prd: { releaseSha: null, healthOk: false } }), NOW);
  assert.equal(s.delivery.state, 'desconhecido');
  assert.equal(s.cards.prd.state, 'fora');
  assert.equal(s.verdict.level, 'bad');
  assert.equal(s.next.href, 'https://tap');
});

test('prd degradado: ready falhando', () => {
  const s = deriveState(snap({ prd: { readyOk: false, readyStatus: 503 } }), NOW);
  assert.equal(s.cards.prd.state, 'degradado');
  assert.equal(s.verdict.level, 'bad');
});

test('prd atenção via VPS: backup velho e disco cheio', () => {
  const nowS = NOW / 1000;
  const vps = { configured: true, ok: true, data: { now: nowS, disk_pct: 91, api: { status: 'running', health: 'healthy' }, db: { status: 'exited' }, backup: { mtime: nowS - 30 * 3600 }, deploys: [] } };
  const s = deriveState(snap({ prd: { vps } }), NOW);
  assert.equal(s.cards.prd.state, 'degradado');
  assert.equal(s.cards.prd.level, 'warn');
  assert.match(s.cards.prd.title, /disco 91%/);
  assert.match(s.cards.prd.title, /backup atrasado/);
  assert.match(s.cards.prd.title, /banco exited/);
});

test('dev parado sugere ligar', () => {
  const s = deriveState(snap({ dev: { apiReady: false, webOk: false, supervisorAlive: false } }), NOW);
  assert.equal(s.cards.dev.state, 'parado');
  assert.equal(s.next.name, 'dev.start');
  assert.deepEqual(s.cards.dev.actions.map((a) => a.name), ['dev.start']);
});

test('dev subindo', () => {
  const s = deriveState(snap({ dev: { apiReady: false, webOk: true, supervisorAlive: true } }), NOW);
  assert.equal(s.cards.dev.state, 'subindo');
});

test('dev degradado: Docker parado', () => {
  const s = deriveState(snap({ dev: { dockerOk: false, dockerError: 'daemon fora' } }), NOW);
  assert.equal(s.cards.dev.state, 'degradado');
  assert.equal(s.verdict.level, 'bad');
});

test('dev em outra versão vira informação, não ação', () => {
  const s = deriveState(snap({ dev: { releaseSha: OLD } }), NOW);
  assert.equal(s.cards.dev.behindMain, true);
  assert.equal(s.next.info, true);
});

test('coletor indisponível não derruba o estado', () => {
  const base = snap();
  base.github = { ok: false, error: 'gh: não autenticado' };
  const s = deriveState(base, NOW);
  assert.equal(s.cards.pipeline.state, 'indisponivel');
  assert.equal(s.cards.git.prs.length, 0);
});

test('isMergeReady exige CI verde, mergeável, não draft e base main', () => {
  assert.equal(isMergeReady(pr()), true);
  assert.equal(isMergeReady(pr({ isDraft: true })), false);
  assert.equal(isMergeReady(pr({ mergeable: 'CONFLICTING' })), false);
  assert.equal(isMergeReady(pr({ baseBranch: 'develop' })), false);
  assert.equal(isMergeReady(pr({ ci: 'pending' })), false);
  assert.equal(isMergeReady(pr({ state: 'MERGED' })), false);
});

test('rollback: recentMain marca o commit em PRD', () => {
  const s = deriveState(snap({ prd: { releaseSha: OLD } }), NOW);
  assert.deepEqual(s.recentMain.map((c) => c.isPrd), [false, true]);
});
