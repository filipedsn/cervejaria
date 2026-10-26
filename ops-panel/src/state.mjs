/**
 * Máquina de estados do painel. Função pura: snapshot dos coletores → o que a tela mostra.
 *
 * Entrega (HEAD da main):
 *   local → pr → main (CI + build) → aguardando (aprovação) → publicando → em_dia
 *   desvios: falhou (CI do PR ou deploy), atrasada (PRD atrás da main sem run ativo).
 * Ambientes: git, dev, pipeline (esteira), prd — cada um com { state, level, title, facts, actions }.
 * level: ok | run | warn | bad | off.
 */

export const STEPS = [
  { id: 'local', label: 'Local' },
  { id: 'pr', label: 'Pull request' },
  { id: 'main', label: 'main: CI + build' },
  { id: 'aguardando', label: 'Aprovação' },
  { id: 'prd', label: 'Produção' },
];

const MAIN_JUST_MERGED_MS = 3 * 60_000;
const BACKUP_MAX_AGE_H = 26;
const DISK_WARN_PCT = 85;

export const short = (sha) => (sha ? String(sha).slice(0, 7) : '—');

export function isMergeReady(pr) {
  return Boolean(
    pr &&
      !pr.isDraft &&
      pr.baseBranch === 'main' &&
      pr.ci === 'success' &&
      pr.mergeable === 'MERGEABLE' &&
      (pr.state === undefined || pr.state === 'OPEN'),
  );
}

const unavailable = (title, error) => ({
  state: 'indisponivel',
  level: 'off',
  title,
  facts: [['Erro', error || 'sem resposta']],
  actions: [],
});

function deployJobRunning(run) {
  return (run?.jobs ?? []).some((j) => j.name === 'deploy-prd' && j.status === 'in_progress');
}

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
      state = deployJobRunning(run) ? 'publicando' : 'main';
    } else if (run.conclusion === 'failure') {
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
    local: git ? `${git.branch}${git.dirtyCount ? `, ${git.dirtyCount} alterações` : ''}` : '—',
    pr: branchPr ? `#${branchPr.number}, CI ${ciLabel(branchPr.ci)}` : prs.length ? `${prs.length} aberto(s)` : 'nenhum',
    main: mainSha ? `${short(mainSha)} ${git.mainSubject}` : '—',
    aguardando:
      state === 'aguardando' ? 'aguardando você' : state === 'atrasada' ? 'não publicado' : run ? runLabel(run) : '—',
    prd: prdSha ? `${short(prdSha)}${prdSha === mainSha ? ' = main' : ''}` : 'sem resposta',
  };

  const steps = STEPS.map((step, i) => {
    let status = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
    if (i === activeIndex && state === 'atrasada') status = 'warn';
    if (i === activeIndex && state === 'falhou') status = 'error';
    if (state === 'desconhecido') status = 'todo';
    return { ...step, status, detail: detail[step.id] };
  });

  return { state, mainSha, prdSha, run, branchPr, steps };
}

const ciLabel = (ci) => ({ success: 'verde', failure: 'vermelho', pending: 'rodando', none: 'sem check' })[ci] ?? ci;

function runLabel(run) {
  if (run.status !== 'completed') return run.status === 'waiting' ? 'aguardando aprovação' : 'rodando';
  return { success: 'ok', failure: 'falhou', cancelled: 'cancelado', skipped: 'pulado' }[run.conclusion] ?? run.conclusion;
}

function gitCard(snapshot, delivery) {
  if (!snapshot.git?.ok) return unavailable('Git', snapshot.git?.error);
  const g = snapshot.git.data;
  const prs = snapshot.github?.ok ? snapshot.github.data.prs : [];
  let state = 'limpo';
  let level = 'ok';
  let title = 'Limpo';
  if (g.branch === 'main' && g.behind > 0) {
    [state, level, title] = ['atras', 'warn', `Atrás da origin/main (${g.behind})`];
  } else if (g.dirtyCount > 0) {
    [state, level, title] = ['alteracoes', 'warn', `${g.dirtyCount} arquivo(s) alterado(s)`];
  } else if (g.branch !== 'main' && g.ahead > 0 && !delivery.branchPr) {
    [state, level, title] = ['sem_pr', 'warn', 'Branch com commits e sem PR'];
  }
  return {
    state,
    level,
    title,
    facts: [
      ['Branch', g.branch],
      ['À frente / atrás da main', `${g.ahead} / ${g.behind}`],
      ['main', `${short(g.mainSha)} ${g.mainSubject}`],
    ],
    prs: prs.map((pr) => ({
      ...pr,
      ciLabel: ciLabel(pr.ci),
      action: isMergeReady(pr)
        ? { name: 'pr.merge', label: 'Mergear', params: { number: pr.number }, confirm: 'merge' }
        : null,
    })),
    actions: [],
  };
}

