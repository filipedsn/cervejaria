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
  overviewRelease: document.getElementById('overviewRelease'),
  overviewInfra: document.getElementById('overviewInfra'),
  overviewProdValue: document.getElementById('overviewProdValue'),
  overviewProdDetail: document.getElementById('overviewProdDetail'),
  overviewDevValue: document.getElementById('overviewDevValue'),
  overviewDevDetail: document.getElementById('overviewDevDetail'),
  overviewCiValue: document.getElementById('overviewCiValue'),
  overviewCiDetail: document.getElementById('overviewCiDetail'),
  overviewReleaseValue: document.getElementById('overviewReleaseValue'),
  overviewReleaseDetail: document.getElementById('overviewReleaseDetail'),
  overviewInfraValue: document.getElementById('overviewInfraValue'),
  overviewInfraDetail: document.getElementById('overviewInfraDetail'),
  toast: document.getElementById('toast'),
  releaseBadge: document.getElementById('releaseBadge'),
  releaseSummary: document.getElementById('releaseSummary'),
  releaseMetrics: document.getElementById('releaseMetrics'),
  releaseGate: document.getElementById('releaseGate'),
  releaseCommits: document.getElementById('releaseCommits'),
  releaseChecks: document.getElementById('releaseChecks'),
  releaseHistory: document.getElementById('releaseHistory'),
  ackMigrations: document.getElementById('ackMigrations'),
  overrideGate: document.getElementById('overrideGate'),
  overrideReason: document.getElementById('overrideReason'),
  overrideReasonField: document.getElementById('overrideReasonField'),
  rollbackHint: document.getElementById('rollbackHint'),
  deployPlaybook: document.getElementById('deployPlaybook'),
  deployConfirm: document.getElementById('deployConfirm'),
  prepareRelease: document.getElementById('btnPrepareRelease'),
  releaseDetails: document.getElementById('btnReleaseDetails'),
  releaseFlow: document.getElementById('releaseFlow'),
  postDeploySmoke: document.getElementById('postDeploySmoke'),
  serviceList: document.getElementById('serviceList'),
  globalState: document.getElementById('globalState'),
  globalStateTitle: document.getElementById('globalStateTitle'),
  globalStateSummary: document.getElementById('globalStateSummary'),
  investigate: document.getElementById('btnInvestigate'),
  stateDetails: document.getElementById('btnStateDetails'),
  globalStateActionTitle: document.getElementById('globalStateActionTitle'),
  globalStateActionHint: document.getElementById('globalStateActionHint'),
  recentOperations: document.getElementById('recentOperations'),
  alertsSource: document.getElementById('alertsSource'),
  activeAlerts: document.getElementById('activeAlerts'),
  recoveredAlerts: document.getElementById('recoveredAlerts'),
  pollerSemanticHealth: document.getElementById('pollerSemanticHealth'),
  journeyFrom: document.getElementById('journeyFrom'),
  journeyTo: document.getElementById('journeyTo'),
  journeyTenant: document.getElementById('journeyTenant'),
  journeyActor: document.getElementById('journeyActor'),
  journeyAction: document.getElementById('journeyAction'),
  journeyWhere: document.getElementById('journeyWhere'),
  journeyOutcome: document.getElementById('journeyOutcome'),
  journeyCorrelation: document.getElementById('journeyCorrelation'),
  journeyEnvironment: document.getElementById('journeyEnvironment'),
  journeySource: document.getElementById('journeySource'),
  journeyTimeline: document.getElementById('journeyTimeline'),
  journeyPagination: document.getElementById('journeyPagination'),
  journeyPrev: document.getElementById('journeyPrev'),
  journeyNext: document.getElementById('journeyNext'),
  journeyPageStatus: document.getElementById('journeyPageStatus'),
};

// A release e a decisao principal; os detalhes operacionais continuam acessiveis abaixo.
const releaseSection = document.getElementById('releaseSection');
const overview = document.getElementById('overview');
const serviceStrip = document.querySelector('.service-strip');
const quickActions = document.querySelector('.quick-actions');
const alertsPanel = document.getElementById('alertsPanel');
if (releaseSection && overview && serviceStrip && alertsPanel && quickActions) {
  const homeControlGrid = document.createElement('div');
  homeControlGrid.className = 'home-control-grid';
  const observabilityColumn = document.createElement('div');
  observabilityColumn.className = 'observability-column';
  const alertsRow = document.createElement('div');
  alertsRow.className = 'alerts-row';
  overview.after(homeControlGrid);
  homeControlGrid.append(releaseSection, observabilityColumn, quickActions);
  observabilityColumn.append(serviceStrip);
  alertsRow.append(alertsPanel);
  homeControlGrid.after(alertsRow);
}

// Mantem as mesmas acoes/endpoints, mas as agrupa no cockpit para a leitura direta da home.
const releasePrimaryActions = document.querySelector('.release-primary-action');
for (const id of ['btnReleaseRefresh', 'btnDeploy', 'btnRollback']) {
  const action = document.getElementById(id);
  if (action && releasePrimaryActions) releasePrimaryActions.appendChild(action);
}

document.querySelectorAll('.section-nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.section-nav-link').forEach((item) => item.classList.remove('is-active'));
    link.classList.add('is-active');
  });
});

