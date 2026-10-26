/**
 * Máquina de estados do painel. Função pura: snapshot dos coletores → o que a tela mostra.
 *
 * Entrega (HEAD da main):
 *   local → pr → main (CI + build) → aguardando (aprovação) → publicando → em_dia
 *   desvios: falhou (CI do PR ou deploy), atrasada (PRD atrás da main sem run ativo).
 * Ambientes: git, dev, pipeline (esteira), prd — cada um com { state, level, title, subtitle, facts, actions }.
 * level: ok | run | warn | bad | off.
 *
 * Os textos são para quem não é da área: nada de jargão sem explicação.
 */

import { infraView } from './infra.mjs';

export const STEPS = [
  {
    id: 'local',
    label: 'No computador',
    hint: 'Alguém está mexendo no código neste PC. Nada disso aparece para os clientes ainda.',
  },
  {
    id: 'pr',
    label: 'Em revisão (PR)',
    hint: 'A mudança foi enviada ao GitHub como um pedido de mudança (PR) e os testes automáticos conferem se nada quebrou. Com os testes ok, você aceita a mudança.',
  },
  {
    id: 'main',
    label: 'Testes e montagem',
    hint: 'A mudança entrou na versão oficial. A esteira testa tudo de novo e monta a nova versão (cerca de 2 minutos).',
  },
  {
    id: 'aguardando',
    label: 'Sua autorização',
    hint: 'A esteira parou e espera você autorizar a publicação. Nada chega aos clientes sem esse clique.',
  },
  {
    id: 'prd',
    label: 'No ar para clientes',
    hint: 'Os clientes usam esta versão em tap.quivercloud.com.br.',
  },
];

const MAIN_JUST_MERGED_MS = 3 * 60_000;
const BACKUP_MAX_AGE_H = 26;
const DISK_WARN_PCT = 85;

export const short = (sha) => (sha ? String(sha).slice(0, 7) : '—');

// Números de versão do snapshot atual ({ sha: 855 }); definido no início de deriveState.
let versionNumbers = {};
const num = (sha) => (sha ? (versionNumbers[sha] ?? null) : null);
/** "V855"; commit fora da main fica com o hash curto. */
export const ver = (sha) => (num(sha) ? `V${num(sha)}` : short(sha));
/** "V855 (89e7d42)" — o hash entre parênteses aparece pequeno na tela. */
const verFull = (sha) => (num(sha) ? `V${num(sha)} (${short(sha)})` : short(sha));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const prOpenOk = (pr) =>
  Boolean(pr && !pr.isDraft && pr.baseBranch === 'main' && pr.mergeable === 'MERGEABLE' && (pr.state === undefined || pr.state === 'OPEN'));

/** A main exige PR atualizado (strict): BEHIND não pode ser aceito. */
export function isMergeReady(pr) {
  return prOpenOk(pr) && pr.ci === 'success' && pr.mergeState !== 'BEHIND';
}

/** Feito sobre uma main antiga: precisa trazer as últimas mudanças (os testes rodam de novo). */
export function needsUpdate(pr) {
  return prOpenOk(pr) && pr.mergeState === 'BEHIND' && pr.ci !== 'failure';
}

/** Recém-criado/atualizado: o GitHub ainda não registrou o CI ou não calculou o merge. */
export function prWarmingUp(pr) {
  return Boolean(pr && !pr.isDraft && pr.baseBranch === 'main' && (pr.ci === 'none' || pr.mergeable === 'UNKNOWN'));
}

function prAction(pr) {
  if (isMergeReady(pr)) return { name: 'pr.merge', label: 'Aceitar', params: { number: pr.number }, confirm: 'merge' };
  if (needsUpdate(pr)) return { name: 'pr.update', label: 'Atualizar', params: { number: pr.number }, confirm: 'simple' };
  return null;
}

const unavailable = (title, error) => ({
  state: 'indisponivel',
  level: 'off',
  title: `${title}: sem informação`,
  subtitle: 'Não foi possível ler esta parte agora. Clique em Recarregar no topo; se continuar, chame quem desenvolve.',
  facts: [['Erro', error || 'sem resposta']],
  actions: [],
});

/**
 * Publicação autorizada e em curso: o job deploy-prd já saiu da espera (na fila, rodando
 * ou recém-concluído) e os jobs de teste e montagem terminaram.
 */
function deployJobStarted(run) {
  const jobs = run?.jobs ?? [];
  const deploy = jobs.find((j) => j.name === 'deploy-prd');
  if (!deploy || deploy.status === 'waiting') return false;
  return deploy.status === 'in_progress' || jobs.every((j) => j === deploy || j.status === 'completed');
}

