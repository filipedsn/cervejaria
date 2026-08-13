const TOKEN_KEY = 'quiver-tap-ops-token';

const els = {
  prodMetrics: document.getElementById('prodMetrics'),
  devMetrics: document.getElementById('devMetrics'),
  githubMetrics: document.getElementById('githubMetrics'),
  infraMetrics: document.getElementById('infraMetrics'),
  backupMetrics: document.getElementById('backupMetrics'),
  logOutput: document.getElementById('logOutput'),
  logDescription: document.getElementById('logDescription'),
  logTabs: document.getElementById('logTabs'),
  terminalOutput: document.getElementById('terminalOutput'),
  terminalStatus: document.getElementById('terminalStatus'),
  terminalSection: document.getElementById('terminalSection'),
  lastUpdate: document.getElementById('lastUpdate'),
  opsPanelSubtitle: document.getElementById('opsPanelSubtitle'),
  opsPanelLiveBadge: document.getElementById('opsPanelLiveBadge'),
  opsToken: document.getElementById('opsToken'),
  tokenStatus: document.getElementById('tokenStatus'),
  authPanel: document.getElementById('authPanel'),
  authForm: document.getElementById('authForm'),
  authTitle: document.getElementById('authTitle'),
  authHint: document.getElementById('authHint'),
  linkPulls: document.getElementById('linkPulls'),
  linkActions: document.getElementById('linkActions'),
  linkBranches: document.getElementById('linkBranches'),
  linkCommits: document.getElementById('linkCommits'),
  prodBadge: document.getElementById('prodBadge'),
  devBadge: document.getElementById('devBadge'),
  overviewProd: document.getElementById('overviewProd'),
  overviewDev: document.getElementById('overviewDev'),
  overviewCi: document.getElementById('overviewCi'),
  overviewInfra: document.getElementById('overviewInfra'),
  overviewAgent: document.getElementById('overviewAgent'),
  overviewProdValue: document.getElementById('overviewProdValue'),
  overviewDevValue: document.getElementById('overviewDevValue'),
  overviewCiValue: document.getElementById('overviewCiValue'),
  overviewInfraValue: document.getElementById('overviewInfraValue'),
  overviewAgentValue: document.getElementById('overviewAgentValue'),
  agentHealthBadge: document.getElementById('agentHealthBadge'),
  agentHealthScore: document.getElementById('agentHealthScore'),
  agentHealthLevel: document.getElementById('agentHealthLevel'),
  agentHealthChecks: document.getElementById('agentHealthChecks'),
  agentMetrics: document.getElementById('agentMetrics'),
  agentControls: document.getElementById('agentControls'),
  toast: document.getElementById('toast'),
  releaseBadge: document.getElementById('releaseBadge'),
  releaseMetrics: document.getElementById('releaseMetrics'),
  releaseGate: document.getElementById('releaseGate'),
  releaseCommits: document.getElementById('releaseCommits'),
  releaseChecks: document.getElementById('releaseChecks'),
  ackMigrations: document.getElementById('ackMigrations'),
  overrideGate: document.getElementById('overrideGate'),
  overrideReason: document.getElementById('overrideReason'),
  overrideReasonField: document.getElementById('overrideReasonField'),
  rollbackHint: document.getElementById('rollbackHint'),
  deployPlaybook: document.getElementById('deployPlaybook'),
  deployConfirm: document.getElementById('deployConfirm'),
  postDeploySmoke: document.getElementById('postDeploySmoke'),
};

let actionRunning = false;
let toastTimer;
let release = null;
let localSession = false;
let supportAgent = null;
let agentPatchBusy = false;

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function canAct() {
  return localSession || Boolean(getToken());
}

function showToast(message, kind = 'ok') {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast show toast--${kind}`;
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2800);
}

function updateTokenStatus() {
  if (localSession) {
    els.authPanel.classList.add('auth-panel--local');
    els.authForm.hidden = true;
    els.authTitle.textContent = 'Sessao local';
    els.authHint.textContent = 'Painel em localhost — acoes autorizadas neste computador, sem colar token.';
    els.tokenStatus.textContent = 'Localhost';
    els.tokenStatus.className = 'token-status token-status--ok';
    return;
  }
  els.authPanel.classList.remove('auth-panel--local');
  els.authForm.hidden = false;
  els.authTitle.textContent = 'Autenticacao';
  els.authHint.textContent = 'Este acesso nao e localhost. Cole OPS_PANEL_TOKEN de ops-panel/.env para executar acoes.';
  const hasToken = Boolean(getToken());
  els.tokenStatus.textContent = hasToken ? 'Token salvo' : 'Token nao salvo';
  els.tokenStatus.className = `token-status token-status--${hasToken ? 'ok' : 'missing'}`;
}

function saveToken() {
  const value = els.opsToken.value.trim();
  if (!value) {
    showToast('Cole o token antes de salvar.', 'bad');
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, value);
  updateTokenStatus();
  showToast('Token salvo nesta sessao do navegador.');
}

function pill(ok, yes = 'Online', no = 'Offline') {
  const cls = ok ? 'pill--ok' : 'pill--bad';
  const label = ok ? yes : no;
  return `<span class="pill ${cls}"><span class="pill-dot"></span>${label}</span>`;
}

function chip(ok, yes = 'OK', no = 'Fora') {
  const cls = ok ? 'chip--ok' : 'chip--bad';
  return `<span class="chip ${cls}">${ok ? yes : no}</span>`;
}

function row(label, value) {
  return `<div class="metric-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function setOverviewCard(cardEl, state, text) {
  cardEl.className = `overview-card overview-card--${state}`;
  cardEl.querySelector('.overview-value').textContent = text;
}