let actionRunning = false;
let toastTimer;
let release = null;
let localSession = false;
let statusSnapshot = null;
let releaseDetailsVisible = false;

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
  if (!cardEl) return;
  cardEl.className = `overview-card overview-card--${state}`;
  cardEl.querySelector('.overview-value').textContent = text;
}

function setOverviewDetail(el, text) {
  if (el) el.textContent = text;
}

function serviceState(ok) {
  return ok === true ? 'OK' : ok === false ? 'OFFLINE' : 'UNKNOWN';
}

function renderServices(data) {
  const p = data.prod || {};
  const i = data.infra || {};
  const services = [
    ['Aplicacao', 'API', serviceState(p.ready && p.health), ':3001'],
    ['Aplicacao', 'Frontend', serviceState(p.frontend), 'local'],
    ['Dados', 'PostgreSQL', serviceState(i.postgres?.ok), i.postgres?.ok === true ? 'readiness da API' : 'estado nao atribuivel'],
    ['Conectividade', 'Cloudflare', serviceState(i.cloudflare?.ok), i.cloudflare?.pid ? `PID ${i.cloudflare.pid}` : 'sem PID runtime'],
    ['Automacao', 'Watchdog', serviceState(i.watchdogPid ? i.watchdogAlive : null), i.watchdogPid ? `PID ${i.watchdogPid}` : 'nao detectado'],
    ['Automacao', 'Alert Poller', serviceState(i.alertPoller?.ok), `health :${i.alertPoller?.port || 3098}`],
    ['Operacao', 'Ops Panel', serviceState(i.opsPanelPid ? i.opsPanelAlive : null), i.opsPanelPid ? `PID ${i.opsPanelPid}` : 'nao detectado'],
  ];
  const groups = new Map();
  for (const [domain, name, state, detail] of services) {
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push([name, state, detail]);
  }
  els.serviceList.innerHTML = [...groups].map(([domain, items]) =>
    `<div class="service-group"><span class="service-group-title">${domain}</span>${items.map(([name, state, detail]) => {
      const kind = state === 'OK' ? 'ok' : state === 'OFFLINE' ? 'bad' : 'unknown';
      return `<span class="service-signal service-signal--${kind}"><span aria-hidden="true">${kind === 'ok' ? '●' : kind === 'bad' ? '×' : '?'}</span><strong>${name}</strong> ${state}<small>${detail}</small></span>`;
    }).join('')}</div>`,
  ).join('');

  // A home usa tiles individuais para leitura operacional imediata. Nao ha sparkline:
  // o painel so mostra tendencia quando existir historico real para ela.
  const serviceTiles = [
    ['API', serviceState(p.ready && p.health), ':3001'],
    ['Frontend', serviceState(p.frontend), 'local'],
    ['PostgreSQL', serviceState(i.postgres?.ok), i.postgres?.ok === true ? 'readiness da API' : 'estado nao atribuivel'],
    ['Alert Poller', serviceState(i.alertPoller?.ok), `health :${i.alertPoller?.port || 3098}`],
    ['Watchdog', serviceState(i.watchdogPid ? i.watchdogAlive : null), i.watchdogPid ? `PID ${i.watchdogPid}` : 'nao detectado'],
    ['Cloudflare', serviceState(i.cloudflare?.ok), i.cloudflare?.pid ? `PID ${i.cloudflare.pid}` : 'sem PID runtime'],
  ];
  els.serviceList.innerHTML = serviceTiles.map(([name, state, detail]) => {
    const kind = state === 'OK' ? 'ok' : state === 'OFFLINE' ? 'bad' : 'unknown';
    const label = state === 'OK' ? 'SAUDAVEL' : state === 'OFFLINE' ? 'OFFLINE' : 'DESCONHECIDO';
    return `<article class="service-tile service-tile--${kind}"><span class="service-tile-icon" aria-hidden="true"></span><strong>${name}</strong><span class="service-tile-state">${label}</span><small>${detail}</small></article>`;
  }).join('');

  const operational = [
    p.ready && p.health,
    p.frontend,
    i.postgres?.ok,
    i.alertPoller?.ok,
    i.watchdogPid ? i.watchdogAlive : null,
    i.cloudflare?.ok,
    i.opsPanelPid ? i.opsPanelAlive : null,
  ];
  const healthy = operational.filter((value) => value === true).length;
  const offline = operational.some((value) => value === false);
  const unknown = operational.some((value) => value == null);
  setOverviewCard(els.overviewInfra, offline ? 'bad' : unknown ? 'warn' : 'ok', `${healthy}/${operational.length} saudaveis`);
  setOverviewDetail(els.overviewInfraDetail, offline ? 'Servico offline' : unknown ? 'Sinal pendente' : 'Sinais verificados');
}

function renderAlertItem(alert) {
  const link = alert.kibanaUrl ? ` <a href="${escapeHtml(alert.kibanaUrl)}" target="_blank" rel="noopener">Detalhes</a>` : '';
  return row(`${escapeHtml(alert.ruleName)} <span class="status-muted">${escapeHtml(alert.severity || 'medium')} · ${escapeHtml(alert.environment || 'unknown')}</span>`, `${escapeHtml(alert.state || 'UNKNOWN')} · ${escapeHtml(formatDate(alert.timestamp) || 'horario desconhecido')}${link}`);
}