const ciLabel = (ci) =>
  ({ success: 'testes ok', failure: 'testes falharam', pending: 'testando…', none: 'sem testes' })[ci] ?? ci;

function runLabel(run) {
  if (run.status !== 'completed') return run.status === 'waiting' ? 'esperando sua autorização' : 'em andamento';
  if (run.rejected) return 'você não autorizou';
  return { success: 'concluída', failure: 'falhou', cancelled: 'cancelada', skipped: 'pulada' }[run.conclusion] ?? run.conclusion;
}

const runFailed = (run) => run?.status === 'completed' && run.conclusion === 'failure' && !run.rejected;

const CONTAINER_TEXT = {
  running: 'rodando',
  healthy: 'saudável',
  unhealthy: 'com problema',
  starting: 'iniciando',
  exited: 'parado',
  restarting: 'reiniciando',
};
const containerText = (...values) => values.filter(Boolean).map((v) => CONTAINER_TEXT[v] ?? v).join(', ') || '—';

const DEV_CONTAINER_NAMES = { 'cervejaria-db-dev': 'Banco de dados', elasticsearch: 'Logs (Elasticsearch)' };

export function deriveDelivery(snapshot, now = Date.now()) {
  const git = snapshot.git?.ok ? snapshot.git.data : null;
  const gh = snapshot.github?.ok ? snapshot.github.data : null;
  const prd = snapshot.prd?.ok ? snapshot.prd.data : null;
  const mainSha = git?.mainSha ?? null;
  const prdSha = prd?.releaseSha ?? null;
  const runs = gh?.runs ?? [];
  const prs = gh?.prs ?? [];
  const branchPr = git && git.branch !== 'main' ? prs.find((p) => p.branch === git.branch) : null;

  let state;
  let run = null;
  if (!mainSha || !prdSha) {
    state = 'desconhecido';
  } else if (prdSha !== mainSha) {
    run = runs.find((r) => r.sha === mainSha) ?? null;
    if (!run) {
      const age = git.mainDate ? now - Date.parse(git.mainDate) : Infinity;
      state = age < MAIN_JUST_MERGED_MS ? 'main' : 'atrasada';
    } else if (run.status === 'waiting') {
      state = 'aguardando';
    } else if (run.status !== 'completed') {
      state = deployJobStarted(run) ? 'publicando' : 'main';
    } else if (runFailed(run)) {
      state = 'falhou';
    } else {
      state = 'atrasada';
    }
  } else if (branchPr && branchPr.ci === 'failure') {
    state = 'falhou';
  } else if (branchPr) {
    state = 'pr';
  } else if (git.branch !== 'main' || git.dirtyCount > 0 || git.ahead > 0) {
    state = 'local';
  } else {
    state = 'em_dia';
  }

  const failedAt = state === 'falhou' ? (branchPr && prdSha === mainSha ? 'pr' : 'prd') : null;
  const activeId = {
    local: 'local',
    pr: 'pr',
    main: 'main',
    aguardando: 'aguardando',
    atrasada: 'aguardando',
    publicando: 'prd',
    falhou: failedAt,
    em_dia: null,
    desconhecido: null,
  }[state];
  const activeIndex = activeId ? STEPS.findIndex((s) => s.id === activeId) : STEPS.length;

  const detail = {
    local: git
      ? git.dirtyCount
        ? plural(git.dirtyCount, 'arquivo alterado', 'arquivos alterados')
        : git.branch === 'main'
          ? 'nada em andamento'
          : `pasta ${git.branch}`
      : '—',
    pr: branchPr ? `PR #${branchPr.number}, ${ciLabel(branchPr.ci)}` : prs.length ? `${prs.length} PR(s) aberto(s)` : 'nenhum PR',
    main: mainSha ? `versão ${ver(mainSha)}` : '—',
    aguardando:
      state === 'aguardando'
        ? 'esperando você'
        : state === 'atrasada'
          ? 'não publicada'
          : state === 'publicando'
            ? 'autorizada'
            : run
              ? runLabel(run)
              : '—',
    prd:
      state === 'publicando'
        ? `publicando ${ver(mainSha)}`
        : prdSha
          ? `versão ${ver(prdSha)}${prdSha === mainSha ? ', a mais recente' : ''}`
          : 'sem resposta',
  };

  const steps = STEPS.map((step, i) => {
    let status = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
    if (i === activeIndex && state === 'atrasada') status = 'warn';
    if (i === activeIndex && state === 'falhou') status = 'error';
    if (state === 'desconhecido') status = 'todo';
    return { ...step, status, detail: detail[step.id] };
  });

  const activeHint =
    state === 'em_dia'
      ? 'Tudo publicado: os clientes estão na versão mais recente.'
      : state === 'desconhecido'
        ? 'Sem informação suficiente para saber onde a entrega está.'
        : state === 'atrasada'
          ? 'Existe uma versão mais nova que não foi publicada (a publicação foi recusada ou cancelada).'
          : (STEPS.find((s) => s.id === activeId)?.hint ?? '');

  return { state, mainSha, prdSha, run, branchPr, steps, activeHint };
}