async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['X-Ops-Token'] = token;
  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/plain')) {
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setTerminal(text) {
  els.terminalOutput.textContent = text;
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

function appendTerminal(text) {
  els.terminalOutput.textContent += text;
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

function setTerminalStatus(text, kind = '') {
  els.terminalStatus.textContent = text;
  els.terminalStatus.className = kind ? `terminal-status status-${kind}` : 'terminal-status';
}

function setButtonsDisabled(disabled) {
  const ids = ['btnRestart', 'btnDevStart', 'btnDevStop', 'btnBackupDb', 'btnSyncProdDev', 'btnReleaseRefresh'];
  for (const id of ids) {
    document.getElementById(id).disabled = disabled;
  }
  // Deploy e rollback nao voltam habilitados so porque a acao terminou: quem manda
  // neles e o gate de release, reavaliado logo depois.
  if (disabled) {
    document.getElementById('btnDeploy').disabled = true;
    document.getElementById('btnRollback').disabled = true;
  } else {
    applyReleaseToButtons();
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function agentOverviewState(health, processRunning) {
  if (!health) return { text: '—', state: 'warn' };
  if (!processRunning) return { text: 'Parado', state: 'warn' };
  if (health.level === 'saudavel') return { text: `Saudavel ${health.score}`, state: 'ok' };
  if (health.level === 'critico') return { text: `Critico ${health.score}`, state: 'bad' };
  return { text: `Atencao ${health.score}`, state: 'warn' };
}

function healthCheckClass(status) {
  if (status === 'ok') return 'agent-check--ok';
  if (status === 'bad') return 'agent-check--bad';
  if (status === 'info') return 'agent-check--info';
  return 'agent-check--warn';
}

function buildAgentPatch(ctrl, checked) {
  switch (ctrl.id) {
    case 'monitoring': return { monitoring: checked };
    case 'shadow': return { shadow: checked };
    case 'dryRun': return { dryRun: checked };
    case 'fixerEnabled': return { fixerEnabled: checked };
    case 'killSwitch': return { killSwitch: ctrl.inverted ? !checked : checked };
    case 'otlpMetrics': return { otlpMetrics: checked };
    default: return {};
  }
}

function renderSupportAgent(data) {
  if (!data) return;
  supportAgent = data;

  const ov = agentOverviewState(data.health, data.process.running);
  setOverviewCard(els.overviewAgent, ov.state, ov.text);

  const levelCls =
    data.health.level === 'saudavel' ? 'chip--ok'
      : data.health.level === 'critico' ? 'chip--bad' : 'chip--warn';
  els.agentHealthBadge.className = `chip ${levelCls}`;
  els.agentHealthBadge.textContent = data.health.label;

  els.agentHealthScore.textContent = String(data.health.score);
  els.agentHealthLevel.textContent = data.health.label;
  els.agentHealthLevel.className = `agent-health-level agent-health-level--${data.health.level}`;

  els.agentHealthChecks.innerHTML = data.health.checks.map((c) =>
    `<div class="agent-check ${healthCheckClass(c.status)}">` +
    `<span class="agent-check-dot" aria-hidden="true"></span>` +
    `<span>${escapeHtml(c.message)}</span></div>`,
  ).join('');

  const st = data.state || {};
  els.agentMetrics.innerHTML = [
    row('Processo', data.process.running ? `No ar (PID ${data.process.pid})` : pill(false, 'Parado', 'Parado')),
    row('Ultimo poll', st.lastPollIso ? formatDate(st.lastPollIso) : '—'),
    row('Alertas vistos', st.processedCount ?? 0),
    row('Fingerprints', st.fingerprintCount ?? 0),
    row('PRs hoje', st.prsToday ?? 0),
    row('Execucoes CLI hoje', st.runsToday ?? 0),
    row('Fixer efetivo', data.config.fixerEffective.enabled ? pill(true, 'Ligado') : data.config.fixerEffective.reason),
    row('Modo', data.config.shadow ? 'Sombra' : 'Completo'),
  ].join('');

  els.agentControls.innerHTML = '';
  for (const ctrl of data.controls) {
    const wrap = document.createElement('div');
    wrap.className = `agent-control${ctrl.disabled ? ' agent-control--disabled' : ''}`;

    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(ctrl.value);
    input.disabled = ctrl.disabled || agentPatchBusy;
    input.dataset.controlId = ctrl.id;
    input.addEventListener('change', () => patchAgentControl(ctrl, input.checked, input));

    const slider = document.createElement('span');
    slider.className = 'switch-slider';
    label.appendChild(input);
    label.appendChild(slider);

    const text = document.createElement('div');
    text.className = 'agent-control-text';
    text.innerHTML = `<strong>${escapeHtml(ctrl.label)}</strong>` +
      `<p>${escapeHtml(ctrl.description)}</p>` +
      (ctrl.disabledReason ? `<span class="agent-control-note">${escapeHtml(ctrl.disabledReason)}</span>` : '') +
      (ctrl.engaged && ctrl.reason ? `<span class="agent-control-note">Motivo: ${escapeHtml(ctrl.reason)}</span>` : '');

    wrap.appendChild(label);
    wrap.appendChild(text);
    els.agentControls.appendChild(wrap);
  }
}

async function refreshSupportAgent() {
  try {
    const data = await fetchJson('/api/support-agent');
    renderSupportAgent(data);
  } catch (err) {
    setOverviewCard(els.overviewAgent, 'bad', 'Erro');
    els.agentHealthBadge.textContent = 'Erro';
    els.agentHealthBadge.className = 'chip chip--bad';
    els.agentHealthChecks.innerHTML =
      `<div class="agent-check agent-check--bad"><span class="agent-check-dot"></span>` +
      `<span>${escapeHtml(err.message || 'Falha ao carregar agente')}</span></div>`;
  }
}

async function patchAgentControl(ctrl, checked, inputEl) {
  if (agentPatchBusy) return;
  agentPatchBusy = true;
  inputEl.disabled = true;

  try {
    const patch = buildAgentPatch(ctrl, checked);
    const res = await fetchJson('/api/support-agent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    renderSupportAgent(res.agent);
    const note = res.notes?.length ? res.notes.join('; ') : 'Atualizado';
    showToast(note);
  } catch (err) {
    inputEl.checked = !checked;
    showToast(err.message || 'Falha ao atualizar parametro.', 'bad');
  } finally {
    agentPatchBusy = false;
    inputEl.disabled = ctrl.disabled;
  }
}

function formatPullList(pulls) {
  if (!pulls?.length) {
    return '<span class="status-muted">Nenhuma PR aberta</span>';
  }
  const items = pulls.slice(0, 3).map((p) =>
    `<a href="${p.url}" target="_blank" rel="noopener">#${p.number}</a> ${p.title.slice(0, 42)}${p.title.length > 42 ? '…' : ''} <span class="status-muted">(${p.branch})</span>`,
  );
  const extra = pulls.length > 3 ? `<span class="status-muted"> +${pulls.length - 3} outra(s)</span>` : '';
  return items.join('<br>') + extra;
}

function formatBranchList(branches) {
  if (!branches?.length) return '<span class="status-muted">—</span>';
  const names = branches.slice(0, 6).map((b) =>
    `<a href="${b.url}" target="_blank" rel="noopener">${b.name}</a>`,
  );
  const extra = branches.length > 6 ? ` <span class="status-muted">+${branches.length - 6}</span>` : '';
  return names.join(' · ') + extra;
}

function scrollToTerminal() {
  els.terminalSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatCi(gh) {
  if (!gh.ci?.configured) {
    return {
      label: '<span class="pill pill--warn"><span class="pill-dot"></span>Token ausente</span>',
      overview: 'Configure GITHUB_TOKEN',
      overviewState: 'warn',
    };
  }
  if (gh.ci.error) {
    return {
      label: `<span class="pill pill--bad"><span class="pill-dot"></span>${gh.ci.error}</span>`,
      overview: gh.ci.error,
      overviewState: 'bad',
    };
  }
  if (gh.ci.status === 'none') {
    return {
      label: '<span class="pill pill--muted"><span class="pill-dot"></span>Sem execucoes</span>',
      overview: 'Nenhum CI ainda',
      overviewState: 'warn',
    };
  }
  const text = `${gh.ci.status}${gh.ci.conclusion ? ` / ${gh.ci.conclusion}` : ''}`;
  const ok = gh.ci.conclusion === 'success';
  const bad = gh.ci.conclusion === 'failure';
  const cls = ok ? 'pill--ok' : bad ? 'pill--bad' : 'pill--warn';
  const label = gh.ci.url
    ? `<a href="${gh.ci.url}" target="_blank" rel="noopener" class="pill ${cls}"><span class="pill-dot"></span>${text}</a>`
    : `<span class="pill ${cls}"><span class="pill-dot"></span>${text}</span>`;
  return {
    label,
    overview: ok ? 'CI passou' : bad ? 'CI falhou' : text,
    overviewState: ok ? 'ok' : bad ? 'bad' : 'warn',
  };
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function releaseItem(kind, icon, text) {
  return `<div class="release-item release-item--${kind}"><span class="release-item-icon" aria-hidden="true">${icon}</span><span>${text}</span></div>`;
}

function checkPill(check) {
  const verdict = check.verdict;
  const cls = verdict === 'sucesso' ? 'pill--ok'
    : verdict === 'falhou' ? 'pill--bad'
      : verdict === 'rodando' ? 'pill--warn' : 'pill--muted';
  const label = verdict === 'sucesso' ? 'passou'
    : verdict === 'falhou' ? `falhou (${check.conclusion})`
      : verdict === 'rodando' ? 'rodando' : verdict;
  const pillHtml = `<span class="pill ${cls}"><span class="pill-dot"></span>${label}</span>`;
  return check.url ? `<a href="${check.url}" target="_blank" rel="noopener">${pillHtml}</a>` : pillHtml;
}

function verdictOf(check) {
  if (!check) return 'ausente';
  if (check.status !== 'completed') return 'rodando';
  if (check.conclusion === 'success') return 'sucesso';
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return 'ignorado';
  return 'falhou';
}

/** Dos dois veredictos calculados pelo servidor, escolhe o que vale agora na tela. */
function effectiveGate() {
  if (!release) return null;
  return els.ackMigrations.checked ? release.gateWithMigrationsAck || release.gate : release.gate;
}

function applyReleaseToButtons() {
  const deploy = document.getElementById('btnDeploy');
  const rollback = document.getElementById('btnRollback');
  if (!release) {
    deploy.disabled = true;
    rollback.disabled = true;
    return;
  }

  const gate = effectiveGate();
  const canDeploy = els.overrideGate.checked
    ? Boolean(release.overridable) && Boolean(els.overrideReason.value.trim())
    : Boolean(gate?.allowed);
  const confirmOk = els.deployConfirm.value.trim() === 'DEPLOY';

  deploy.disabled = actionRunning || !canDeploy || !confirmOk;
  rollback.disabled = actionRunning || !release.rollback?.available;
}

function playbookStep(num, status, title, body) {
  return (
    `<div class="deploy-step deploy-step--${status}">` +
    `<span class="deploy-step-num">${num}</span>` +
    `<div class="deploy-step-body"><strong>${title}</strong>${body}</div></div>`
  );
}

function renderDeployPlaybook(data, gate) {
  if (!els.deployPlaybook) return;

  const steps = [];
  const behind = data.behindOriginMain || 0;
  const ahead = data.aheadOriginMain || 0;
  const syncOk = data.headOnOriginMain && behind === 0 && ahead === 0;

  if (syncOk) {
    steps.push(playbookStep(
      1,
      'ok',
      'Git sincronizado',
      `Branch <code>${escapeHtml(data.head?.branch || '?')}</code> alinhada com <code>origin/main</code>.`,
    ));
  } else if (behind > 0) {
    steps.push(playbookStep(
      1,
      'warn',
      'Rode git pull',
      `Faltam <strong>${behind}</strong> commit(s) neste PC. No PowerShell:<br>` +
      '<code>git pull origin main</code><br>Depois clique em <em>Verificar release</em>.',
    ));
  } else if (!data.headOnOriginMain) {
    steps.push(playbookStep(
      1,
      'bad',
      'Merge o PR antes',
      `HEAD nao esta em <code>origin/main</code> (branch <code>${escapeHtml(data.head?.branch || '?')}</code>). ` +
      'Faca merge no GitHub e depois <code>git pull origin main</code>.',
    ));
  } else if (ahead > 0) {
    steps.push(playbookStep(
      1,
      'warn',
      'Push pendente',
      `O PC esta <strong>${ahead}</strong> commit(s) a frente de origin/main — faca push ou alinhe com o remoto.`,
    ));
  }

  if (!data.workingTreeDirty) {
    steps.push(playbookStep(2, 'ok', 'Working tree limpa', 'Nenhum arquivo sujo bloqueando o gate.'));
  } else {
    const files = (data.dirtyFiles || [])
      .slice(0, 6)
      .map((file) => `<code>${escapeHtml(file)}</code>`)
      .join(', ');
    const extra = data.dirtyCount > 6 ? '…' : '';
    steps.push(playbookStep(
      2,
      'bad',
      'Limpe arquivos sujos',
      `${data.dirtyCount} arquivo(s): ${files || '?'}${extra}. Apague, commite ou ignore; depois <em>Verificar release</em>.`,
    ));
  }

  const blockers = gate?.blockers || [];
  if (blockers.length === 0) {
    steps.push(playbookStep(3, 'ok', 'CI e gate', 'Checks obrigatorios verdes. Liberado para publicar.'));
  } else {
    steps.push(playbookStep(
      3,
      'bad',
      'Gate com impedimento',
      escapeHtml(blockers.map((b) => b.message).join(' ')),
    ));
  }

  const confirmOk = els.deployConfirm.value.trim() === 'DEPLOY';
  steps.push(playbookStep(
    4,
    confirmOk ? 'ok' : 'warn',
    'Confirmar deploy',
    confirmOk
      ? 'Confirmacao <code>DEPLOY</code> preenchida — clique em <em>Liberar deploy</em>.'
      : 'Digite <code>DEPLOY</code> no campo abaixo para habilitar o botao.',
  ));

  els.deployPlaybook.innerHTML = steps.join('');
}

async function runPostDeploySmoke() {
  if (!els.postDeploySmoke) return;

  els.postDeploySmoke.hidden = false;
  els.postDeploySmoke.className = 'post-deploy-smoke';
  els.postDeploySmoke.innerHTML = '<strong>Passo 5 — verificando producao…</strong>';

  try {
    const smoke = await fetchJson('/api/prod/smoke');
    const items = [
      ['API /api/ready', smoke.ready],
      ['Frontend /', smoke.frontend],
      ['Manifest alinhado', smoke.manifestAligned],
      ['Nada pendente no painel', smoke.pendingCount === 0],
    ];
    if (smoke.logoSample) {
      items.push([`Upload de logo (${smoke.logoSample.file})`, smoke.logoSample.ok]);
    }

    const html = items.map(([label, ok]) =>
      `<div class="${ok ? 'status-ok' : 'status-bad'}">${ok ? '✓' : '✗'} ${escapeHtml(label)}</div>`,
    ).join('');

    els.postDeploySmoke.className = `post-deploy-smoke ${smoke.ok ? 'post-deploy-smoke--ok' : 'post-deploy-smoke--bad'}`;
    els.postDeploySmoke.innerHTML =
      `<strong>Passo 5 — smoke ${smoke.ok ? 'OK' : 'com falha'}</strong>${html}` +
      '<p class="status-muted">Confira no site: ' +
      '<a href="https://tap.quivercloud.com.br" target="_blank" rel="noopener">tap.quivercloud.com.br</a></p>';
  } catch (err) {
    els.postDeploySmoke.className = 'post-deploy-smoke post-deploy-smoke--bad';
    els.postDeploySmoke.innerHTML = `<strong>Passo 5 — falhou</strong><p>${escapeHtml(err.message || String(err))}</p>`;
  }
}

function renderRelease(data) {
  release = data;
  const gate = effectiveGate() || {};
  const head = data.head || {};
  const migrations = data.migrationsChanged || [];

  const badgeState = !data.gitAvailable ? 'bad' : gate.allowed ? 'ok' : 'warn';
  els.releaseBadge.className = `chip chip--${badgeState}`;
  els.releaseBadge.textContent = !data.gitAvailable
    ? 'Sem git'
    : gate.allowed ? 'Liberado' : `${gate.blockers.length} impedimento(s)`;

  const publicado = data.deployed?.gitSha
    ? `<code>${escapeHtml(data.deployed.gitSha)}</code> <span class="status-muted">${formatDate(data.deployed.deployedAt)}</span>`
    : '<span class="status-muted">Nenhum manifest em prod-artifacts</span>';

  const local = head.sha
    ? `<code>${escapeHtml(head.sha.slice(0, 7))}</code> ${escapeHtml((head.message || '').slice(0, 52))}<br>` +
      `<span class="status-muted">${escapeHtml(head.branch || '?')} · ${escapeHtml(head.author || '')}</span>`
    : '<span class="status-muted">—</span>';

  els.releaseMetrics.innerHTML = [
    row('Publicado em prod', publicado),
    row('Commit local (HEAD)', local),
    row('origin/main', data.originMain?.sha
      ? `<code>${escapeHtml(data.originMain.sha.slice(0, 7))}</code>${data.behindOriginMain ? ` <span class="status-warn">HEAD esta ${data.behindOriginMain} atras</span>` : ''}`
      : '<span class="status-bad">nao lido</span>'),
    row('Working tree', data.workingTreeDirty
      ? `<span class="status-bad">${data.dirtyCount} arquivo(s) nao commitado(s)</span>`
      : '<span class="status-ok">limpa</span>'),
    row('Migrations no deploy', migrations.length
      ? `<span class="status-warn">${migrations.length}</span>`
      : '<span class="status-muted">nenhuma</span>'),
    row('Rollback disponivel', data.rollback?.available
      ? `<code>${escapeHtml(data.rollback.gitSha || '?')}</code> <span class="status-muted">${formatDate(data.rollback.savedAt)}</span>`
      : '<span class="status-muted">nenhuma release anterior</span>'),
  ].join('');

  const items = [];
  for (const blocker of gate.blockers || []) {
    items.push(releaseItem('bad', '⛔', escapeHtml(blocker.message)));
  }
  for (const warning of gate.warnings || []) {
    items.push(releaseItem('warn', '⚠', escapeHtml(warning)));
  }
  if (!items.length) {
    items.push(releaseItem('ok', '✓', 'Commit esta em origin/main, working tree limpa e CI verde. Liberado para publicar.'));
  }
  els.releaseGate.innerHTML = items.join('');

  const commits = data.pending || [];
  els.releaseCommits.innerHTML = commits.length
    ? commits.map((c) => {
        const pr = c.pr
          ? `<a href="${c.pr.url}" target="_blank" rel="noopener">#${c.pr.number}</a>`
          : '<span class="status-muted">sem PR</span>';
        const agente = c.fromAgent ? '<span class="release-agent">agente</span>' : '';
        return row(
          `<code>${escapeHtml(c.shortSha)}</code> ${escapeHtml((c.message || '').slice(0, 46))}${agente}`,
          `${pr} <span class="status-muted">${escapeHtml(c.author || '')}</span>`,
        );
      }).join('')
    : `<div class="metric-row"><span class="status-muted">${data.pendingError ? escapeHtml(data.pendingError) : 'Nada novo em relacao ao que esta publicado.'}</span></div>`;

  const required = data.requiredChecks || [];
  els.releaseChecks.innerHTML = data.checksConfigured === false
    ? '<div class="metric-row"><span class="status-muted">GITHUB_TOKEN nao configurado: sem verificacao de CI.</span></div>'
    : required.map((name) => {
        const check = (data.checks || []).find((c) => c.name === name);
        return row(`<code>${escapeHtml(name)}</code>`, checkPill({ ...(check || {}), verdict: verdictOf(check) }));
      }).join('');

  els.rollbackHint.innerHTML = data.rollback?.available
    ? `Rollback volta para <code>${escapeHtml(data.rollback.gitSha || '?')}</code> (${escapeHtml((data.rollback.parts || []).join(', ') || 'artefatos salvos')}). <strong>Nao reverte banco.</strong>`
    : 'Rollback fica disponivel depois do primeiro deploy que preserva <code>prod-artifacts.previous</code>.';

  renderDeployPlaybook(data, gate);
  applyReleaseToButtons();
}

async function refreshRelease() {
  els.releaseBadge.className = 'chip chip--neutral';
  els.releaseBadge.textContent = 'Verificando…';
  try {
    renderRelease(await fetchJson('/api/release'));
  } catch (err) {
    els.releaseBadge.className = 'chip chip--bad';
    els.releaseBadge.textContent = 'Erro';
    els.releaseGate.innerHTML = releaseItem('bad', '⛔', escapeHtml(err.message || 'Falha ao verificar a release.'));
    release = null;
    applyReleaseToButtons();
  }
}

async function refreshStatus() {
  const data = await fetchJson('/api/status');
  const p = data.prod;
  const d = data.dev;
  const i = data.infra;

  const prodOk = p.ready && p.health && p.frontend;
  els.prodBadge.className = `chip chip--${prodOk ? 'ok' : 'bad'}`;
  els.prodBadge.textContent = prodOk ? 'Saudavel' : 'Com problemas';

  els.prodMetrics.innerHTML = [
    row('Health check', pill(p.ready, 'Pronto', 'Indisponivel')),
    row('API health', pill(p.health)),
    row('Frontend :3001', pill(p.frontend)),
    row('Processo API', p.apiPid
      ? `${p.apiPid} ${p.apiAlive ? pill(true, 'Ativo') : pill(false, 'Ativo', 'Morto')}`
      : '<span class="status-muted">Nao detectado</span>'),
    row('URL publica', `<a href="${p.publicUrl}" target="_blank" rel="noopener">${p.publicUrl}</a>`),
  ].join('');

  const devOk = d.api && d.frontend;
  els.devBadge.className = `chip chip--${devOk ? 'ok' : 'bad'}`;
  els.devBadge.textContent = devOk ? 'Rodando' : 'Parado';

  els.devMetrics.innerHTML = [
    row(`API :${d.apiPort}`, pill(d.api)),
    row(`Vite :${d.frontendPort}`, pill(d.frontend)),
    row('Supervisor', d.supervisorPid
      ? `${d.supervisorPid} ${d.supervisorAlive ? pill(true, 'Ativo') : pill(false, 'Ativo', 'Morto')}`
      : '<span class="status-muted">Nao iniciado</span>'),
  ].join('');

  const gh = data.github;
  els.linkPulls.href = gh.pulls;
  els.linkActions.href = gh.actions;
  els.linkBranches.href = gh.branchesUrl || `https://github.com/${gh.repo}/branches`;
  els.linkCommits.href = gh.commitsUrl || `https://github.com/${gh.repo}/commits/main`;
  const ci = formatCi(gh);

  const commitLabel = gh.lastCommit
    ? `<a href="${gh.lastCommit.url}" target="_blank" rel="noopener">${gh.lastCommit.sha}</a> ${gh.lastCommit.message}<br><span class="status-muted">${gh.lastCommit.author} · ${formatDate(gh.lastCommit.date)}</span>`
    : '<span class="status-muted">Sem commits</span>';

  const mergeLabel = gh.lastMerge
    ? `<a href="${gh.lastMerge.url}" target="_blank" rel="noopener">#${gh.lastMerge.number}</a> ${gh.lastMerge.title.slice(0, 48)}${gh.lastMerge.title.length > 48 ? '…' : ''}<br><span class="status-muted">${formatDate(gh.lastMerge.mergedAt)}</span>`
    : '<span class="status-muted">Nenhum merge ainda</span>';

  els.githubMetrics.innerHTML = [
    row('Repositorio', gh.repo),
    row('Ultimo CI', ci.label),
    row('PRs abertas', formatPullList(gh.openPulls)),
    row('Ultimo commit', commitLabel),
    row('Ultimo merge', mergeLabel),
    row(`Branches (${gh.branchCount ?? 0})`, formatBranchList(gh.branches)),
  ].join('');

  const infraOk = i.watchdogAlive && i.opsPanelAlive;
  els.infraMetrics.innerHTML = [
    row('Watchdog', i.watchdogPid
      ? `${i.watchdogPid} ${i.watchdogAlive ? pill(true, 'Ativo') : pill(false, 'Ativo', 'Morto')}`
      : '<span class="status-muted">Nao detectado</span>'),
    row('Ops panel', i.opsPanelPid
      ? `${i.opsPanelPid} ${i.opsPanelAlive ? pill(true, 'Ativo') : pill(false, 'Ativo', 'Morto')}`
      : '<span class="status-muted">Nao detectado</span>'),
  ].join('');

  const b = data.backup;
  els.backupMetrics.innerHTML = b
    ? row('Ultimo backup', `${b.name} · ${Math.round(b.size / 1024)} KB`)
    : row('Ultimo backup', '<span class="status-muted">Nenhum</span>');

  setOverviewCard(els.overviewProd, prodOk ? 'ok' : 'bad', prodOk ? 'Tudo OK' : 'Verificar');
  setOverviewCard(els.overviewDev, devOk ? 'ok' : 'bad', devOk ? 'Rodando' : 'Parado');
  setOverviewCard(els.overviewCi, ci.overviewState, ci.overview);
  setOverviewCard(els.overviewInfra, infraOk ? 'ok' : 'warn', infraOk ? 'Ativa' : 'Parcial');

  els.lastUpdate.textContent = `Atualizado ${new Date(data.timestamp).toLocaleTimeString('pt-BR')}`;
}

async function loadLogCatalog() {
  const data = await fetchJson('/api/logs');
  els.logTabs.innerHTML = '';
  for (const file of data.files) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.className = 'log-tab';
    btn.dataset.log = file.name;
    btn.textContent = file.label || file.name.replace('.log', '').replace(/-/g, ' ');
    btn.title = file.description;
    btn.addEventListener('click', () => selectLogTab(file.name, file.description));
    els.logTabs.appendChild(btn);
  }
  if (data.files.length) {
    selectLogTab(data.files[0].name, data.files[0].description);
  }
}

async function selectLogTab(name, description) {
  document.querySelectorAll('.log-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.log === name);
    b.setAttribute('aria-selected', b.dataset.log === name ? 'true' : 'false');
  });
  els.logDescription.textContent = description;
  const data = await fetchJson(`/api/logs/${name}`);
  if (!data.exists) {
    els.logOutput.textContent = 'Arquivo ainda nao existe.\nNormal se o servico nunca foi iniciado.';
  } else if (data.empty) {
    els.logOutput.textContent = 'Nenhum registro — sem erros por enquanto.';
  } else {
    els.logOutput.textContent = data.content;
  }
}

async function postActionStream(url, body, label) {
  if (!canAct()) {
    showToast('Acesso remoto exige o token de ops-panel/.env.', 'bad');
    els.opsToken.focus();
    return;
  }
  if (actionRunning) {
    showToast('Aguarde a acao atual terminar.', 'bad');
    return;
  }

  actionRunning = true;
  setButtonsDisabled(true);
  setTerminal('');
  setTerminalStatus(`Executando: ${label}...`, 'warn');
  scrollToTerminal();

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    const token = getToken();
    if (token) headers['X-Ops-Token'] = token;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const err = await res.json();
      const detalhe = err.blockers?.length
        ? `\n\n${err.blockers.map((b) => `- ${b.message}`).join('\n')}`
        : '';
      throw new Error(`${err.error || `HTTP ${res.status}`}${detalhe}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      appendTerminal(decoder.decode(value, { stream: true }));
    }

    const output = els.terminalOutput.textContent;
    if (output.includes('FALHA')) {
      setTerminalStatus('Concluido com falha', 'bad');
      showToast(`${label}: falhou. Veja o terminal.`, 'bad');
    } else if (output.includes('SUCESSO')) {
      setTerminalStatus('Concluido com sucesso', 'ok');
      showToast(`${label}: concluido com sucesso.`);
      if (/deploy/i.test(label)) {
        els.deployConfirm.value = '';
        await runPostDeploySmoke();
      }
    } else {
      setTerminalStatus('Concluido', 'ok');
      showToast(`${label}: concluido.`);
    }

    await refreshStatus();
    await refreshRelease();
    const active = document.querySelector('.log-tabs button.active');
    if (active) await selectLogTab(active.dataset.log, els.logDescription.textContent);
  } catch (err) {
    setTerminalStatus('Erro na execucao', 'bad');
    appendTerminal(`\n[erro] ${err.message || err}`);
    showToast(err.message || 'Erro na execucao.', 'bad');
  } finally {
    actionRunning = false;
    setButtonsDisabled(false);
  }
}

document.getElementById('btnSaveToken').addEventListener('click', saveToken);
document.getElementById('btnRefresh').addEventListener('click', () => {
  refreshStatus().catch(showError);
  refreshRelease();
  refreshSupportAgent();
});

document.getElementById('btnRestart').addEventListener('click', () => {
  if (!confirm('Reiniciar a API de producao (:3001)?')) return;
  postActionStream('/api/prod/restart', {}, 'Reiniciar API prod');
});

document.getElementById('btnReleaseRefresh').addEventListener('click', () => {
  refreshRelease();
});

els.ackMigrations.addEventListener('change', () => {
  if (release) renderRelease(release);
});
els.overrideReason.addEventListener('input', applyReleaseToButtons);
els.overrideGate.addEventListener('change', () => {
  els.overrideReasonField.hidden = !els.overrideGate.checked;
  applyReleaseToButtons();
});
els.deployConfirm.addEventListener('input', () => {
  if (release) renderRelease(release);
});

document.getElementById('btnDeploy').addEventListener('click', () => {
  if (els.deployConfirm.value.trim() !== 'DEPLOY') {
    showToast('Digite DEPLOY no campo de confirmacao.', 'bad');
    els.deployConfirm.focus();
    return;
  }

  const override = els.overrideGate.checked;
  const alvo = release?.head?.sha ? release.head.sha.slice(0, 7) : '?';
  const uacNote = '\n\nIMPORTANTE: o Windows vai pedir permissao de Administrador (UAC). Clique em SIM.\nO prompt pode aparecer atras do navegador — verifique a barra de tarefas.';
  if (!confirm(override
    ? `Ignorar o gate e publicar ${alvo} em producao?${uacNote}`
    : `Publicar o commit ${alvo} em producao?${uacNote}`)) {
    return;
  }

  postActionStream('/api/prod/deploy', {
    confirm: 'DEPLOY',
    acknowledgeMigrations: els.ackMigrations.checked,
    override,
    overrideConfirm: override ? 'DEPLOY-SEM-GATE' : undefined,
    overrideReason: override ? els.overrideReason.value.trim() : undefined,
  }, 'Deploy producao');
});

document.getElementById('btnRollback').addEventListener('click', () => {
  const alvo = release?.rollback?.gitSha || 'release anterior';
  const aviso = `Voltar producao para ${alvo}?\n\nO banco NAO e revertido: migrations aplicadas continuam aplicadas.\n\nDigite ROLLBACK para confirmar:`;
  if (prompt(aviso) !== 'ROLLBACK') return;
  postActionStream('/api/prod/rollback', { confirm: 'ROLLBACK' }, 'Rollback producao');
});

document.getElementById('btnDevStart').addEventListener('click', () => {
  postActionStream('/api/dev/start', {}, 'Iniciar dev');
});

document.getElementById('btnDevStop').addEventListener('click', () => {
  postActionStream('/api/dev/stop', {}, 'Parar dev');
});

document.getElementById('btnBackupDb').addEventListener('click', async () => {
  if (!canAct()) {
    showToast('Acesso remoto exige o token de ops-panel/.env.', 'bad');
    els.opsToken.focus();
    return;
  }
  if (actionRunning) {
    showToast('Aguarde a acao atual terminar.', 'bad');
    return;
  }

  setTerminalStatus('Abrindo seletor de pasta...', 'warn');
  showToast('Use a janela nativa do Windows para escolher qualquer pasta.');

  try {
    const pick = await fetchJson('/api/infra/pick-backup-folder', { method: 'POST' });
    if (pick.cancelled) {
      setTerminalStatus('Backup cancelado', 'warn');
      showToast('Backup cancelado.');
      return;
    }

    setTerminalStatus('Selecionando pasta...', 'warn');
    postActionStream('/api/infra/backup-db', { destinationDir: pick.path }, 'Backup banco prod');
  } catch (err) {
    setTerminalStatus('Erro ao selecionar pasta', 'bad');
    showToast(err.message || 'Erro ao abrir seletor de pasta.', 'bad');
  }
});

document.getElementById('btnSyncProdDev').addEventListener('click', () => {
  const confirmText = prompt(
    'Isso SUBSTITUI todos os dados de cervejaria_dev pelos de producao.\n\nDigite SYNC-DEV para confirmar:',
  );
  if (confirmText !== 'SYNC-DEV') return;
  postActionStream('/api/infra/sync-prod-to-dev', { confirm: 'SYNC-DEV' }, 'Copiar prod para dev');
});

function showError(err) {
  setTerminalStatus('Erro ao carregar', 'bad');
  showToast(err.message || 'Erro ao carregar dados.', 'bad');
}

function updateOpsPanelMeta(meta) {
  if (!meta) return;
  els.opsPanelSubtitle.textContent = `Painel local · ${meta.url}`;
  els.opsPanelLiveBadge.textContent = `Online · PID ${meta.pid}`;
  els.opsPanelLiveBadge.className = 'ops-live-badge ops-live-badge--ok';
  els.opsPanelLiveBadge.title = `Iniciado em ${formatDate(meta.startedAt)}`;
}

async function loadOpsPanelMeta() {
  try {
    const meta = await fetchJson('/api/meta');
    updateOpsPanelMeta(meta);
    return meta;
  } catch {
    els.opsPanelLiveBadge.textContent = 'Meta indisponivel';
    els.opsPanelLiveBadge.className = 'ops-live-badge ops-live-badge--warn';
    return null;
  }
}

async function initSession() {
  const host = window.location.hostname;
  const browserLocal = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

  try {
    const res = await fetch('/api/session');
    if (res.ok) {
      const session = await res.json();
      localSession = Boolean(session.trusted);
      updateTokenStatus();
      return;
    }
    if (res.status === 404 && browserLocal) {
      els.authTitle.textContent = 'Instancia antiga';
      els.authHint.innerHTML =
        'Esta pagina nao e a versao atual do ops-panel (falta <code>/api/session</code>). ' +
        'Rode <code>npm run ops:status</code> no terminal — ele mostra a URL certa e o que fazer.';
      els.authForm.hidden = true;
      els.tokenStatus.textContent = 'Use ops:status';
      els.tokenStatus.className = 'token-status token-status--missing';
      els.opsPanelLiveBadge.textContent = 'Versao antiga';
      els.opsPanelLiveBadge.className = 'ops-live-badge ops-live-badge--warn';
      return;
    }
  } catch {
    // segue para fallback
  }

  localSession = browserLocal;
  updateTokenStatus();
}

els.opsToken.value = getToken();
initSession()
  .then(() => loadOpsPanelMeta())
  .then(() => {
    refreshStatus().catch(showError);
    loadLogCatalog().catch(showError);
    refreshRelease();
    refreshSupportAgent();
  })
  .catch(showError);
setInterval(() => refreshStatus().catch(() => {}), 30_000);
setInterval(() => refreshSupportAgent(), 60_000);