function devCard(snapshot, delivery) {
  if (!snapshot.dev?.ok) return unavailable('DEV', snapshot.dev?.error);
  const d = snapshot.dev.data;
  const containersOk = d.containers.every((c) => c.ok);
  let state;
  if (!d.dockerOk) state = 'degradado';
  else if (d.apiReady && d.webOk && containersOk) state = 'ok';
  else if (!d.apiReady && !d.webOk && !d.supervisorAlive) state = 'parado';
  else if (d.supervisorAlive && !(d.apiReady && d.webOk)) state = 'subindo';
  else state = 'degradado';

  const behindMain = Boolean(state === 'ok' && d.releaseSha && delivery.mainSha && d.releaseSha !== delivery.mainSha);
  const title = {
    ok: behindMain ? 'No ar (versão diferente da main)' : 'No ar',
    parado: 'Parado',
    subindo: 'Subindo…',
    degradado: d.dockerOk ? 'Degradado' : 'Docker parado',
  }[state];
  const level = { ok: behindMain ? 'warn' : 'ok', parado: 'off', subindo: 'run', degradado: 'bad' }[state];

  const yes = (ok) => (ok ? 'ok' : 'fora');
  const facts = [
    ['API :3002', yes(d.apiReady)],
    ['Web :5202', yes(d.webOk)],
    ...d.containers.map((c) => [c.name, c.ok ? 'ok' : c.status ?? 'parado']),
    ['Versão', d.releaseSha ? `${short(d.releaseSha)}${d.releaseSha === delivery.mainSha ? ' = main' : ''}` : '—'],
  ];
  if (!d.dockerOk) facts.unshift(['Docker', d.dockerError || 'daemon fora']);

  const actions =
    state === 'parado'
      ? [{ name: 'dev.start', label: 'Ligar' }]
      : [
          { name: 'dev.restart', label: 'Reiniciar', confirm: 'simple' },
          { name: 'dev.stop', label: 'Desligar', confirm: 'simple' },
        ];
  return { state, level, title, behindMain, facts, actions };
}

function pipelineCard(snapshot) {
  if (!snapshot.github?.ok) return unavailable('Esteira', snapshot.github?.error);
  const runs = snapshot.github.data.runs;
  const waiting = runs.find((r) => r.status === 'waiting');
  const active = runs.find((r) => r.status !== 'completed');
  const last = runs[0];
  let state = 'ociosa';
  let level = 'ok';
  let title = 'Ociosa';
  const actions = [];
  if (waiting) {
    [state, level, title] = ['aguardando', 'warn', `Deploy de ${short(waiting.sha)} aguardando você`];
    actions.push(
      { name: 'deploy.approve', label: 'Aprovar deploy', params: { runId: waiting.id, sha: waiting.sha }, confirm: 'deploy', primary: true },
      { name: 'deploy.reject', label: 'Rejeitar', params: { runId: waiting.id }, confirm: 'simple' },
    );
  } else if (active) {
    [state, level, title] = ['rodando', 'run', deployJobRunning(active) ? `Publicando ${short(active.sha)}` : `CI + build de ${short(active.sha)}`];
  } else if (last?.conclusion === 'failure') {
    [state, level, title] = ['falhou', 'bad', `Último run falhou (${short(last.sha)})`];
  }
  return {
    state,
    level,
    title,
    facts: [],
    runs: runs.slice(0, 4).map((r) => ({ ...r, short: short(r.sha), label: runLabel(r) })),
    actions,
  };
}

function prdCard(snapshot, delivery, now) {
  if (!snapshot.prd?.ok) return unavailable('Produção', snapshot.prd?.error);
  const p = snapshot.prd.data;
  const vps = p.vps?.configured && p.vps.ok ? p.vps.data : null;
  const issues = [];
  if (vps) {
    if (vps.api?.health && vps.api.health !== 'healthy') issues.push(`container ${vps.api.health}`);
    if (vps.db?.status && vps.db.status !== 'running') issues.push(`banco ${vps.db.status}`);
    if (vps.disk_pct >= DISK_WARN_PCT) issues.push(`disco ${vps.disk_pct}%`);
    if (vps.backup?.mtime && (vps.now - vps.backup.mtime) / 3600 > BACKUP_MAX_AGE_H) issues.push('backup atrasado');
  }

  let state = 'ok';
  let level = 'ok';
  let title = 'No ar';
  if (!p.healthOk) [state, level, title] = ['fora', 'bad', 'Fora do ar'];
  else if (!p.readyOk) [state, level, title] = ['degradado', 'bad', `Não está pronto (HTTP ${p.readyStatus})`];
  else if (issues.length) [state, level, title] = ['degradado', 'warn', `Atenção: ${issues.join(', ')}`];

  const behind = delivery.mainSha && p.releaseSha && p.releaseSha !== delivery.mainSha;
  const facts = [
    ['Versão', p.releaseSha ? `${short(p.releaseSha)}${behind ? ' (≠ main)' : ' = main'}` : '—'],
    ['Resposta', p.healthOk ? `${p.latencyMs} ms` : 'sem resposta'],
  ];
  if (vps) {
    facts.push(
      ['Container API', [vps.api?.status, vps.api?.health].filter(Boolean).join(', ') || '—'],
      ['Banco', [vps.db?.status, vps.db?.health].filter(Boolean).join(', ') || '—'],
      ['Disco', `${vps.disk_pct}%`],
      ['Último backup', vps.backup?.mtime ? hoursAgo(vps.now - vps.backup.mtime) : '—'],
    );
  } else {
    facts.push(['VPS', p.vps?.configured ? `sem leitura (${p.vps.error})` : 'só dados públicos (chave de leitura não configurada)']);
  }

  return {
    state,
    level,
    title,
    facts,
    deploys: (vps?.deploys ?? []).slice(-5).reverse(),
    actions: [{ name: 'deploy.dispatch', label: 'Publicar / rollback…', confirm: 'rollback' }],
    url: p.url,
    now,
  };
}