function gitCard(snapshot, delivery) {
  if (!snapshot.git?.ok) return unavailable('Código', snapshot.git?.error);
  const g = snapshot.git.data;
  const prs = snapshot.github?.ok ? snapshot.github.data.prs : [];
  let state = 'limpo';
  let level = 'ok';
  let title = 'Sem pendências';
  // Nada aqui é tarefa do usuário: trabalho de quem desenvolve é azul; cópia atrasada é só informação.
  if (g.dirtyCount > 0) {
    [state, level, title] = ['alteracoes', 'run', `Trabalho em andamento neste PC (${plural(g.dirtyCount, 'arquivo', 'arquivos')})`];
  } else if (g.branch !== 'main' && g.ahead > 0 && !delivery.branchPr) {
    [state, level, title] = ['sem_pr', 'run', 'Mudanças ainda sem pedido de revisão (PR)'];
  } else if (g.branch === 'main' && g.behind > 0) {
    [state, level, title] = ['atras', 'off', `Cópia deste PC ${plural(g.behind, 'versão', 'versões')} atrás`];
  }
  return {
    state,
    level,
    title,
    subtitle: 'Onde o código fica guardado (GitHub) e os pedidos de mudança (PRs) esperando para entrar na versão oficial.',
    facts: [
      ['Pasta de trabalho (branch)', g.branch],
      ['Diferença para a oficial', `${g.ahead} à frente, ${g.behind} atrás`],
      ['Versão oficial (main)', verFull(g.mainSha)],
    ],
    prs: prs.map((pr) => ({
      ...pr,
      ciLabel: ciLabel(pr.ci),
      behind: pr.mergeState === 'BEHIND',
      action: prAction(pr),
    })),
    actions: [],
  };
}

function devCard(snapshot, delivery) {
  if (!snapshot.dev?.ok) return unavailable('Ambiente de testes', snapshot.dev?.error);
  const d = snapshot.dev.data;
  const containersOk = d.containers.every((c) => c.ok);
  let state;
  if (!d.dockerOk) state = 'degradado';
  else if (d.apiReady && d.webOk && containersOk) state = 'ok';
  else if (!d.apiReady && !d.webOk && !d.supervisorAlive) state = 'parado';
  else if (d.supervisorAlive && !(d.apiReady && d.webOk)) state = 'subindo';
  else state = 'degradado';

  const vsSite = compareWithSite(d.releaseSha, delivery.prdSha, snapshot.compare);
  const behindMain = Boolean(state === 'ok' && d.releaseSha && delivery.mainSha && d.releaseSha !== delivery.mainSha);
  const title = {
    ok: d.releaseSha ? `Ligado · ${ver(d.releaseSha)}` : 'Ligado',
    parado: 'Desligado',
    subindo: 'Ligando…',
    degradado: d.dockerOk ? 'Com problema' : 'Docker desligado',
  }[state];
  const level = { ok: 'ok', parado: 'off', subindo: 'run', degradado: 'bad' }[state];

  const yes = (ok) => (ok ? 'funcionando' : 'desligado');
  const facts = [
    ['Sistema (API :3002)', yes(d.apiReady)],
    ['Telas (web :5202)', yes(d.webOk)],
    ...d.containers.map((c) => [DEV_CONTAINER_NAMES[c.name] ?? c.name, c.ok ? 'funcionando' : 'desligado']),
    ['Versão', d.releaseSha ? verFull(d.releaseSha) : '—'],
    ['Comparado ao site', vsSite.text],
    ['Dados do banco', d.prdCopy ? `cópia do site, ${ageText(Date.parse(snapshot.at) - Date.parse(d.prdCopy.at))}` : 'dados próprios de teste'],
  ];
  if (!d.dockerOk) facts.unshift(['Docker', d.dockerError || 'desligado']);

  // Trazer a main só é seguro com o PC na main e sem alterações em arquivos versionados.
  const git = snapshot.git?.ok ? snapshot.git.data : null;
  const canSync = Boolean(
    git && git.branch === 'main' && git.trackedDirty === 0 && delivery.mainSha && (git.behind > 0 || d.releaseSha !== delivery.mainSha),
  );
  if (git && git.branch !== 'main') facts.push(['Código em teste', `pasta de trabalho ${git.branch}`]);

  const actions =
    state === 'parado'
      ? [{ name: 'dev.start', label: 'Ligar' }]
      : [
          { name: 'dev.restart', label: 'Reiniciar', confirm: 'simple' },
          { name: 'dev.stop', label: 'Desligar', confirm: 'simple' },
        ];
  const dbUp = d.containers.some((c) => c.name === 'cervejaria-db-dev' && c.ok);
  if (dbUp && state !== 'degradado') {
    actions.splice(state === 'parado' ? 1 : 0, 0, { name: 'dev.copyPrd', label: 'Copiar o banco do site', confirm: 'copy' });
  }
  if (canSync && state !== 'degradado') {
    actions.unshift({ name: 'dev.sync', label: `Trazer a versão oficial (${ver(delivery.mainSha)})`, confirm: 'simple' });
  }
  return {
    state,
    level,
    title,
    subtitle: 'Cópia do sistema que roda neste PC para testar mudanças antes dos clientes. Ligar ou desligar não afeta o site.',
    sha: d.releaseSha,
    behindMain,
    canSync,
    facts,
    compare: vsSite.lists,
    actions,
  };
}

