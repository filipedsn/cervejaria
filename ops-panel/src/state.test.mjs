import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMoving } from './snapshot.mjs';
import { compareWithSite, deriveState, isMergeReady, needsUpdate } from './state.mjs';

const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-26T18:00:00Z');

function snap({ git = {}, prs = [], runs = [], dev = {}, prd = {} } = {}) {
  return {
    at: new Date(NOW).toISOString(),
    git: {
      ok: true,
      data: {
        branch: 'main', headSha: MAIN, dirtyCount: 0, trackedDirty: 0, ahead: 0, behind: 0,
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

test('PR recém-criado (CI ainda não registrado) aparece como preparando, não bloqueado', () => {
  const fresh = pr({ ci: 'none', mergeable: 'UNKNOWN' });
  const s = deriveState(snap({ git: { branch: 'feat/x' }, prs: [fresh] }), NOW);
  assert.equal(s.verdict.level, 'run');
  assert.match(s.verdict.text, /preparando/);
  assert.equal(isMoving(snap({ prs: [fresh] }), NOW), true);
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
  assert.match(s.cards.prd.title, /banco de dados parado/);
  assert.equal(s.cards.prd.infra, null, 'relatório antigo: sem medidores, continua em texto');
  assert.ok(s.cards.prd.facts.some(([k]) => k === 'Banco de dados'));
});

test('prd com infraestrutura: blocos visuais e contêiner com problema no título', () => {
  const nowS = NOW / 1000;
  const containers = [
    { name: 'cervejaria-api', status: 'running', health: 'healthy', started: '2026-10-26T17:00:00Z', cpu: '0.4%', mem: '100MiB / 15GiB', net: '0B / 0B' },
    { name: 'cervejaria-db', status: 'running', health: 'unhealthy', started: '2026-10-24T17:00:00Z', cpu: '0%', mem: '70MiB / 15GiB', net: '1MB / 2MB' },
  ];
  const host = { cpus: 4, cpu_pct: 3, load: [0.1, 0.1, 0.1], mem_total: 16e9, mem_avail: 12e9, disk_total: 200e9, disk_used: 20e9, uptime_s: 90_000 };
  const vps = { configured: true, ok: true, data: { now: nowS, disk_pct: 10, host, containers, api: { status: 'running', health: 'healthy' }, db: { status: 'running', health: 'unhealthy' }, backup: { mtime: nowS - 3600 }, deploys: [] } };
  const s = deriveState(snap({ prd: { vps, vpsHistory: [{ t: nowS - 60, cpu: 2, mem: 24 }, { t: nowS, cpu: 3, mem: 25 }] } }), NOW);
  const card = s.cards.prd;
  assert.equal(card.level, 'warn');
  assert.equal(card.title, 'Atenção: Banco de dados com problema');
  assert.deepEqual(card.facts, []);
  assert.deepEqual(card.tiles.map((t) => t.label), ['Versão no ar', 'Resposta do site', 'Último backup', 'Servidor ligado há']);
  assert.equal(card.tiles[3].value, '25 h');
  assert.deepEqual(card.infra.gauges[0].series, [2, 3]);
  assert.equal(card.infra.containers.length, 2);
});

test('toda situação traz explicação e cada cartão tem subtítulo', () => {
  const cases = [
    snap(),
    snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [pr()] }),
    snap({ runs: [run({ status: 'waiting', conclusion: null })], prd: { releaseSha: OLD } }),
    snap({ runs: [run({ conclusion: 'failure' })], prd: { releaseSha: OLD } }),
    snap({ dev: { apiReady: false, webOk: false, supervisorAlive: false } }),
  ];
  for (const c of cases) {
    const s = deriveState(c, NOW);
    assert.ok(s.verdict.help.length > 20, s.verdict.text);
    assert.ok(s.delivery.activeHint.length > 0, s.delivery.state);
    for (const card of Object.values(s.cards)) assert.ok(card.subtitle, card.title);
  }
});

test('dev parado sugere ligar', () => {
  const s = deriveState(snap({ dev: { apiReady: false, webOk: false, supervisorAlive: false } }), NOW);
  assert.equal(s.cards.dev.state, 'parado');
  assert.equal(s.next.name, 'dev.start');
  assert.deepEqual(s.cards.dev.actions.map((a) => a.name), ['dev.start', 'dev.copyPrd']);
});

test('copiar o banco do site: só com o banco de testes ligado; cartão mostra a origem dos dados', () => {
  const s = deriveState(snap({ dev: { prdCopy: { at: '2026-10-26T15:00:00Z', tables: 54, rows: 1 } } }), NOW);
  assert.ok(s.cards.dev.actions.some((a) => a.name === 'dev.copyPrd' && a.confirm === 'copy'));
  assert.equal(Object.fromEntries(s.cards.dev.facts)['Dados do banco'], 'cópia do site, há 3 horas');
  assert.equal(Object.fromEntries(deriveState(snap(), NOW).cards.dev.facts)['Dados do banco'], 'dados próprios de teste');
  const dbDown = snap({ dev: { containers: [{ name: 'cervejaria-db-dev', status: null, ok: false }] } });
  assert.ok(!deriveState(dbDown, NOW).cards.dev.actions.some((a) => a.name === 'dev.copyPrd'));
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

const withVersions = (base, compare = null) => ({ ...base, versions: { [MAIN]: 855, [OLD]: 854 }, compare });

test('versões viram V<n> com o código técnico ao lado', () => {
  const s = deriveState(withVersions(snap()), NOW);
  assert.equal(s.delivery.mainVersion, 'V855');
  const prdFacts = Object.fromEntries(s.cards.prd.facts);
  assert.match(prdFacts['Versão no ar'], /^V855 \(aaaaaaa\)/);
  assert.equal(s.recentMain[1].version, 'V854');
});

test('sem número de versão, cai no código técnico', () => {
  const s = deriveState(snap(), NOW);
  assert.equal(s.delivery.mainVersion, 'aaaaaaa');
});

test('dev atrás do site: compara, lista o que falta e oferece trazer a oficial', () => {
  const compare = { prdOnly: [{ sha: MAIN, subject: 'feat: x' }], devOnly: [] };
  const s = deriveState(withVersions(snap({ dev: { releaseSha: OLD } }), compare), NOW);
  const dev = s.cards.dev;
  assert.equal(dev.title, 'Ligado · V854');
  const facts = Object.fromEntries(dev.facts);
  assert.equal(facts['Versão'], 'V854 (bbbbbbb)');
  assert.equal(facts['Comparado ao site'], '1 versão atrás do site');
  assert.equal(dev.compare.prdOnly[0].version, 'V855');
  assert.equal(dev.canSync, true);
  assert.equal(dev.actions[0].name, 'dev.sync');
  assert.match(dev.actions[0].label, /V855/);
  assert.match(s.next.label, /Trazer a versão oficial/);
});

test('trazer a oficial só com o PC na main e sem alterações versionadas', () => {
  const sync = (git) => deriveState(withVersions(snap({ git, dev: { releaseSha: OLD } })), NOW).cards.dev;
  assert.equal(sync({ trackedDirty: 2, dirtyCount: 2 }).canSync, false);
  assert.equal(sync({ branch: 'feat/x' }).canSync, false);
  assert.equal(sync({ dirtyCount: 3 }).canSync, true, 'arquivos novos não versionados não bloqueiam');
  assert.ok(!sync({ branch: 'feat/x' }).actions.some((a) => a.name === 'dev.sync'));
});

test('compareWithSite: igual, atrás, à frente e versão de trabalho', () => {
  deriveState(withVersions(snap()), NOW);
  assert.equal(compareWithSite(MAIN, MAIN, null).text, 'igual ao site');
  assert.equal(compareWithSite(OLD, MAIN, null).text, '1 versão atrás do site');
  assert.equal(compareWithSite(MAIN, OLD, null).text, '1 versão à frente do site');
  const branch = 'c'.repeat(40);
  const out = compareWithSite(branch, MAIN, { devOnly: [{ sha: branch, subject: 'wip' }, { sha: 'd'.repeat(40), subject: 'x' }], prdOnly: [] });
  assert.equal(out.text, '2 mudanças em teste que não estão no site');
  assert.equal(out.lists.devOnly[0].version, 'ccccccc');
});

test('cartão Código: cópia atrasada é informação, trabalho local é andamento', () => {
  assert.equal(deriveState(snap({ git: { behind: 3 } }), NOW).cards.git.level, 'off');
  assert.equal(deriveState(snap({ git: { behind: 3, dirtyCount: 1 } }), NOW).cards.git.state, 'alteracoes');
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

test('PR atrasado em relação à main pede Atualizar, não Aceitar', () => {
  const behind = pr({ mergeState: 'BEHIND' });
  assert.equal(isMergeReady(behind), false);
  assert.equal(needsUpdate(behind), true);
  const s = deriveState(snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [behind] }), NOW);
  assert.equal(s.cards.git.prs[0].action.name, 'pr.update');
  assert.equal(s.next.name, 'pr.update');
  assert.equal(s.verdict.level, 'warn');
});

test('PR pronto de outra pasta vira a próxima ação quando o site está em dia', () => {
  const s = deriveState(snap({ prs: [pr({ number: 128, branch: 'docs/y' })] }), NOW);
  assert.equal(s.delivery.state, 'em_dia');
  assert.equal(s.next.name, 'pr.merge');
  assert.deepEqual(s.next.params, { number: 128 });
  assert.match(s.verdict.text, /#128/);
});

test('publicação recusada não é falha: versão fica pendente', () => {
  const runs = [run({ conclusion: 'failure', rejected: true })];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'atrasada');
  assert.equal(s.cards.pipeline.state, 'ociosa');
  assert.equal(s.cards.pipeline.runs[0].label, 'você não autorizou');
  assert.equal(s.flow.columns[2][0].status, 'skipped');
});

test('gráfico da esteira: colunas, progresso e duração', () => {
  const t = (sec) => new Date(NOW - sec * 1000).toISOString();
  const jobs = [
    { name: 'resolve-sha', status: 'completed', conclusion: 'success', startedAt: t(100), completedAt: t(95), steps: [] },
    { name: 'ci / build-and-unit', status: 'in_progress', conclusion: null, startedAt: t(90), completedAt: null,
      steps: [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }, { status: 'queued' }] },
    { name: 'docker-build-sha', status: 'completed', conclusion: 'success', startedAt: t(90), completedAt: t(20), steps: [] },
  ];
  const s = deriveState(snap({ runs: [run({ status: 'in_progress', conclusion: null, createdAt: t(105), jobs })], prd: { releaseSha: OLD } }), NOW);
  const [[prep], [tests, build], [deploy]] = s.flow.columns;
  assert.equal(s.flow.live, true);
  assert.equal(prep.status, 'done');
  assert.equal(prep.time, '5s');
  assert.equal(tests.status, 'running');
  assert.deepEqual(tests.progress, { done: 2, total: 4 });
  assert.equal(tests.time, '1m 30s');
  assert.equal(build.time, '1m 10s');
  assert.equal(deploy.status, 'todo');
});

test('gráfico da esteira: run esperando autorização marca a publicação', () => {
  const s = deriveState(snap({ runs: [run({ status: 'waiting', conclusion: null, jobs: [] })], prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.flow.columns[2][0].status, 'waiting');
  assert.equal(s.flow.level, 'warn');
});

test('isMoving: acelera só quando algo anda sozinho', () => {
  const base = snap();
  assert.equal(isMoving(base, NOW), false);
  assert.equal(isMoving(snap({ runs: [run({ status: 'in_progress', conclusion: null })] }), NOW), true);
  assert.equal(isMoving(snap({ runs: [run({ status: 'waiting', conclusion: null })] }), NOW), false);
  assert.equal(isMoving(snap({ prs: [pr({ ci: 'pending' })] }), NOW), true);
  assert.equal(isMoving(snap({ git: { mainDate: new Date(NOW - 60_000).toISOString() }, prd: { releaseSha: OLD } }), NOW), true);
});

test('rollback: recentMain marca o commit em PRD', () => {
  const s = deriveState(snap({ prd: { releaseSha: OLD } }), NOW);
  assert.deepEqual(s.recentMain.map((c) => c.isPrd), [false, true]);
});
