const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR') : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
/** "feat(deploy): migrations na esteira (#127)" → "migrations na esteira" */
const plain = (subject) =>
  String(subject ?? '')
    .replace(/^\w+(\([^)]*\))?!?:\s*/, '')
    .replace(/\s*\(#\d+\)$/, '');

const SIMPLE_CONFIRM = {
  'dev.stop': {
    title: 'Desligar o ambiente de testes?',
    body: 'O ambiente de testes deste PC será desligado. O site dos clientes não é afetado.',
  },
  'dev.restart': {
    title: 'Reiniciar o ambiente de testes?',
    body: 'O ambiente de testes deste PC será desligado e ligado de novo (cerca de 30 segundos). O site dos clientes não é afetado.',
  },
  'dev.sync': {
    title: 'Trazer a versão oficial para o ambiente de testes?',
    body: 'O ambiente de testes deste PC recebe a versão oficial mais recente: o código é atualizado, as mudanças no banco de testes são aplicadas e ele reinicia (1 a 3 minutos). O site dos clientes não é afetado.',
  },
  'pr.update': {
    title: 'Atualizar o PR?',
    body: 'O PR recebe as últimas mudanças da versão oficial e os testes automáticos rodam de novo (1 a 3 minutos). Quando passarem, aparece o botão para aceitar. Nada muda para os clientes.',
  },
  'deploy.reject': {
    title: 'Não publicar agora?',
    body: 'A nova versão não será publicada. O site dos clientes continua exatamente como está. Se mudar de ideia, o painel mostra o botão "Publicar a versão mais recente".',
  },
};

const COPY_WORD = 'COPIAR';
const CI_TEXT = { success: 'testes ok', failure: 'testes falharam', pending: 'testando…', none: 'sem testes' };
const DEPLOY_RESULT = { ok: 'publicada', 'rolled-back': 'falhou e voltou à anterior' };

let state = null;
let uiBuild = null;
let loading = false;
let auditPage = 1;
const registry = new Map();
let seq = 0;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-ops-panel': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function control(action) {
  if (!action || action.info) return '';
  if (action.href) {
    return `<a class="btn${action.primary ? ' primary' : ''}" href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>`;
  }
  const id = `a${++seq}`;
  registry.set(id, action);
  return `<button type="button" class="${action.primary ? 'primary' : ''}" data-action="${id}">${esc(action.label)}</button>`;
}

/** "V855 (89e7d42)" → V855 com o código técnico pequeno ao lado. */
const withHash = (text) => esc(text).replace(/ \(([0-9a-f]{7})\)/g, ' <small class="hash">$1</small>');
const versionTag = (version, short) =>
  version && version !== short
    ? `<strong class="ver">${esc(version)}</strong> <small class="hash">${esc(short)}</small>`
    : `<code>${esc(short)}</code>`;

const facts = (list) =>
  list?.length ? `<dl>${list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${withHash(v)}</dd>`).join('')}</dl>` : '';

function compareLists(lists) {
  if (!lists) return '';
  const block = (title, items) =>
    items.length
      ? `<h3>${esc(title)}</h3><ul class="rows">${items
          .map((c) => `<li><span>${versionTag(c.version, c.sha.slice(0, 7))} ${esc(plain(c.subject))}</span></li>`)
          .join('')}</ul>`
      : '';
  return (
    block('Só no site (o ambiente de testes ainda não tem)', lists.prdOnly) +
    block('Só no ambiente de testes (ainda não está no site)', lists.devOnly)
  );
}

function area(id, title, card, extra = '') {
  $(`card-${id}`).innerHTML = `
    <header>
      <h2 id="h-${id}">${esc(title)}</h2>
      <span class="badge" data-level="${esc(card.level)}">${esc(card.title)}</span>
    </header>
    <p class="sub">${esc(card.subtitle)}</p>
    ${facts(card.facts)}
    ${extra}
    ${card.actions?.length ? `<div class="actions">${card.actions.map(control).join('')}</div>` : ''}`;
}

function prList(prs) {
  if (!prs?.length) return '<h3>Pedidos de mudança (PRs)</h3><p class="empty">Nenhum PR aberto.</p>';
  return `<h3>Pedidos de mudança (PRs)</h3><ul class="rows">${prs
    .map(
      (pr) => `<li>
        <a href="${esc(pr.url)}" target="_blank" rel="noopener" title="Abrir no GitHub">#${pr.number} ${esc(plain(pr.title))}</a>
        <span class="chip" data-ci="${esc(pr.ci)}">${esc(pr.ciLabel)}</span>
        ${pr.isDraft ? '<span class="chip">rascunho</span>' : ''}
        ${pr.behind ? '<span class="chip" data-level="warn" title="Feito sobre uma versão oficial antiga">desatualizado</span>' : ''}
        ${pr.mergeable === 'CONFLICTING' ? '<span class="chip" data-ci="failure">com conflito</span>' : ''}
        ${control(pr.action)}
      </li>`,
    )
    .join('')}</ul>`;
}

function runList(runs) {
  if (!runs?.length) return '<h3>Últimas passagens pela esteira</h3><p class="empty">Nenhuma ainda.</p>';
  return `<h3>Últimas passagens pela esteira</h3><ul class="rows">${runs
    .map(
      (r) => `<li>
        <a href="${esc(r.url)}" target="_blank" rel="noopener" title="Abrir no GitHub">${versionTag(r.version, r.short)} ${esc(plain(r.title))}</a>
        <span class="chip" data-run="${esc(r.rejected ? 'rejected' : (r.conclusion ?? r.status))}">${esc(r.label)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function deployList(card) {
  const rows = card.deploys?.length
    ? `<h3>Últimas publicações</h3><ul class="rows">${card.deploys
        .map(
          (d) => `<li><span>${versionTag(d.version, String(d.sha).slice(0, 7))} ${esc(when(d.at))}</span>
            <span class="chip" data-run="${d.result === 'ok' ? 'success' : 'failure'}">${esc(DEPLOY_RESULT[d.result] ?? d.result)}</span></li>`,
        )
        .join('')}</ul>`
    : '';
  return `${rows}<p class="links"><a href="${esc(card.url)}" target="_blank" rel="noopener">Abrir o site dos clientes</a></p>`;
}

/* ---------- infraestrutura do servidor (cartão Site dos clientes) ---------- */

const pctText = (n) => (n == null ? '—' : `${n < 1 && n > 0 ? n.toLocaleString('pt-BR') : Math.round(n)}%`);

/** Mini-gráfico da última hora; a escala acompanha o pico para variações pequenas aparecerem. */
function spark(values) {
  if (values.length < 2) return '<span class="spark-empty">gráfico após alguns minutos</span>';
  const top = Math.max(5, ...values) * 1.15;
  const step = 100 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(30 - (v / top) * 28).toFixed(1)}`).join(' ');
  const title = `Última hora: mínimo ${pctText(Math.min(...values))}, máximo ${pctText(Math.max(...values))}`;
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
    <polygon points="0,30 ${points} 100,30"/><polyline points="${points}"/></svg>`;
}

function gauge(g) {
  const r = 30;
  const length = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, g.pct ?? 0)) / 100) * length;
  return `<figure class="gauge" data-level="${esc(g.level)}">
    <div class="ring">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="track" cx="36" cy="36" r="${r}"/>
        <circle class="fill" cx="36" cy="36" r="${r}" stroke-dasharray="${filled.toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 36 36)"/>
      </svg>
      <span>${pctText(g.pct)}</span>
    </div>
    <figcaption><strong>${esc(g.label)}</strong><span>${esc(g.detail)}</span></figcaption>
    ${g.id === 'disk' ? '' : spark(g.series)}
  </figure>`;
}

const meter = (label, pct, value) =>
  `<span class="meter"><span>${esc(label)}</span><span class="bar"><i style="width:${Math.min(100, Math.max(pct ? 1.5 : 0, pct ?? 0))}%"></i></span><span>${esc(value)}</span></span>`;

function containerCard(c) {
  const foot = [
    c.upText,
    c.net ? `rede ↓ ${c.net.rx} ↑ ${c.net.tx}` : null,
    c.restarts ? `reiniciou ${c.restarts}×` : null,
  ].filter(Boolean);
  return `<li class="ctr" data-level="${esc(c.level)}" title="${esc(c.image)}">
    <div class="ctr-head">
      <span class="ctr-dot" aria-hidden="true"></span>
      <strong>${esc(c.label)}</strong>
      <span class="chip" data-level="${esc(c.level)}">${esc(c.statusText)}</span>
    </div>
    <p class="ctr-role">${esc(c.role)} · <code>${esc(c.name)}</code></p>
    ${c.memBytes == null ? '' : `<div class="meters">${meter('CPU', c.cpuPct, pctText(c.cpuPct))}${meter('Memória', c.memPct, c.memText)}</div>`}
    <p class="ctr-foot">${foot.map(esc).join(' · ')}</p>
  </li>`;
}

const BACKUP_KIND_LEVEL = { daily: 'ok', deploy: 'run', other: '' };

function backupButton(action, label, className = '', blocked = '') {
  if (blocked) return `<button type="button" class="${className}" disabled title="${esc(blocked)}">${esc(label)}</button>`;
  const id = `a${++seq}`;
  registry.set(id, action);
  return `<button type="button" class="${className}" data-action="${id}">${esc(label)}</button>`;
}

function backupRow(b, manage) {
  const actions = manage
    ? `<td><span class="bk-actions">${backupButton({ name: 'backup.download', confirm: 'backup-download', backup: b }, 'Baixar', '', b.canDownload ? '' : 'nome fora do padrão')}${backupButton({ name: 'backup.delete', confirm: 'backup-delete', backup: b }, 'Apagar', 'danger', b.canDelete ? '' : b.deleteBlock)}</span></td>`
    : '';
  return `<tr${b.newest ? ' data-newest' : ''}>
    <td><code>${esc(b.name)}</code>${b.newest ? ' <span class="chip" data-level="ok">mais recente</span>' : ''}</td>
    <td>${esc(when(b.at))}</td>
    <td><span class="chip" data-level="${esc(BACKUP_KIND_LEVEL[b.kind] ?? '')}">${esc(b.kindText)}</span></td>
    <td class="num">${esc(b.sizeText)}</td>
    <td>${b.checked ? `<span class="chip" data-level="ok" title="sha256 ${esc(b.sha256)}">íntegro</span>` : '<span class="chip" data-level="warn" title="Sem o arquivo .sha256: o backup pode estar incompleto">sem conferência</span>'}</td>
    ${actions}
  </tr>`;
}

const backupRows = (backups) =>
  backups.items.length
    ? backups.items.map((b) => backupRow(b, backups.manage)).join('')
    : `<tr><td colspan="${backups.manage ? 6 : 5}" class="empty">Nenhum backup na pasta do servidor.</td></tr>`;

function backupsBlock(backups) {
  if (!backups) return '';
  return `<div class="infra-backups">
    <h3>Backups do banco <small data-infra="backups-summary">${esc(backups.summary)}</small></h3>
    <p class="hint">Pasta de backups do Postgres no servidor. São feitos todo dia e antes de cada publicação; o servidor apaga sozinho os mais antigos e manda uma cópia para o OneDrive.${backups.manage ? '' : ' Para baixar ou apagar por aqui, quem desenvolve precisa configurar a chave de backups neste PC.'}</p>
    <div class="bk-wrap"><table class="bk">
      <thead><tr><th>Arquivo</th><th>Feito em</th><th>Tipo</th><th class="num">Tamanho</th><th>Conferência</th>${backups.manage ? '<th></th>' : ''}</tr></thead>
      <tbody data-infra="backups">${backupRows(backups)}</tbody>
    </table></div>
  </div>`;
}

function infraBlock(card, below = '') {
  if (!card.infra) return below;
  const tiles = card.tiles
    .map(
      (t) => `<li data-level="${esc(t.level)}"><span>${esc(t.label)}</span><strong>${esc(t.value)}</strong><small>${esc(t.note)}</small></li>`,
    )
    .join('');
  const { infra } = card;
  return `<div class="infra">
    <div class="infra-server">
      <h3>Resumo</h3>
      <ul class="tiles">${tiles}</ul>
      <h3>Servidor na Hostinger</h3>
      <p class="spec" data-infra="spec">${esc(infra.spec)}</p>
      <div class="gauges" data-infra="gauges">${infra.gauges.map(gauge).join('')}</div>
      ${below}
    </div>
    <div class="infra-containers">
      <h3>Contêineres <small data-infra="summary">${esc(infra.summary)}</small></h3>
      <ul class="ctrs" data-infra="containers">${infra.containers.map(containerCard).join('')}</ul>
    </div>
    ${backupsBlock(infra.backups)}
  </div>`;
}

/** Troca só servidor e contêineres; o resto da tela segue no ritmo do painel. */
function patchInfra(infra) {
  const box = document.querySelector('#card-prd .infra');
  if (!box || !state?.cards.prd.infra) return;
  state.cards.prd.infra = infra;
  const parts = {
    spec: esc(infra.spec),
    gauges: infra.gauges.map(gauge).join(''),
    summary: esc(infra.summary),
    containers: infra.containers.map(containerCard).join(''),
  };
  if (infra.backups) {
    parts['backups-summary'] = esc(infra.backups.summary);
    parts.backups = backupRows(infra.backups);
  }
  for (const [key, html] of Object.entries(parts)) {
    const el = box.querySelector(`[data-infra="${key}"]`);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }
}

const INFRA_REFRESH_MS = 30_000;
let infraLoading = false;
async function refreshInfra() {
  if (infraLoading || document.hidden || !state?.cards.prd.infra) return;
  infraLoading = true;
  try {
    patchInfra((await api('/api/infra')).infra);
  } catch {
    // silencioso: a atualização geral do painel mostra se o servidor parou de responder
  } finally {
    infraLoading = false;
  }
}
setInterval(refreshInfra, INFRA_REFRESH_MS);

const FLOW_ICON = { done: '✓', waiting: '!', failed: '✕', rejected: '–', cancelled: '–', skipped: '–' };

function jobBox(job) {
  const pct = job.progress ? Math.round((100 * job.progress.done) / job.progress.total) : 0;
  return `<a class="job" data-status="${esc(job.status)}" data-level="${esc(job.level)}" href="${esc(job.url)}" target="_blank" rel="noopener" title="Abrir esta etapa no GitHub">
    <span class="job-icon" aria-hidden="true">${FLOW_ICON[job.status] ?? ''}</span>
    <span class="job-body">
      <strong>${esc(job.label)}</strong>
      ${job.desc ? `<span class="job-desc">${esc(job.desc)}</span>` : ''}
      <span class="job-status">${esc(job.statusText)}${job.time ? ` · ${esc(job.time)}` : ''}</span>
      ${job.progress ? `<span class="job-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></span>` : ''}
    </span>
  </a>`;
}

function renderFlow(flow) {
  $('flow').hidden = !flow;
  if (!flow) return;
  const took = flow.total ? ` · ${flow.live ? 'rodando há' : 'levou'} ${esc(flow.total)}` : '';  $('h-flow').textContent = flow.live ? 'Esteira por dentro (agora)' : 'Esteira por dentro (última passagem)';
  $('flow-meta').innerHTML = `<span class="chip" data-level="${esc(flow.level)}">${esc(flow.label)}</span>
    versão ${versionTag(flow.version, flow.sha)} · ${esc(plain(flow.title))} · ${esc(flow.trigger)} · ${esc(when(flow.startedAt))}${took}`;
  $('flow-link').href = flow.url;
  $('flow-graph').innerHTML = flow.columns
    .map((column) => `<div class="flow-col${column.length > 1 ? ' group' : ''}">${column.map(jobBox).join('')}</div>`)
    .join('<span class="flow-pipe" aria-hidden="true"></span>');
}

function render(data) {
  const previous = state;
  state = data;
  registry.clear();
  $('updated').textContent = `${data.moving ? 'ao vivo · ' : ''}atualizado às ${time(data.at)}`;
  $('live').dataset.mode = data.moving ? 'fast' : 'idle';
  document.title = data.verdict.level === 'warn' || data.verdict.level === 'bad' ? '(!) Tap Quiver Ops' : 'Tap Quiver Ops';
  if (previous && previous.verdict.text !== data.verdict.text) {
    const box = $('verdict');
    box.classList.remove('changed');
    void box.offsetWidth;
    box.classList.add('changed');
  }

  $('verdict').dataset.level = data.verdict.level;
  $('verdict-text').textContent = data.verdict.text;
  $('verdict-help').textContent = data.verdict.help ?? '';
  $('verdict-extra').innerHTML = data.verdict.extra.map((t) => `<li>Também: ${esc(t)}</li>`).join('');

  const next = data.next;
  $('next-box').hidden = !next;
  $('next').innerHTML = control(next);
  $('next-explain').textContent = next ? (next.info ? next.label : (next.explain ?? '')) : '';

  $('line').innerHTML = data.delivery.steps
    .map(
      (s, i) => `<li data-status="${esc(s.status)}" title="${esc(s.hint)}">
        <span class="station" aria-hidden="true">${s.status === 'done' ? '✓' : i + 1}</span>
        <strong>${esc(s.label)}</strong>
        <span class="detail">${esc(s.detail)}</span>
      </li>`,
    )
    .join('');
  $('line-hint').textContent = data.delivery.activeHint ?? '';
  renderFlow(data.flow);

  area('git', 'Código', data.cards.git, prList(data.cards.git.prs));
  area('dev', 'Ambiente de testes', data.cards.dev, compareLists(data.cards.dev.compare));
  area('pipeline', 'Esteira', data.cards.pipeline, runList(data.cards.pipeline.runs));
  area('prd', 'Site dos clientes', data.cards.prd, infraBlock(data.cards.prd, deployList(data.cards.prd)));
  $('card-prd').classList.toggle('wide', Boolean(data.cards.prd.infra));

  if (data.audit) renderAudit(data.audit);
}

function renderAudit(audit) {
  auditPage = audit.page;
  $('audit').innerHTML = audit.items.length
    ? audit.items
        .map(
          (e) =>
            `<li data-ok="${e.ok}"><time>${esc(when(e.at))}</time> <span>${e.ok ? esc(e.message) : `<strong>${esc(e.label)}</strong>: não deu certo. ${esc(e.message)}`}</span></li>`,
        )
        .join('')
    : '<li class="empty">Nenhuma ação ainda.</li>';
  $('audit-pager').hidden = audit.pages <= 1;
  $('audit-newer').disabled = audit.page <= 1;
  $('audit-older').disabled = audit.page >= audit.pages;
  $('audit-page').textContent = `Página ${audit.page} de ${audit.pages} · ${audit.total} ações`;
}

async function goToAuditPage(page) {
  try {
    renderAudit(await api(`/api/audit?page=${page}`));
  } catch (error) {
    toast(`Não foi possível abrir o histórico: ${error.message}`, false);
  }
}

$('audit-newer').addEventListener('click', () => goToAuditPage(auditPage - 1));
$('audit-older').addEventListener('click', () => goToAuditPage(auditPage + 1));

async function refresh(force = false) {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  try {
    const askedPage = auditPage;
    const data = await api(`/api/state?auditPage=${askedPage}${force ? '&force=1' : ''}`);
    if (askedPage !== auditPage) data.audit = null;
    // A tela foi atualizada no PC: recarrega para não mostrar dados novos com código velho.
    if (uiBuild && data.ui && data.ui !== uiBuild && !modal.open) {
      location.reload();
      return;
    }
    uiBuild ??= data.ui;
    render(data);
  } catch (error) {
    $('updated').textContent = `sem resposta do painel: ${error.message}`;
    $('live').dataset.mode = 'off';
  } finally {
    loading = false;
    $('refresh').disabled = false;
  }
}

function toast(message, ok = true) {
  const el = $('toast');
  el.textContent = message;
  el.dataset.ok = ok;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 9000);
}

/* ---------- confirmações ---------- */

const modal = $('modal');
let onConfirm = null;

function openModal(title, body, confirmLabel, handler) {
  $('modal-body').onchange = null;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = body;
  $('modal-error').hidden = true;
  const confirm = $('modal-confirm');
  confirm.textContent = confirmLabel;
  confirm.disabled = !handler;
  onConfirm = handler;
  if (!modal.open) modal.showModal();
}

function setModalBody(html, handler) {
  $('modal-body').innerHTML = html;
  onConfirm = handler;
  $('modal-confirm').disabled = !handler;
}

$('modal-confirm').addEventListener('click', async () => {
  if (!onConfirm) return;
  const button = $('modal-confirm');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Executando…';
  try {
    await onConfirm();
    modal.close();
  } catch (error) {
    $('modal-error').textContent = `Não deu certo: ${error.message}`;
    $('modal-error').hidden = false;
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
});

const list = (items, render, empty = 'Nenhuma.') =>
  items.length ? `<ul class="plain">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`;
const commitList = (commits) => list(commits, (c) => esc(plain(c.subject)), 'Nenhuma mudança de código.');

function migrationsHtml(migrations, direction) {
  if (!migrations.length) return '<p class="note ok">Sem mudanças no banco de dados.</p>';
  const note =
    direction === 'rollback'
      ? 'Voltar a versão não desfaz mudanças já feitas no banco de dados. Se tiver dúvida, pergunte a quem desenvolve antes de confirmar.'
      : 'A esteira faz backup e ensaia essas mudanças numa cópia do banco antes de aplicar. Se tiver dúvida, pergunte a quem desenvolve antes de confirmar.';
  return `<h3>Mudanças no banco de dados (${migrations.length})</h3>
    ${list(migrations, (m) => `<code>${esc(m)}</code>`)}
    <p class="note warn">${note}</p>`;
}

function previewHtml(p, actionName) {
  const from = versionTag(p.fromVersion, p.from.slice(0, 7));
  const to = versionTag(p.toVersion, p.to.slice(0, 7));
  if (p.direction === 'rollback') {
    return `<p class="lead warn-text">O site dos clientes vai voltar da versão ${from} para a versão ${to}, mais antiga.</p>
      <h3>Estas mudanças saem do ar</h3>${commitList(p.commits)}
      ${migrationsHtml(p.migrations, 'rollback')}
      <p class="note">Ao confirmar, a esteira testa essa versão e, no fim, pede sua autorização aqui.</p>`;
  }
  const steps =
    actionName === 'deploy.approve'
      ? `<ol class="plain">
          <li>É feito um backup do banco de dados.</li>
          <li>A nova versão é instalada no servidor (1 a 3 minutos). Na troca, o site pode ficar alguns segundos sem responder.</li>
          <li>Se algo der errado, a esteira volta sozinha para a versão atual.</li>
        </ol>`
      : '<p class="note">Ao confirmar, a esteira testa de novo e, no fim, pede sua autorização aqui. Nada vai ao ar sem esse segundo clique.</p>';
  return `<p class="lead">O site dos clientes vai passar da versão ${from} para a versão ${to}.</p>
    <h3>O que muda</h3>${commitList(p.commits)}
    ${migrationsHtml(p.migrations, 'forward')}
    <h3>O que acontece ao confirmar</h3>${steps}`;
}

async function runAction(action, params = action.params) {
  const result = await api(`/api/actions/${action.name}`, { method: 'POST', body: { params } });
  toast(result.message);
  refresh(true);
}

async function handle(action, button) {
  if (!action) return;
  if (!action.confirm) {
    button.disabled = true;
    button.textContent = 'Executando…';
    try {
      await runAction(action);
    } catch (error) {
      toast(`Não deu certo: ${error.message}`, false);
      refresh(true);
    }
    return;
  }

  if (action.confirm === 'simple') {
    const text = SIMPLE_CONFIRM[action.name] ?? { title: `${action.label}?`, body: '' };
    openModal(text.title, `<p>${esc(text.body)}</p>`, action.label, () => runAction(action));
    return;
  }

  if (action.confirm === 'copy') {
    openModal(
      'Copiar o banco do site para o ambiente de testes?',
      `<p class="lead">O banco do ambiente de testes deste PC será <strong>substituído</strong> por uma cópia, feita agora, do banco do site.</p>
       <ol class="plain">
         <li>O servidor gera a cópia na hora, em segundos. O site dos clientes continua funcionando normalmente.</li>
         <li>O banco de testes atual é guardado antes; se algo falhar, ele volta sozinho.</li>
         <li>Na cópia, e-mail e notificações para celulares ficam desligados: ninguém de fora recebe nada.</li>
         <li>O ambiente de testes reinicia (cerca de 1 minuto).</li>
       </ol>
       <p class="note warn">A cópia tem dados reais de clientes. Use só para investigar e corrigir problemas, e não compartilhe.</p>
       <label class="typed">Para confirmar, digite <strong>${COPY_WORD}</strong> <input id="copy-word" autocomplete="off" spellcheck="false" /></label>`,
      'Copiar o banco',
      null,
    );
    const input = $('copy-word');
    input.addEventListener('input', () => {
      const ok = input.value.trim().toUpperCase() === COPY_WORD;
      onConfirm = ok ? () => runAction(action, { confirm: COPY_WORD }) : null;
      $('modal-confirm').disabled = !ok;
    });
    input.focus();
    return;
  }

  if (action.confirm === 'backup-download') {
    const b = action.backup;
    openModal(
      'Baixar o backup para este PC?',
      `<p class="lead"><code>${esc(b.name)}</code> · ${esc(b.sizeText)} · ${esc(when(b.at))} · ${esc(b.kindText)}</p>
       <ol class="plain">
         <li>O arquivo vem do servidor e é gravado na pasta <strong>Downloads</strong> deste PC.</li>
         <li>${b.checked ? 'Antes de liberar o arquivo, o painel confere se ele chegou idêntico ao do servidor (sha256).' : 'Esse backup não tem o arquivo de conferência no servidor: ele pode estar incompleto.'}</li>
         <li>Nada muda no servidor nem no site dos clientes.</li>
       </ol>
       <p class="note warn">O backup tem dados reais de clientes. Guarde com cuidado, não compartilhe e apague quando não precisar mais.</p>`,
      'Baixar',
      () => runAction(action, { name: b.name }),
    );
    return;
  }

  if (action.confirm === 'backup-delete') {
    const b = action.backup;
    openModal(
      'Apagar este backup do servidor?',
      `<p class="lead warn-text"><code>${esc(b.name)}</code> · ${esc(b.sizeText)} · ${esc(when(b.at))} · ${esc(b.kindText)}</p>
       <ol class="plain">
         <li>O arquivo é apagado da pasta de backups do servidor. <strong>Não dá para desfazer.</strong></li>
         <li>A cópia externa no OneDrive não é apagada.</li>
         <li>O servidor recusa apagar o backup mais recente, ficar com menos de 3 ou apagar durante uma publicação.</li>
       </ol>
       <label class="typed">Para confirmar, digite o nome do arquivo <input id="backup-word" autocomplete="off" spellcheck="false" /></label>`,
      'Apagar o backup',
      null,
    );
    const input = $('backup-word');
    input.addEventListener('input', () => {
      const ok = input.value.trim() === b.name;
      onConfirm = ok ? () => runAction(action, { name: b.name, confirm: b.name }) : null;
      $('modal-confirm').disabled = !ok;
    });
    input.focus();
    return;
  }

  if (action.confirm === 'merge') {
    const n = action.params.number;
    openModal(`Aceitar o PR #${n}?`, '<p class="hint">Carregando o pedido de mudança…</p>', 'Aceitar o PR', null);
    try {
      const pr = await api(`/api/preview/pr/${n}`);
      setModalBody(
        `<p class="lead"><a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number} ${esc(plain(pr.title))}</a></p>
         <p class="note ok">Testes automáticos: ${esc(CI_TEXT[pr.ci] ?? pr.ci)}.</p>
         <h3>Mudanças incluídas</h3>${commitList(pr.commits)}
         ${migrationsHtml(pr.migrations, 'forward')}
         <h3>O que acontece ao confirmar</h3>
         <ol class="plain">
           <li>A mudança entra na versão oficial do código.</li>
           <li>A esteira testa de novo e monta a nova versão (cerca de 2 minutos).</li>
           <li>Depois ela para e pede sua autorização aqui. <strong>Nada vai para os clientes agora.</strong></li>
         </ol>`,
        () => runAction(action),
      );
    } catch (error) {
      setModalBody(`<p class="error">${esc(error.message)}</p>`, null);
    }
    return;
  }

  if (action.confirm === 'deploy') {
    const sha = action.params?.sha;
    openModal(`${action.label}?`, '<p class="hint">Calculando o que muda para os clientes…</p>', action.label, null);
    try {
      setModalBody(previewHtml(await api(`/api/preview/deploy?to=${sha}`), action.name), () => runAction(action));
    } catch (error) {
      setModalBody(`<p class="error">${esc(error.message)}</p>`, null);
    }
    return;
  }

  if (action.confirm === 'rollback') {
    const options = state.recentMain
      .map(
        (c) => `<label class="pick">
          <input type="radio" name="sha" value="${esc(c.sha)}" ${c.isPrd ? 'disabled' : ''} />
          <span>${versionTag(c.version, c.short)} ${esc(when(c.date))} ${esc(plain(c.subject))} ${c.isPrd ? '<em>(no ar agora)</em>' : ''}</span>
        </label>`,
      )
      .join('');
    openModal(
      'Voltar para uma versão anterior',
      `<p class="note warn">Use só se o site ficou com problema logo depois de uma publicação.</p>
       <p>Escolha a versão para a qual quer voltar (a primeira da lista é a mais recente). Depois de confirmar, a esteira testa essa versão e pede sua autorização antes de publicar.</p>
       <div class="picks">${options}</div><div id="pick-preview"></div>`,
      'Iniciar a esteira',
      null,
    );
    $('modal-body').onchange = async (event) => {
      if (event.target.name !== 'sha') return;
      const sha = event.target.value;
      $('pick-preview').innerHTML = '<p class="hint">Calculando…</p>';
      $('modal-confirm').disabled = true;
      try {
        $('pick-preview').innerHTML = previewHtml(await api(`/api/preview/deploy?to=${sha}`), 'deploy.dispatch');
        onConfirm = () => runAction({ name: 'deploy.dispatch' }, { sha });
        $('modal-confirm').disabled = false;
      } catch (error) {
        $('pick-preview').innerHTML = `<p class="error">${esc(error.message)}</p>`;
      }
    };
  }
}

/* ---------- guia ---------- */

const guide = $('guide');
$('help').addEventListener('click', () => guide.showModal());
guide.addEventListener('close', () => localStorage.setItem('ops-guide-seen', '1'));
if (!localStorage.getItem('ops-guide-seen')) guide.showModal();

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handle(registry.get(button.dataset.action), button);
});
$('refresh').addEventListener('click', () => refresh(true));

// Atualização sozinha: rápida enquanto algo anda (testes, esteira), lenta quando está parado.
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!document.hidden && !modal.open) await refresh(false);
    schedule();
  }, state?.moving ? 5_000 : 15_000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh(false);
});
refresh(false).then(schedule);