/** Diferença entre o que roda no ambiente de testes e o que está no site. */
export function compareWithSite(devSha, prdSha, compare) {
  if (!devSha || !prdSha) return { text: '—', lists: null };
  if (devSha === prdSha) return { text: 'igual ao site', lists: null };
  const lists = {
    devOnly: (compare?.devOnly ?? []).map((c) => ({ ...c, version: ver(c.sha) })),
    prdOnly: (compare?.prdOnly ?? []).map((c) => ({ ...c, version: ver(c.sha) })),
  };
  const [devN, prdN] = [num(devSha), num(prdSha)];
  let text;
  if (devN && prdN) {
    const diff = devN - prdN;
    text = diff < 0 ? `${plural(-diff, 'versão', 'versões')} atrás do site` : `${plural(diff, 'versão', 'versões')} à frente do site`;
  } else {
    text = lists.devOnly.length
      ? `${plural(lists.devOnly.length, 'mudança', 'mudanças')} em teste que não estão no site`
      : 'diferente do site';
  }
  return { text, lists: lists.devOnly.length || lists.prdOnly.length ? lists : null };
}

function pipelineCard(snapshot) {
  if (!snapshot.github?.ok) return unavailable('Esteira', snapshot.github?.error);
  const runs = snapshot.github.data.runs;
  const waiting = runs.find((r) => r.status === 'waiting');
  const active = runs.find((r) => r.status !== 'completed');
  const last = runs[0];
  let state = 'ociosa';
  let level = 'ok';
  let title = 'Parada, nada pendente';
  const actions = [];
  if (waiting) {
    [state, level, title] = ['aguardando', 'warn', `Versão ${ver(waiting.sha)} esperando sua autorização`];
    actions.push(
      {
        name: 'deploy.approve',
        label: 'Publicar no site',
        params: { runId: waiting.id, sha: waiting.sha },
        confirm: 'deploy',
        primary: true,
        explain: 'Antes de confirmar, você vê o que muda para os clientes.',
      },
      { name: 'deploy.reject', label: 'Não publicar agora', params: { runId: waiting.id }, confirm: 'simple' },
    );
  } else if (active) {
    [state, level, title] = ['rodando', 'run', deployJobStarted(active) ? `Publicando ${ver(active.sha)}` : `Testando ${ver(active.sha)}`];
  } else if (runFailed(last)) {
    [state, level, title] = ['falhou', 'bad', `A última passagem falhou (${ver(last.sha)})`];
  }
  return {
    state,
    level,
    title,
    subtitle: 'Linha automática que testa, monta e publica cada nova versão oficial. Sempre para e pede sua autorização antes de publicar.',
    facts: [],
    runs: runs.slice(0, 4).map((r) => ({ ...r, short: short(r.sha), version: ver(r.sha), label: runLabel(r) })),
    actions,
  };
}