async function refreshAlerts(poller) {
  const semantic = poller?.semantic;
  els.pollerSemanticHealth.innerHTML = semantic
    ? [row('Poller', `<span class="status-${semantic.status === 'healthy' ? 'ok' : 'warn'}">${escapeHtml(String(semantic.status).toUpperCase())}</span>`), row('Ultimo poll', escapeHtml(formatDate(semantic.lastSuccessfulPollAt) || 'ainda nao comprovado')), row('Staleness', semantic.stale ? '<span class="status-warn">STALE</span>' : 'OK'), semantic.lastPollError ? row('Ultimo erro', escapeHtml(semantic.lastPollError)) : ''].join('')
    : row('Poller', '<span class="status-muted">Health semantico indisponivel</span>');
  try {
    const data = await fetchJson('/api/alerts');
    const unavailable = data.source !== 'elastic';
    els.alertsSource.className = `chip chip--${unavailable ? 'warn' : 'ok'}`;
    els.alertsSource.textContent = unavailable ? 'Fonte indisponivel' : 'Elastic';
    const alerts = data.alerts || [];
    const active = alerts.filter((a) => /^(active|alert|firing)$/i.test(a.state || ''));
    const recovered = alerts.filter((a) => /^(recovered|ok|resolved)$/i.test(a.state || ''));
    els.activeAlerts.innerHTML = active.length ? `<div class="metric-row"><strong>Alertas ativos</strong></div>${active.map(renderAlertItem).join('')}` : '<div class="metric-row"><span class="status-muted">Nenhum alerta ativo comprovado.</span></div>';
    els.recoveredAlerts.innerHTML = recovered.length ? `<div class="metric-row"><strong>Recuperados recentes</strong></div>${recovered.map(renderAlertItem).join('')}` : '';
    if (unavailable) els.activeAlerts.innerHTML = `<div class="metric-row"><span class="status-warn">Alertas: ${escapeHtml(data.reason || 'fonte indisponivel')}</span></div>`;
  } catch {
    els.alertsSource.className = 'chip chip--warn';
    els.alertsSource.textContent = 'Fonte indisponivel';
    els.activeAlerts.innerHTML = '<div class="metric-row"><span class="status-warn">Alertas: fonte indisponivel.</span></div>';
  }
}

function releaseStateForDisplay(data, gate) {
  if (data.recovery?.active) return { label: 'BLOCKED', tone: 'bad' };
  if (gate?.allowed) return { label: 'READY', tone: 'ok' };
  const blockers = gate?.blockers || [];
  const migrationOnly = blockers.length > 0 && blockers.every((blocker) => blocker.code === 'migrations-sem-confirmacao');
  return migrationOnly ? { label: 'ATTENTION', tone: 'warn' } : { label: 'BLOCKED', tone: 'bad' };
}

