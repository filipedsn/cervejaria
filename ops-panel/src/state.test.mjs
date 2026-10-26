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

test('publicando: logo depois de autorizar (deploy-prd na fila) a barra não volta para Testes', () => {
  const done = (name) => ({ name, status: 'completed', conclusion: 'success' });
  const jobs = (deploy) => [done('resolve-sha'), done('ci / build-and-unit'), done('docker-build-sha'), { name: 'deploy-prd', ...deploy }];
  for (const deploy of [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }]) {
    const runs = [run({ status: 'in_progress', conclusion: null, jobs: jobs(deploy) })];
    const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
    assert.equal(s.delivery.state, 'publicando', deploy.status);
    assert.deepEqual(stepStatus(s), { local: 'done', pr: 'done', main: 'done', aguardando: 'done', prd: 'active' });
    const detail = Object.fromEntries(s.delivery.steps.map((step) => [step.id, step.detail]));
    assert.equal(detail.aguardando, 'autorizada');
    assert.match(detail.prd, /^publicando /);
    assert.match(s.cards.pipeline.title, /^Publicando /);
  }
});

test('main: deploy-prd na fila enquanto testes e montagem ainda rodam continua em Testes', () => {
  const runs = [
    run({
      status: 'in_progress',
      conclusion: null,
      jobs: [{ name: 'ci / build-and-unit', status: 'in_progress' }, { name: 'deploy-prd', status: 'queued' }],
    }),
  ];
  const s = deriveState(snap({ runs, prd: { releaseSha: OLD } }), NOW);
  assert.equal(s.delivery.state, 'main');
  assert.equal(stepStatus(s).main, 'active');
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

test('dev atrás do site: compara, lista o que falta e oferece igualar ao site', () => {
  const compare = { prdOnly: [{ sha: MAIN, subject: 'feat: x' }], devOnly: [] };
  const s = deriveState(withVersions(snap({ dev: { releaseSha: OLD } }), compare), NOW);
  const dev = s.cards.dev;
  assert.equal(dev.title, 'Ligado · V854');
  const facts = Object.fromEntries(dev.facts);
  assert.equal(facts['Versão'], 'V854 (bbbbbbb)');
  assert.equal(facts['Comparado ao site'], '1 versão atrás do site');
  assert.equal(dev.compare.prdOnly[0].version, 'V855');
  assert.equal(dev.actions[0].name, 'dev.matchPrd');
  assert.equal(dev.actions[0].confirm, 'match-prd');
  assert.match(dev.actions[0].label, /V855/);
  assert.ok(!dev.actions.some((a) => a.name === 'dev.sync'), 'site já na oficial: um botão basta');
  assert.match(s.next.label, /Igualar ao site/);
});

test('oficial mais nova que o site: oferece igualar ao site e trazer a oficial', () => {
  const s = deriveState(withVersions(snap({ dev: { releaseSha: OLD }, prd: { releaseSha: OLD } })), NOW);
  assert.deepEqual(s.cards.dev.actions.slice(0, 1).map((a) => a.name), ['dev.sync']);
  const onMain = deriveState(withVersions(snap({ prd: { releaseSha: OLD } })), NOW).cards.dev;
  assert.equal(onMain.actions[0].name, 'dev.matchPrd');
  assert.match(onMain.actions[0].label, /V854/);
  assert.ok(!onMain.actions.some((a) => a.name === 'dev.sync'));
});

test('trocar a versão do DEV troca a pasta do projeto: só sem alterações não salvas', () => {
  const dev = (git) => deriveState(withVersions(snap({ git, dev: { releaseSha: OLD } })), NOW).cards.dev;
  const branch = dev({ branch: 'feat/x' });
  assert.equal(branch.canMatchPrd, true, 'branch limpa pode trocar');
  assert.equal(Object.fromEntries(branch.facts)['Código em teste'], 'pasta de trabalho feat/x');
  assert.equal(dev({ dirtyCount: 3 }).canMatchPrd, true, 'arquivos novos não versionados não bloqueiam');
  const dirty = dev({ branch: 'feat/x', trackedDirty: 2, dirtyCount: 2 });
  assert.equal(dirty.canMatchPrd, false);
  assert.ok(!dirty.actions.some((a) => a.name === 'dev.matchPrd' || a.name === 'dev.sync'));
  assert.match(Object.fromEntries(dirty.facts)['Igualar ao site'], /salve \(commit\)/);
  const s = deriveState(withVersions(snap({ git: { branch: 'feat/x', ahead: 1 }, dev: { releaseSha: OLD } })), NOW);
  assert.match(s.next.label, /pasta de trabalho feat\/x.*normal/);
});

test('PR em teste no DEV: pasta fixada no PR, cartão mostra o PR e o topo explica como voltar', () => {
  const head = 'c'.repeat(40);
  const code = { sha: head, kind: 'pr', pr: 141, at: '2026-10-26T17:00:00Z' };
  const git = { branch: 'HEAD', headSha: head, ahead: 1 };
  const s = deriveState(snap({ git, dev: { releaseSha: head, code } }), NOW);
  assert.equal(s.cards.dev.title, 'Ligado · PR #141');
  assert.equal(Object.fromEntries(s.cards.dev.facts)['Código em teste'], 'PR #141, ainda não aceito');
  assert.equal(s.cards.dev.actions[0].name, 'dev.matchPrd');
  assert.match(s.next.label, /PR #141.*Igualar ao site/);
  assert.match(Object.fromEntries(s.cards.git.facts)['Pasta de trabalho (branch)'], /^versão fixa cccc/);
  assert.notEqual(s.cards.git.state, 'sem_pr', 'pasta fixada não é trabalho sem PR');
  const stale = deriveState(snap({ dev: { releaseSha: MAIN, code } }), NOW).cards.dev;
  assert.equal(stale.testingPr, null, 'marcador de outra versão é ignorado');
});

test('pasta fixada na versão de um PR aberto acha o PR pela versão', () => {
  const head = 'c'.repeat(40);
  const open = pr({ number: 141, branch: 'feat/y', headSha: head, touchesApp: true });
  const s = deriveState(snap({ git: { branch: 'HEAD', headSha: head, ahead: 1 }, prs: [open], dev: { releaseSha: head } }), NOW);
  assert.equal(s.delivery.state, 'pr');
  assert.equal(s.next.name, 'pr.merge', 'já está no ambiente de testes: a próxima é aceitar');
});

test('PR pronto que mexe no sistema: testar no DEV antes de aceitar', () => {
  const head = 'c'.repeat(40);
  const ready = pr({ number: 141, headSha: head, touchesApp: true });
  const s = deriveState(snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [ready] }), NOW);
  assert.equal(s.next.name, 'dev.testPr');
  assert.equal(s.next.confirm, 'test-pr');
  assert.deepEqual(s.next.params, { number: 141 });
  const row = s.cards.git.prs[0];
  assert.equal(row.testAction.name, 'dev.testPr');
  assert.equal(row.action.name, 'pr.merge', 'Aceitar continua disponível para quem não quer testar');

  const code = { sha: head, kind: 'pr', pr: 141 };
  const tested = deriveState(snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [ready], dev: { releaseSha: head, code } }), NOW);
  assert.equal(tested.next.name, 'pr.merge');
  assert.match(tested.verdict.text, /está no ambiente de testes/);
  assert.equal(tested.cards.git.prs[0].inDev, true);
  assert.equal(tested.cards.git.prs[0].testAction, null);

  const dirty = deriveState(snap({ git: { branch: 'feat/x', ahead: 1, trackedDirty: 1, dirtyCount: 1 }, prs: [ready] }), NOW);
  assert.equal(dirty.next.name, 'pr.merge', 'com alterações não salvas a pasta não pode trocar de versão');
  assert.equal(dirty.cards.git.prs[0].testAction, null);
});

test('PR que não mexe no sistema (painel, docs) vai direto para Aceitar', () => {
  const docs = pr({ number: 142, headSha: 'c'.repeat(40), touchesApp: false });
  const s = deriveState(snap({ git: { branch: 'feat/x', ahead: 1 }, prs: [docs] }), NOW);
  assert.equal(s.next.name, 'pr.merge');
  assert.equal(s.cards.git.prs[0].testAction, null);
  const pending = pr({ headSha: 'c'.repeat(40), touchesApp: true, ci: 'pending' });
  assert.equal(deriveState(snap({ prs: [pending] }), NOW).cards.git.prs[0].testAction, null, 'só PR com testes verdes');
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