/** Desenho da esteira (deploy-vps.yml): colunas na ordem das dependências entre jobs. */
export const FLOW_LAYOUT = [
  [{ job: 'resolve-sha', label: 'Preparar', desc: 'Confere a versão e se há mudanças no banco de dados.' }],
  [
    { job: 'ci / build-and-unit', label: 'Testes automáticos', desc: 'Verifica se nada quebrou.' },
    { job: 'docker-build-sha', label: 'Montar a versão', desc: 'Empacota o sistema para o servidor.' },
  ],
  [{ job: 'deploy-prd', label: 'Publicar no site', desc: 'Espera sua autorização, faz backup e instala.' }],
];

const JOB_TEXT = {
  done: 'concluído',
  running: 'em andamento',
  waiting: 'esperando sua autorização',
  failed: 'falhou',
  rejected: 'você não autorizou',
  cancelled: 'cancelado',
  skipped: 'não executado',
  todo: 'na fila',
};
const JOB_LEVEL = { done: 'ok', running: 'run', waiting: 'warn', failed: 'bad' };

function jobStatus(job, spec, run) {
  if (!job) {
    if (run.status === 'waiting' && spec.job === 'deploy-prd') return 'waiting';
    return run.status === 'completed' ? 'skipped' : 'todo';
  }
  if (job.status === 'waiting') return 'waiting';
  if (job.status === 'in_progress') return 'running';
  if (job.status !== 'completed') return 'todo';
  if (job.conclusion === 'success') return 'done';
  if (job.conclusion === 'skipped') return 'skipped';
  if (job.conclusion === 'cancelled') return 'cancelled';
  if (run.rejected && spec.job === 'deploy-prd') return 'rejected';
  return 'failed';
}

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function flowJob(job, spec, run, now) {
  const status = jobStatus(job, spec, run);
  const started = job?.startedAt ? Date.parse(job.startedAt) : null;
  const ended = job?.completedAt ? Date.parse(job.completedAt) : status === 'running' ? now : null;
  const steps = job?.steps ?? [];
  return {
    label: spec.label,
    desc: spec.desc,
    status,
    level: JOB_LEVEL[status] ?? 'off',
    statusText: JOB_TEXT[status],
    time: started && ended ? duration(ended - started) : '',
    progress: status === 'running' && steps.length ? { done: steps.filter((s) => s.status === 'completed').length, total: steps.length } : null,
    url: job?.url ?? run.url,
  };
}

/** Run em foco (o ativo ou o mais recente) desenhado como no GitHub Actions. */
export function flowView(runs, now = Date.now(), subjects = new Map()) {
  const run = runs.find((r) => r.status !== 'completed') ?? runs[0];
  if (!run) return null;
  const jobs = run.jobs ?? [];
  const used = new Set();
  const columns = FLOW_LAYOUT.map((column) =>
    column.map((spec) => {
      const job = jobs.find((j) => j.name === spec.job);
      if (job) used.add(job);
      return flowJob(job, spec, run, now);
    }),
  );
  for (const job of jobs.filter((j) => !used.has(j))) {
    columns[1].push(flowJob(job, { job: job.name, label: job.name, desc: '' }, run, now));
  }
  const started = Date.parse(run.createdAt);
  const ended = run.status === 'completed' && run.updatedAt ? Date.parse(run.updatedAt) : now;
  return {
    live: run.status !== 'completed',
    sha: short(run.sha),
    version: ver(run.sha),
    // displayTitle do GitHub vem truncado; o assunto do commit local vem inteiro.
    title: subjects.get(run.sha) ?? run.title,
    url: run.url,
    label: runLabel(run),
    level: run.status === 'waiting' ? 'warn' : run.status !== 'completed' ? 'run' : runFailed(run) ? 'bad' : run.conclusion === 'success' ? 'ok' : 'off',
    trigger: run.event === 'workflow_dispatch' ? 'iniciada pelo painel' : 'automática, depois de aceitar um PR',
    startedAt: run.createdAt,
    total: duration(ended - started),
    columns,
  };
}

