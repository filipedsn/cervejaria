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
  opsToken: document.getElementById('opsToken'),
  tokenStatus: document.getElementById('tokenStatus'),
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
  overviewProdValue: document.getElementById('overviewProdValue'),
  overviewDevValue: document.getElementById('overviewDevValue'),
  overviewCiValue: document.getElementById('overviewCiValue'),
  overviewInfraValue: document.getElementById('overviewInfraValue'),
  toast: document.getElementById('toast'),
};

let actionRunning = false;
let toastTimer;

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
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
  for (const id of ['btnRestart', 'btnDeploy', 'btnDevStart', 'btnDevStop', 'btnBackupDb', 'btnSyncProdDev']) {
    document.getElementById(id).disabled = disabled;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
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
  if (!getToken()) {
    showToast('Salve o token antes de executar acoes.', 'bad');
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
      'X-Ops-Token': getToken(),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
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
    } else {
      setTerminalStatus('Concluido', 'ok');
      showToast(`${label}: concluido.`);
    }

    await refreshStatus();
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
document.getElementById('btnRefresh').addEventListener('click', () => refreshStatus().catch(showError));

document.getElementById('btnRestart').addEventListener('click', () => {
  if (!confirm('Reiniciar a API de producao (:3001)?')) return;
  postActionStream('/api/prod/restart', {}, 'Reiniciar API prod');
});

document.getElementById('btnDeploy').addEventListener('click', () => {
  const confirmText = prompt('Digite DEPLOY para confirmar o deploy em producao:');
  if (confirmText !== 'DEPLOY') return;
  postActionStream('/api/prod/deploy', { confirm: 'DEPLOY' }, 'Deploy producao');
});

document.getElementById('btnDevStart').addEventListener('click', () => {
  postActionStream('/api/dev/start', {}, 'Iniciar dev');
});

document.getElementById('btnDevStop').addEventListener('click', () => {
  postActionStream('/api/dev/stop', {}, 'Parar dev');
});

document.getElementById('btnBackupDb').addEventListener('click', async () => {
  if (!getToken()) {
    showToast('Salve o token antes de executar acoes.', 'bad');
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

els.opsToken.value = getToken();
updateTokenStatus();
refreshStatus().catch(showError);
loadLogCatalog().catch(showError);
setInterval(() => refreshStatus().catch(() => {}), 30_000);