function renderGlobalState() {
  if (!statusSnapshot || !release) return;
  const prod = statusSnapshot.prod || {};
  const infra = statusSnapshot.infra || {};
  const recovery = prod.recovery?.active || release.recovery?.active;
  const prodOnline = prod.ready && prod.health && prod.frontend;
  const releaseState = releaseStateForDisplay(release, effectiveGate());
  const unknownServices = [infra.postgres?.ok, infra.alertPoller?.ok, infra.cloudflare?.ok].filter((value) => value == null).length;
  let tone = 'ok';
  let title = 'SAUDAVEL';
  let summary = `Producao saudavel. Release ${releaseState.label}. ${unknownServices} sinais aguardam fonte confiavel.`;
  let actionTarget = '#observabilitySection';
  let actionLabel = 'Investigar servico';
  let actionTitle = 'Verificar estado';
  let actionHint = 'Os sinais verificados indicam que nenhuma acao imediata e necessaria.';

  if (recovery) {
    tone = 'bad';
    title = 'RECOVERY';
    summary = `Recovery ativo em ${release.recovery?.failurePhase || prod.recovery?.failurePhase || 'UNKNOWN'}. Acoes normais de release estao bloqueadas.`;
    actionTarget = '#releaseSection';
    actionLabel = 'Abrir recovery';
    actionTitle = 'Abrir recovery';
    actionHint = 'A intervencao manual domina as operacoes normais.';
  } else if (!prod.ready) {
    tone = 'bad';
    title = 'CRITICO';
    summary = 'A API de producao nao respondeu ao readiness local. Investigue Ambientes e Observabilidade.';
    actionTarget = '#environmentsSection';
    actionTitle = 'Verificar API de producao';
    actionHint = 'O readiness local nao respondeu.';
  } else if (!prodOnline || releaseState.tone === 'bad') {
    tone = 'warn';
    title = 'ATENCAO';
    summary = releaseState.tone === 'bad'
      ? `${effectiveGate()?.blockers?.length || 0} impedimento(s) de release. A producao continua sob monitoramento.`
      : 'Um ou mais sinais de producao nao estao saudaveis. Verifique Ambientes.';
    actionTarget = releaseState.tone === 'bad' ? '#releaseSection' : '#environmentsSection';
    actionLabel = releaseState.tone === 'bad' ? 'Verificar release' : 'Investigar servico';
    actionTitle = releaseState.tone === 'bad' ? 'Verificar bloqueios de release' : 'Verificar servico de producao';
    actionHint = releaseState.tone === 'bad' ? 'O gate precisa de uma decisao antes de publicar.' : 'Um sinal de producao precisa de atencao.';
  } else if (releaseState.tone === 'warn') {
    tone = 'warn';
    title = 'ATENCAO';
    summary = 'A release possui migration ou outro ponto que exige confirmacao humana.';
    actionTarget = '#releaseSection';
    actionLabel = 'Verificar release';
    actionTitle = 'Confirmar release';
    actionHint = 'Existe uma confirmacao operacional pendente.';
  }

  els.globalState.className = `global-state global-state--${tone}`;
  els.globalStateTitle.textContent = title;
  els.globalStateSummary.textContent = summary;
  els.globalState.querySelector('.global-state-icon').textContent = tone === 'ok' ? 'OK' : tone === 'warn' ? '!' : 'X';
  if (els.investigate) {
    els.investigate.textContent = actionLabel;
    els.investigate.dataset.target = actionTarget;
  }
  if (els.globalStateActionTitle) els.globalStateActionTitle.textContent = actionTitle;
  if (els.globalStateActionHint) els.globalStateActionHint.textContent = actionHint;
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

function semanticJourneyAction(action, event) {
  const key = String(action || '').toLowerCase();
  if (key === 'auth.login.succeeded') return ['👤', 'Entrou no sistema'];
  if (key === 'auth.logout') return ['👋', 'Saiu do sistema'];
  if (key.includes('authorization.denied') || key.includes('room.denied') || key.includes('session.rejected')) return ['⚠️', 'Ação bloqueada por permissão'];
  if (key === 'db.operation.slow') return ['⏱️', 'Operação demorou mais que o esperado'];
  if (key.includes('caixa') && (key.includes('aberto') || key.includes('abrir'))) return ['💰', 'Abriu o caixa'];
  if (key.includes('caixa') && (key.includes('fechado') || key.includes('fechar'))) return ['💰', 'Fechou o caixa'];
  if (key.includes('comanda') && key.includes('criada')) return ['🛒', 'Iniciou uma venda'];
  if ((key.includes('item') || key.includes('pedido')) && (key.includes('adicionado') || key.includes('criado'))) return ['➕', 'Adicionou item'];
  if (key.includes('pagamento') && (key.includes('registrado') || key.includes('completed') || key.includes('confirm'))) return ['💳', 'Pagamento concluído'];
  if (key.includes('venda_avulsa')) return ['🛒', 'Registrou venda avulsa'];
  if ((key.includes('comanda') || key.includes('venda')) && (key.includes('fechada') || key.includes('completed'))) return ['✅', 'Venda concluída'];
  if (event.outcome === 'failure' || (event.statusCode || 0) >= 400) return ['❌', 'Ação não concluída'];
  if (key.startsWith('ui.page_view')) return ['🧭', 'Abriu uma tela'];
  if (key.startsWith('http.') || key.startsWith('http.request.completed')) return ['↔', (event.statusCode || 0) >= 400 ? 'Requisição não concluída' : 'Requisição concluída'];
  return ['•', 'Ação operacional'];
}

function addJourneyDetail(list, label, value) {
  if (value === undefined || value === null || value === '') return;
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = String(value);
  list.append(term, detail);
}

const JOURNEY_PAGE_SIZE = 10;
let journeyEvents = [];
let journeyPage = 1;

function renderJourney(events, page = journeyPage) {
  journeyEvents = events;
  const totalPages = Math.max(1, Math.ceil(events.length / JOURNEY_PAGE_SIZE));
  journeyPage = Math.min(Math.max(1, page), totalPages);
  els.journeyTimeline.replaceChildren();
  if (!events.length) {
    els.journeyPagination.hidden = true;
    const empty = document.createElement('span');
    empty.className = 'status-muted';
    empty.textContent = 'Nenhum evento encontrado para estes filtros.';
    els.journeyTimeline.append(empty);
    return;
  }
  const start = (journeyPage - 1) * JOURNEY_PAGE_SIZE;
  for (const event of events.slice(start, start + JOURNEY_PAGE_SIZE)) {
    const [icon, title] = semanticJourneyAction(event.action, event);
    const item = document.createElement('article');
    item.className = `journey-event${event.outcome === 'failure' || (event.statusCode || 0) >= 400 ? ' journey-event--failure' : ''}`;
    const time = document.createElement('time');
    time.className = 'journey-event-time';
    time.dateTime = event.timestamp;
    time.textContent = formatDate(event.timestamp);
    const main = document.createElement('div');
    main.className = 'journey-event-main';
    const heading = document.createElement('strong');
    heading.textContent = `${icon} ${title}`;
    const context = document.createElement('p');
    context.textContent = [event.actorId && `ator ${event.actorId}`, event.actorRole, event.page || event.route, event.outcome].filter(Boolean).join(' · ') || 'Contexto operacional';
    main.append(heading, context);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Ver detalhes';
    const level2 = document.createElement('dl');
    addJourneyDetail(level2, 'Rota/tela', event.route || event.page);
    addJourneyDetail(level2, 'Entidade', [event.entityType, event.entityId].filter(Boolean).join(':'));
    addJourneyDetail(level2, 'HTTP', event.statusCode ? `${event.method || ''} ${event.statusCode}`.trim() : undefined);
    addJourneyDetail(level2, 'Correlation ID', event.correlationId);
    addJourneyDetail(level2, 'Trace ID', event.traceId);
    addJourneyDetail(level2, 'Span ID', event.spanId);
    addJourneyDetail(level2, 'Latência', event.durationMs !== undefined ? `${event.durationMs} ms` : undefined);
    addJourneyDetail(level2, 'Event action', event.action);
    details.append(summary, level2);
    item.append(time, main, details);
    els.journeyTimeline.append(item);
  }
  els.journeyPagination.hidden = totalPages <= 1;
  els.journeyPageStatus.textContent = `Página ${journeyPage} de ${totalPages} · ${events.length} evento(s)`;
  els.journeyPrev.disabled = journeyPage <= 1;
  els.journeyNext.disabled = journeyPage >= totalPages;
}

function journeyQuery() {
  const params = new URLSearchParams({ environment: els.journeyEnvironment.value || 'dev' });
  const values = {
    from: els.journeyFrom.value ? new Date(els.journeyFrom.value).toISOString() : '',
    to: els.journeyTo.value ? new Date(els.journeyTo.value).toISOString() : '',
    tenantId: els.journeyTenant.value.trim(), actorId: els.journeyActor.value.trim(),
    action: els.journeyAction.value.trim(), where: els.journeyWhere.value.trim(),
    outcome: els.journeyOutcome.value, correlationId: els.journeyCorrelation.value.trim(),
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params;
}

async function refreshJourney() {
  if (!canAct()) {
    els.journeySource.textContent = 'O acesso remoto exige o token do Ops Panel.';
    return;
  }
  els.journeySource.textContent = 'Consultando os streams de auditoria e telemetria…';
  try {
    const data = await fetchJson(`/api/operation-journey?${journeyQuery()}`);
    if (data.source !== 'elastic') {
      els.journeySource.textContent = data.reason || 'Fonte de observabilidade indisponível.';
      renderJourney([]);
      return;
    }
    els.journeySource.textContent = `${data.events.length} evento(s), ordem cronológica. Fonte: audit + technical (${data.filters.environment.toUpperCase()}).`;
    renderJourney(data.events, 1);
  } catch (error) {
    els.journeySource.textContent = error.message || 'Não foi possível consultar a jornada.';
    renderJourney([]);
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
  els.terminalSection.open = true;
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
  const sync = data.sync || {};
  const syncOk = data.headOnOriginMain && behind === 0 && ahead === 0 && data.head?.branch === 'main';

  if (sync.performed) {
    const fromBranch = sync.previousBranch && sync.previousBranch !== 'main'
      ? `<code>${escapeHtml(sync.previousBranch)}</code> → `
      : '';
    steps.push(playbookStep(
      1,
      'ok',
      'Git sincronizado automaticamente',
      `${fromBranch}<code>main</code> alinhada com <code>origin/main</code>` +
      (sync.newSha ? ` (<code>${escapeHtml(sync.newSha.slice(0, 7))}</code>).` : '.') +
      ' Clique em <em>Verificar release</em> se acabou de mergear uma PR.',
    ));
  } else if (sync.attempted && sync.error) {
    steps.push(playbookStep(
      1,
      'bad',
      'Falha ao sincronizar main',
      `${escapeHtml(sync.error)}<br>Manual: <code>git checkout main</code> e <code>git pull --ff-only origin main</code>.`,
    ));
  } else if (syncOk) {
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
      'Main desatualizada',
      `Faltam <strong>${behind}</strong> commit(s) neste PC. Clique em <em>Verificar release</em> para sincronizar automaticamente ` +
      '(ou rode <code>git pull --ff-only origin main</code>).',
    ));
  } else if (!data.headOnOriginMain) {
    steps.push(playbookStep(
      1,
      'bad',
      'Merge o PR antes',
      `HEAD nao esta em <code>origin/main</code> (branch <code>${escapeHtml(data.head?.branch || '?')}</code>). ` +
      'Faca merge no GitHub e clique em <em>Verificar release</em> para ir para <code>main</code>.',
    ));
  } else if (ahead > 0) {
    steps.push(playbookStep(
      1,
      'warn',
      'Push pendente',
      `O PC esta <strong>${ahead}</strong> commit(s) a frente de origin/main — faca push ou alinhe com o remoto.`,
    ));
  } else if (data.head?.branch !== 'main') {
    steps.push(playbookStep(
      1,
      'warn',
      'Troque para main',
      `Branch atual: <code>${escapeHtml(data.head?.branch || '?')}</code>. Clique em <em>Verificar release</em> para sincronizar.`,
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

function renderRecentOperations(history) {
  if (!els.recentOperations) return;
  if (history?.corrupted) {
    els.recentOperations.innerHTML = '<span class="status-warn">Historico ilegivel; consulte os detalhes de release.</span>';
    return;
  }
  const events = history?.events || [];
  if (!events.length) {
    els.recentOperations.innerHTML = '<span class="status-muted">Sem eventos registrados no ledger.</span>';
    return;
  }
  els.recentOperations.innerHTML = events.slice(0, 4).map((event) => {
    const success = event.result === 'SUCCESS';
    const label = event.type === 'DEPLOY' ? 'DEPLOY PARA PRODUCAO' : event.type === 'ROLLBACK' ? 'ROLLBACK' : escapeHtml(event.type || 'OPERACAO');
    const version = event.gitShortSha || event.gitSha || event.restoredGitSha || '—';
    return `<div class="recent-operation"><strong>${label}</strong><span class="status-${success ? 'ok' : event.result === 'RECOVERY_REQUIRED' ? 'bad' : 'warn'}">${escapeHtml(event.result || 'UNKNOWN')}</span><small>${escapeHtml(String(version).slice(0, 7))} · ${escapeHtml(formatDate(event.finishedAt) || 'data desconhecida')}</small></div>`;
  }).join('');
}

function renderRelease(data) {
  release = data;
  const gate = effectiveGate() || {};
  const head = data.head || {};
  const migrations = data.migrationsChanged || [];
  const recovery = data.recovery || { active: false };
  const candidateDiffers = Boolean(head.sha && data.deployed?.gitSha && !head.sha.startsWith(data.deployed.gitSha));
  const ciVerdicts = (data.requiredChecks || []).map((name) => {
    const check = (data.checks || []).find((item) => item.name === name);
    return verdictOf(check);
  });
  const ciState = !data.gitAvailable || data.checksConfigured === false || data.checksError
    ? 'DESCONHECIDO'
    : ciVerdicts.some((value) => value === 'falhou') ? 'FALHANDO'
      : ciVerdicts.some((value) => value === 'rodando' || value === 'ausente') ? 'EXECUTANDO'
        : 'VERDE';

  setOverviewDetail(els.overviewProdDetail, `Versao: ${data.deployed?.gitSha?.slice(0, 7) || 'UNKNOWN'} · ${formatDate(data.deployed?.deployedAt) || 'data desconhecida'}`);
  setOverviewDetail(els.overviewDevDetail, `HEAD: ${head.sha?.slice(0, 7) || 'UNKNOWN'} · ${head.branch || 'branch desconhecida'}`);
  setOverviewDetail(els.overviewCiDetail, `Checks: ${data.requiredChecks?.length || 0} · ${ciState}`);
  setOverviewCard(
    els.overviewDev,
    !data.deployed?.gitSha || !head.sha ? 'warn' : candidateDiffers ? 'warn' : 'ok',
    !data.deployed?.gitSha || !head.sha ? 'UNKNOWN' : candidateDiffers ? 'Nova versao' : 'Alinhado com PROD',
  );
  setOverviewCard(els.overviewCi, ciState === 'VERDE' ? 'ok' : ciState === 'FALHANDO' ? 'bad' : 'warn', ciState);

  const badgeState = recovery.active || !data.gitAvailable ? 'bad' : gate.allowed ? 'ok' : 'warn';
  els.releaseBadge.className = `chip chip--${badgeState}`;
  els.releaseBadge.textContent = recovery.active
    ? 'Recovery manual'
    : !data.gitAvailable ? 'Sem git'
    : gate.allowed ? 'Liberado' : `${gate.blockers.length} impedimento(s)`;

  const releaseState = releaseStateForDisplay(data, gate);
  const history = data.history || { events: [] };
  renderRecentOperations(history);
  const lastDeploy = history.lastDeploy;
  const backup = statusSnapshot?.backup || lastDeploy?.backup;
  const gateStatus = (label, tone, value) =>
    `<span class="release-summary-gate"><span>${label}</span><strong class="status-${tone}">${value}</strong></span>`;
  els.releaseSummary.innerHTML = [
    `<div class="release-summary-state"><span>Decisao de release</span><strong class="status-${releaseState.tone}">${releaseState.label}</strong><small>${gate.blockers?.length || 0} impedimento(s) · ${gate.warnings?.length || 0} aviso(s)</small></div>`,
    `<div class="release-summary-version"><span>PROD</span><code>${escapeHtml(data.deployed?.gitSha?.slice(0, 7) || 'UNKNOWN')}</code></div>`,
    `<div class="release-summary-version"><span>CANDIDATO</span><code>${escapeHtml(head.sha?.slice(0, 7) || 'UNKNOWN')}</code></div>`,
    `<div class="release-summary-version"><span>ANTERIOR</span><code>${escapeHtml(data.rollback?.gitSha?.slice(0, 7) || '—')}</code></div>`,
    `<div class="release-summary-gates">${[
      gateStatus('Git', data.headOnOriginMain && !data.workingTreeDirty ? 'ok' : 'bad', data.headOnOriginMain && !data.workingTreeDirty ? 'OK' : 'VERIFICAR'),
      gateStatus('CI', ciState === 'VERDE' ? 'ok' : ciState === 'FALHANDO' ? 'bad' : 'warn', ciState),
      gateStatus('Migration', migrations.length ? 'warn' : 'ok', migrations.length ? `${migrations.length} DETECTADA(S)` : 'NENHUMA'),
      gateStatus('Backup', backup ? 'ok' : 'warn', backup ? 'DISPONIVEL' : 'UNKNOWN'),
      gateStatus('Recovery', recovery.active ? 'bad' : 'ok', recovery.active ? 'ATIVO' : 'INATIVO'),
    ].join('')}</div>`,
    lastDeploy ? `<div class="release-summary-last"><span>Ultima release</span><strong>${escapeHtml(lastDeploy.gitShortSha || lastDeploy.gitSha || '?').slice(0, 7)} · ${escapeHtml(lastDeploy.result || 'UNKNOWN')}</strong><small>${escapeHtml(formatDate(lastDeploy.finishedAt) || 'data desconhecida')}${lastDeploy.durationSeconds == null ? '' : ` · ${lastDeploy.durationSeconds}s`}</small></div>` : '',
  ].join('');

  setOverviewCard(els.overviewRelease, releaseState.tone, releaseState.label);
  setOverviewDetail(els.overviewReleaseDetail, `${gate.blockers?.length || 0} impedimento(s) · recovery ${recovery.active ? 'ativo' : 'inativo'}`);
  els.releaseMetrics.hidden = !releaseDetailsVisible && !recovery.active;
  els.releaseDetails.textContent = releaseDetailsVisible ? 'Ocultar detalhes' : 'Detalhes de release';
  els.releaseDetails.setAttribute('aria-expanded', String(releaseDetailsVisible || recovery.active));
  releaseSection?.classList.toggle('release-details', releaseDetailsVisible || recovery.active);

  els.prepareRelease.hidden = recovery.active;
  els.prepareRelease.disabled = recovery.active || !data.gitAvailable;
  if (recovery.active) els.releaseFlow.hidden = true;

  const publicado = data.deployed?.gitSha
    ? `<code>${escapeHtml(data.deployed.gitSha)}</code> <span class="status-muted">${formatDate(data.deployed.deployedAt)}</span>`
    : '<span class="status-muted">Nenhum manifest em prod-artifacts</span>';

  const local = head.sha
    ? `<code>${escapeHtml(head.sha.slice(0, 7))}</code> ${escapeHtml((head.message || '').slice(0, 52))}<br>` +
      `<span class="status-muted">${escapeHtml(head.branch || '?')} · ${escapeHtml(head.author || '')}</span>`
    : '<span class="status-muted">—</span>';

  const recoveryRows = recovery.active
    ? [
        row('Recovery', '<span class="status-bad">INTERVENCAO MANUAL NECESSARIA</span>'),
        row('Fase da falha', `<code>${escapeHtml(recovery.failurePhase || 'UNKNOWN')}</code>`),
        row('Release anterior', `<code>${escapeHtml(recovery.previousRelease?.gitSha || '?')}</code>`),
        row('Release candidata', `<code>${escapeHtml(recovery.candidateRelease?.gitSha || '?')}</code>`),
        row('Migration', `${recovery.migration?.started ? 'iniciada' : 'nao iniciada'} / ${recovery.migration?.completed ? 'concluida' : 'nao concluida'}`),
        row('Swap', `${recovery.swap?.started ? 'iniciado' : 'nao iniciado'} / ${recovery.swap?.completed ? 'concluido' : 'nao concluido'}`),
        row('Watchdog', recovery.watchdog?.paused ? '<span class="status-bad">pausado por seguranca</span>' : 'estado nao informado'),
        row('Backup associado', escapeHtml(recovery.backup?.name || 'nao informado')),
        row('Falhou em', escapeHtml(formatDate(recovery.failedAt) || 'nao informado')),
        row('Resumo', escapeHtml(recovery.failureReason || 'Consulte o log do deploy.')),
      ]
    : [];

  els.releaseMetrics.innerHTML = [
    ...recoveryRows,
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
  const visibleItems = items.slice(0, 2);
  const hiddenCount = items.length - visibleItems.length;
  if (hiddenCount > 0 && !releaseDetailsVisible) {
    visibleItems.push(releaseItem('warn', '…', `Mais ${hiddenCount} sinal(is). Abra Detalhes de release para investigar.`));
  } else if (releaseDetailsVisible) {
    visibleItems.push(...items.slice(2));
  }
  els.releaseGate.innerHTML = visibleItems.join('');

  const commits = data.pending || [];
  els.releaseCommits.innerHTML = commits.length
    ? commits.map((c) => {
        const pr = c.pr
          ? `<a href="${c.pr.url}" target="_blank" rel="noopener">#${c.pr.number}</a>`
          : '<span class="status-muted">sem PR</span>';
        return row(
          `<code>${escapeHtml(c.shortSha)}</code> ${escapeHtml((c.message || '').slice(0, 46))}`,
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

  if (history.corrupted) {
    els.releaseHistory.innerHTML = '<div class="metric-row"><span class="status-warn">Histórico ilegível; o deploy continua disponível. Preserve o arquivo para análise.</span></div>';
  } else if (!history.events?.length) {
    els.releaseHistory.innerHTML = '<div class="metric-row"><span class="status-muted">Sem histórico registrado.</span></div>';
  } else {
    const eventLabel = (event) => {
      const sha = event.type === 'DEPLOY' ? (event.gitShortSha || event.gitSha || '?') : (event.restoredGitSha || '?');
      return `${event.type === 'DEPLOY' ? 'Deploy' : 'Rollback'} <code>${escapeHtml(String(sha).slice(0, 7))}</code>`;
    };
    const eventValue = (event) => {
      const result = escapeHtml(event.result || '—');
      const duration = event.durationSeconds == null ? '' : ` · ${escapeHtml(String(event.durationSeconds))}s`;
      return `<span class="status-${event.result === 'SUCCESS' ? 'ok' : event.result === 'RECOVERY_REQUIRED' ? 'bad' : 'warn'}">${result}</span> · ${escapeHtml(formatDate(event.finishedAt) || 'data não informada')}${duration} · smoke ${escapeHtml(event.smoke || 'NOT_RUN')}`;
    };
    els.releaseHistory.innerHTML = history.events.slice(0, 5).map((event) => row(eventLabel(event), eventValue(event))).join('');
  }

  els.rollbackHint.innerHTML = data.rollback?.available
    ? `Rollback volta para <code>${escapeHtml(data.rollback.gitSha || '?')}</code> (${escapeHtml((data.rollback.parts || []).join(', ') || 'artefatos salvos')}). <strong>Nao reverte banco.</strong>`
    : 'Rollback fica disponivel depois do primeiro deploy que preserva <code>prod-artifacts.previous</code>.';

  renderDeployPlaybook(data, gate);
  applyReleaseToButtons();
  renderGlobalState();
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
  statusSnapshot = data;
  const p = data.prod;
  const d = data.dev;
  const i = data.infra;
  const recoveryActive = Boolean(p.recovery?.active);

  const prodOk = !recoveryActive && p.ready && p.health && p.frontend;
  els.prodBadge.className = `chip chip--${prodOk ? 'ok' : 'bad'}`;
  els.prodBadge.textContent = recoveryActive ? 'Recovery manual' : prodOk ? 'Saudavel' : 'Com problemas';
  document.getElementById('btnRestart').disabled = recoveryActive;

  els.prodMetrics.innerHTML = [
    ...(recoveryActive
      ? [row('Recovery', `<span class="status-bad">INTERVENCAO MANUAL NECESSARIA (${escapeHtml(p.recovery.failurePhase || 'UNKNOWN')})</span>`)]
      : []),
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

  setOverviewCard(els.overviewProd, recoveryActive ? 'bad' : prodOk ? 'ok' : 'bad', recoveryActive ? 'RECOVERY' : prodOk ? 'SAUDAVEL' : 'DEGRADADO');
  setOverviewDetail(els.overviewInfraDetail, `${infraOk ? 'Watchdog e painel ativos' : 'Sinal local parcial'}`);
  setOverviewCard(els.overviewInfra, infraOk ? 'ok' : 'warn', infraOk ? 'OK' : 'ATENCAO');
  renderServices(data);
  refreshAlerts(i.alertPoller);
  renderGlobalState();

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
  refreshJourney();
});

document.getElementById('btnJourneySearch').addEventListener('click', refreshJourney);

els.investigate?.addEventListener('click', () => {
  const target = document.querySelector(els.investigate.dataset.target || '#observabilitySection');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

els.stateDetails?.addEventListener('click', () => {
  const target = document.querySelector(els.investigate?.dataset.target || '#releaseSection');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('[data-quick-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.quickAction;
    const actionMap = {
      refresh: 'btnRefresh',
      restart: 'btnRestart',
      'dev-start': 'btnDevStart',
      'dev-stop': 'btnDevStop',
      backup: 'btnBackupDb',
      sync: 'btnSyncProdDev',
    };
    if (action === 'logs') {
      const logs = document.getElementById('logsSection');
      logs.open = true;
      logs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    document.getElementById(actionMap[action])?.click();
  });
});

document.getElementById('btnRestart').addEventListener('click', () => {
  if (!confirm('Reiniciar a API de producao (:3001)?')) return;
  postActionStream('/api/prod/restart', {}, 'Reiniciar API prod');
});

document.getElementById('btnReleaseRefresh').addEventListener('click', () => {
  refreshRelease();
});

els.prepareRelease.addEventListener('click', () => {
  els.releaseFlow.hidden = false;
  releaseDetailsVisible = true;
  if (release) renderRelease(release);
  els.releaseFlow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.deployConfirm.focus();
});

els.releaseDetails.addEventListener('click', () => {
  releaseDetailsVisible = !releaseDetailsVisible;
  if (release) renderRelease(release);
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
  els.opsPanelSubtitle.textContent = 'Control Center';
  els.opsPanelLiveBadge.textContent = 'AO VIVO';
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
const journeyNow = new Date();
const journeyLocal = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
els.journeyFrom.value = journeyLocal(new Date(journeyNow.getTime() - 24 * 60 * 60_000));
els.journeyTo.value = journeyLocal(journeyNow);
els.journeyPrev.addEventListener('click', () => renderJourney(journeyEvents, journeyPage - 1));
els.journeyNext.addEventListener('click', () => renderJourney(journeyEvents, journeyPage + 1));
initSession()
  .then(() => loadOpsPanelMeta())
  .then(() => {
    refreshStatus().catch(showError);
    loadLogCatalog().catch(showError);
    refreshRelease();
    refreshJourney();
  })
  .catch(showError);
setInterval(() => refreshStatus().catch(() => {}), 30_000);