function prdCard(snapshot, delivery, now) {
  if (!snapshot.prd?.ok) return unavailable('Site dos clientes', snapshot.prd?.error);
  const p = snapshot.prd.data;
  const vps = p.vps?.configured && p.vps.ok ? p.vps.data : null;
  const infra = vps ? infraView(vps, p.vpsHistory ?? [], now, { version: ver, manage: Boolean(p.backupFiles) }) : null;
  const issues = [];
  if (vps) {
    if (infra?.containers.length) {
      issues.push(...infra.issues);
    } else {
      if (vps.api?.health && vps.api.health !== 'healthy') issues.push(`sistema ${CONTAINER_TEXT[vps.api.health] ?? vps.api.health}`);
      if (vps.db?.status && vps.db.status !== 'running') issues.push('banco de dados parado');
    }
    if (vps.disk_pct >= DISK_WARN_PCT) issues.push(`disco ${vps.disk_pct}% cheio`);
    if (vps.backup?.mtime && (vps.now - vps.backup.mtime) / 3600 > BACKUP_MAX_AGE_H) issues.push('backup atrasado');
  }

  let state = 'ok';
  let level = 'ok';
  let title = 'No ar';
  if (!p.healthOk) [state, level, title] = ['fora', 'bad', 'Fora do ar'];
  else if (!p.readyOk) [state, level, title] = ['degradado', 'bad', `Com problema (o site respondeu erro ${p.readyStatus})`];
  else if (issues.length) [state, level, title] = ['degradado', 'warn', `Atenção: ${issues.join(', ')}`];

  const behind = delivery.mainSha && p.releaseSha && p.releaseSha !== delivery.mainSha;
  const backupLate = vps?.backup?.mtime && (vps.now - vps.backup.mtime) / 3600 > BACKUP_MAX_AGE_H;
  const tiles = infra
    ? [
        {
          label: 'Versão no ar',
          value: ver(p.releaseSha),
          note: behind ? `há uma mais nova: ${ver(delivery.mainSha)}` : 'a mais recente',
          level: behind ? 'warn' : 'ok',
        },
        {
          label: 'Resposta do site',
          value: p.healthOk ? `${p.latencyMs} ms` : 'sem resposta',
          note: p.healthOk ? 'agora' : 'o site não respondeu',
          level: p.healthOk ? (p.latencyMs >= 2000 ? 'warn' : 'ok') : 'bad',
        },
        {
          label: 'Último backup',
          value: vps.backup?.mtime ? hoursAgo(vps.now - vps.backup.mtime) : '—',
          note: backupLate ? 'atrasado' : 'feito todo dia',
          level: !vps.backup?.mtime || backupLate ? 'warn' : 'ok',
        },
        { label: 'Servidor ligado há', value: infra.uptime, note: 'sem reiniciar', level: 'ok' },
      ]
    : null;
  const facts = infra
    ? []
    : [
        ['Versão no ar', p.releaseSha ? `${verFull(p.releaseSha)}${behind ? `, há uma mais nova (${ver(delivery.mainSha)})` : ', a mais recente'}` : '—'],
        ['Tempo de resposta', p.healthOk ? `${p.latencyMs} ms` : 'sem resposta'],
      ];
  if (vps && !infra) {
    facts.push(
      ['Sistema no servidor', containerText(vps.api?.status, vps.api?.health)],
      ['Banco de dados', containerText(vps.db?.status, vps.db?.health)],
      ['Disco usado', `${vps.disk_pct}%`],
      ['Último backup', vps.backup?.mtime ? hoursAgo(vps.now - vps.backup.mtime) : '—'],
    );
  } else if (!vps) {
    facts.push(['Detalhes do servidor', p.vps?.configured ? `sem leitura (${p.vps.error})` : 'indisponíveis (leitura do servidor não configurada)']);
  }

  return {
    state,
    level,
    title,
    subtitle: 'O site que os clientes usam (tap.quivercloud.com.br), no servidor da Hostinger.',
    facts,
    tiles,
    infra,
    deploys: (vps?.deploys ?? []).slice(-5).reverse().map((dep) => ({ ...dep, version: ver(dep.sha), short: short(dep.sha) })),
    actions: [{ name: 'deploy.dispatch', label: 'Voltar para uma versão anterior…', confirm: 'rollback' }],
    url: p.url,
    now,
  };
}