function hoursAgo(seconds) {
  const h = seconds / 3600;
  return h < 1 ? `há ${Math.max(1, Math.round(seconds / 60))} min` : `há ${h.toFixed(1)} h`;
}

function decide(delivery, cards) {
  const d = delivery;
  const run = d.run;
  const prdDown = cards.prd.state === 'fora' || cards.prd.level === 'bad';
  const verdicts = [];
  let next = null;

  if (prdDown) {
    verdicts.push(['bad', `Produção: ${cards.prd.title.toLowerCase()}`]);
    next = { label: 'Abrir produção', href: cards.prd.url };
  }
  switch (d.state) {
    case 'falhou': {
      const failedRun = d.branchPr && d.prdSha === d.mainSha ? null : run;
      verdicts.push(['bad', failedRun ? `Deploy de ${short(d.mainSha)} falhou` : `CI vermelho no PR #${d.branchPr?.number}`]);
      next ??= { label: failedRun ? 'Abrir o run que falhou' : `Abrir PR #${d.branchPr?.number}`, href: failedRun?.url ?? d.branchPr?.url };
      break;
    }
    case 'aguardando':
      verdicts.push(['warn', `Deploy de ${short(d.mainSha)} aguardando sua aprovação`]);
      next ??= cards.pipeline.actions.find((a) => a.name === 'deploy.approve') ?? null;
      break;
    case 'publicando':
      verdicts.push(['run', `Publicando ${short(d.mainSha)} em produção`]);
      next ??= run ? { label: 'Acompanhar o run', href: run.url } : null;
      break;
    case 'main':
      verdicts.push(['run', `main ${short(d.mainSha)}: CI e build rodando`]);
      next ??= run ? { label: 'Acompanhar o run', href: run.url } : null;
      break;
    case 'atrasada':
      verdicts.push(['warn', `Produção em ${short(d.prdSha)}, main em ${short(d.mainSha)}: não publicado`]);
      next ??= {
        name: 'deploy.dispatch',
        label: `Publicar main (${short(d.mainSha)})`,
        params: { sha: d.mainSha },
        confirm: 'deploy',
        primary: true,
      };
      break;
    case 'pr':
      verdicts.push(['ok', `PR #${d.branchPr.number}: CI ${ciLabel(d.branchPr.ci)}`]);
      if (isMergeReady(d.branchPr)) {
        next ??= { name: 'pr.merge', label: `Mergear PR #${d.branchPr.number}`, params: { number: d.branchPr.number }, confirm: 'merge', primary: true };
      }
      break;
    case 'desconhecido':
      verdicts.push(['off', 'Sem dados suficientes de Git ou produção']);
      break;
    default:
      break;
  }

  if (cards.dev.state === 'parado') {
    verdicts.push(['off', 'DEV parado']);
    next ??= { name: 'dev.start', label: 'Ligar DEV', primary: true };
  } else if (cards.dev.level === 'bad') {
    verdicts.push(['bad', `DEV: ${cards.dev.title.toLowerCase()}`]);
  } else if (cards.dev.behindMain) {
    next ??= { label: 'DEV roda outra versão: publique o DEV com prepare/swap (CONTRIBUTING)', info: true };
  }

  if (!verdicts.length) {
    verdicts.push(['ok', d.state === 'local' ? `Tudo em dia; trabalho local em ${d.steps[0].detail}` : 'Tudo em dia: produção = main']);
  }

  const order = ['bad', 'warn', 'run', 'off', 'ok'];
  const level = order.find((l) => verdicts.some(([v]) => v === l)) ?? 'ok';
  const text = verdicts.find(([v]) => v === level)[1];
  return { verdict: { level, text, extra: verdicts.filter(([, t]) => t !== text).map(([, t]) => t) }, next };
}

export function deriveState(snapshot, now = Date.now()) {
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
    verdict,
    next,
    delivery: { state: delivery.state, mainSha: delivery.mainSha, prdSha: delivery.prdSha, steps: delivery.steps, runUrl: delivery.run?.url ?? null },
    cards,
    recentMain: recentMain.map((c) => ({ ...c, short: short(c.sha), isPrd: c.sha === delivery.prdSha })),
  };
}