function ageText(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${plural(hours, 'hora', 'horas')}`;
  return `há ${plural(Math.round(hours / 24), 'dia', 'dias')}`;
}

function hoursAgo(seconds) {
  const h = seconds / 3600;
  return h < 1 ? `há ${Math.max(1, Math.round(seconds / 60))} min` : `há ${h.toFixed(1).replace('.', ',')} h`;
}

function prAdvice(pr) {
  if (needsUpdate(pr)) {
    return {
      level: 'warn',
      text: `O PR #${pr.number} precisa ser atualizado antes de ser aceito`,
      help: 'Ele foi feito sobre uma versão oficial antiga. Atualizar traz as últimas mudanças para dentro dele e os testes rodam de novo (1 a 3 minutos). Depois aparece o botão para aceitar.',
      next: {
        name: 'pr.update',
        label: `Atualizar o PR #${pr.number}`,
        params: { number: pr.number },
        confirm: 'simple',
        primary: true,
        explain: 'Não muda nada para os clientes.',
      },
    };
  }
  return {
    level: 'warn',
    text: `O PR #${pr.number} passou nos testes e pode ser aceito`,
    help: 'Aceitar junta a mudança à versão oficial. Isso ainda não publica nada: depois a esteira testa de novo e pede sua autorização.',
    next: {
      name: 'pr.merge',
      label: `Aceitar o PR #${pr.number}`,
      params: { number: pr.number },
      confirm: 'merge',
      primary: true,
      explain: 'Antes de confirmar, você vê as mudanças. Nada vai ao ar ainda.',
    },
  };
}

function decide(delivery, cards) {
  const d = delivery;
  const run = d.run;
  const prdDown = cards.prd.state === 'fora' || cards.prd.level === 'bad';
  const verdicts = [];
  let next = null;
  const say = (level, text, help) => verdicts.push({ level, text, help });

  if (prdDown) {
    say(
      'bad',
      cards.prd.state === 'fora' ? 'O site dos clientes está fora do ar' : 'O site dos clientes está com problema',
      'Abra o site para confirmar. Se continuar assim, chame quem cuida do servidor. Se começou logo depois de uma publicação, dá para voltar para a versão anterior no cartão Site dos clientes.',
    );
    next = { label: 'Abrir o site', href: cards.prd.url };
  }
  switch (d.state) {
    case 'falhou': {
      const failedRun = d.branchPr && d.prdSha === d.mainSha ? null : run;
      if (failedRun) {
        say(
          'bad',
          `A publicação da versão ${ver(d.mainSha)} falhou`,
          'Quando algo dá errado, a esteira volta sozinha para a versão anterior, então os clientes não devem ter sido afetados. Abra o detalhe para ver o erro e chame quem desenvolve.',
        );
        next ??= { label: 'Ver o que deu errado', href: failedRun.url };
      } else {
        say(
          'bad',
          `Os testes automáticos do PR #${d.branchPr?.number} falharam`,
          'A mudança tem algum erro e não pode ser aceita. Peça para quem fez a mudança corrigir; o painel avisa quando os testes passarem.',
        );
        next ??= { label: 'Ver o PR no GitHub', href: d.branchPr?.url };
      }
      break;
    }
    case 'aguardando':
      say(
        'warn',
        'Uma nova versão está pronta e esperando sua autorização',
        'Ela já passou nos testes. Clique em Publicar no site para ver o que muda antes de confirmar. Se não quiser publicar agora, use "Não publicar agora" no cartão Esteira.',
      );
      next ??= cards.pipeline.actions.find((a) => a.name === 'deploy.approve') ?? null;
      break;
    case 'publicando':
      say('run', 'Publicando a nova versão para os clientes', 'Leva de 1 a 3 minutos. Não precisa fazer nada: o painel atualiza sozinho.');
      next ??= run ? { label: 'Acompanhar no GitHub', href: run.url } : null;
      break;
    case 'main':
      say('run', 'A esteira está testando a nova versão', 'Leva cerca de 2 minutos. Quando terminar, ela para e pede sua autorização aqui no painel.');
      next ??= run ? { label: 'Acompanhar no GitHub', href: run.url } : null;
      break;
    case 'atrasada':
      say(
        'warn',
        'Há uma versão mais nova que ainda não foi publicada',
        `Os clientes estão na versão ${ver(d.prdSha)} e a mais nova é ${ver(d.mainSha)}. Isso acontece quando uma publicação foi recusada ou cancelada. Para publicar, clique no botão: a esteira testa de novo e pede sua autorização.`,
      );
      next ??= {
        name: 'deploy.dispatch',
        label: 'Publicar a versão mais recente',
        params: { sha: d.mainSha },
        confirm: 'deploy',
        primary: true,
        explain: 'A esteira testa de novo e, no fim, pede sua autorização.',
      };
      break;
    case 'pr': {
      const pr = d.branchPr;
      if (isMergeReady(pr) || needsUpdate(pr)) {
        const advice = prAdvice(pr);
        say(advice.level, advice.text, advice.help);
        next ??= advice.next;
      } else if (prWarmingUp(pr)) {
        say('run', `O GitHub está preparando os testes do PR #${pr.number}`, 'Acontece logo depois de um PR ser criado ou atualizado. Em alguns segundos os testes começam; o painel acompanha sozinho.');
      } else if (pr.ci === 'pending') {
        say('run', `Os testes do PR #${pr.number} estão rodando`, 'Leva de 1 a 3 minutos. O painel atualiza sozinho e mostra o botão para aceitar quando os testes passarem.');
      } else {
        say(
          'ok',
          `O PR #${pr.number} ainda não pode ser aceito`,
          'Ele está como rascunho, tem conflito com a versão oficial ou ainda não tem testes. Quem desenvolve precisa ajustar.',
        );
      }
      break;
    }
    case 'desconhecido':
      say('off', 'Não consegui ler o estado do código ou do site', 'Clique em Recarregar no topo. Se continuar, verifique a internet e se o GitHub está conectado neste PC.');
      break;
    default:
      break;
  }

  // PR pronto que não é o deste PC (ex.: só documentação): também é a vez do usuário.
  const otherPr = (cards.git.prs ?? []).find((p) => p.action && p.number !== d.branchPr?.number);
  if (!next && otherPr && (d.state === 'em_dia' || d.state === 'local')) {
    const advice = prAdvice(otherPr);
    say(advice.level, advice.text, advice.help);
    next = advice.next;
  }

  if (cards.dev.state === 'parado') {
    say('off', 'O ambiente de testes deste PC está desligado', 'Ele só é necessário para testar mudanças antes de publicar. Ligue se for testar algo; o site dos clientes não depende dele.');
    next ??= { name: 'dev.start', label: 'Ligar ambiente de testes', primary: true, explain: 'Fica pronto em cerca de 30 segundos.' };
  } else if (cards.dev.level === 'bad') {
    say('bad', `Ambiente de testes: ${cards.dev.title.toLowerCase()}`, 'Não afeta os clientes. Tente Reiniciar no cartão Ambiente de testes; se o Docker estiver desligado, abra o Docker Desktop.');
  } else if (cards.dev.behindMain) {
    next ??= {
      label: cards.dev.canSync
        ? `O ambiente de testes está na ${ver(cards.dev.sha)} e a versão oficial é a ${ver(d.mainSha)}. Para testar com a oficial, use "Trazer a versão oficial" no cartão Ambiente de testes.`
        : 'O ambiente de testes está com uma versão de trabalho, diferente da oficial. É normal enquanto alguém testa algo.',
      info: true,
    };
  }

  if (!verdicts.length) {
    say(
      'ok',
      'Tudo certo: os clientes estão na versão mais recente',
      d.state === 'local'
        ? `Há trabalho em andamento neste PC (${d.steps[0].detail}). Quando virar um PR, ele aparece aqui.`
        : 'Nada para fazer agora.',
    );
  }

  const order = ['bad', 'warn', 'run', 'off', 'ok'];
  const level = order.find((l) => verdicts.some((v) => v.level === l)) ?? 'ok';
  const main = verdicts.find((v) => v.level === level);
  return {
    verdict: { level, text: main.text, help: main.help, extra: verdicts.filter((v) => v !== main).map((v) => v.text) },
    next,
  };
}

export function deriveState(snapshot, now = Date.now()) {
  versionNumbers = snapshot.versions ?? {};
  const delivery = deriveDelivery(snapshot, now);
  const cards = {
    git: gitCard(snapshot, delivery),
    dev: devCard(snapshot, delivery),
    pipeline: pipelineCard(snapshot),
    prd: prdCard(snapshot, delivery, now),
  };
  const { verdict, next } = decide(delivery, cards);
  const recentMain = snapshot.git?.ok ? snapshot.git.data.recentMain : [];
  return {
    at: snapshot.at,
    moving: Boolean(snapshot.moving),
    verdict,
    next,
    flow: snapshot.github?.ok
      ? flowView(snapshot.github.data.runs, now, new Map(recentMain.map((c) => [c.sha, c.subject])))
      : null,
    delivery: {
      state: delivery.state,
      mainSha: delivery.mainSha,
      prdSha: delivery.prdSha,
      mainVersion: ver(delivery.mainSha),
      prdVersion: ver(delivery.prdSha),
      steps: delivery.steps,
      activeHint: delivery.activeHint,
      runUrl: delivery.run?.url ?? null,
    },
    cards,
    recentMain: recentMain.map((c) => ({ ...c, short: short(c.sha), version: ver(c.sha), isPrd: c.sha === delivery.prdSha })),
  };
}
