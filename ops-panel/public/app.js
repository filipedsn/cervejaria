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

const CI_TEXT = { success: 'testes ok', failure: 'testes falharam', pending: 'testando…', none: 'sem testes' };
const DEPLOY_RESULT = { ok: 'publicada', 'rolled-back': 'falhou e voltou à anterior' };

let state = null;
let loading = false;
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
  document.title = data.verdict.level === 'warn' || data.verdict.level === 'bad' ? '(!) Quiver Tap Ops' : 'Quiver Tap Ops';
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
  area('prd', 'Site dos clientes', data.cards.prd, deployList(data.cards.prd));

  $('audit').innerHTML = data.audit.length
    ? data.audit
        .map(
          (e) =>
            `<li data-ok="${e.ok}"><time>${esc(when(e.at))}</time> <span>${esc(e.ok ? e.message : `${e.label}: não deu certo. ${e.message}`)}</span></li>`,
        )
        .join('')
    : '<li class="empty">Nenhuma ação ainda.</li>';
}

async function refresh(force = false) {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  try {
    render(await api(`/api/state${force ? '?force=1' : ''}`));
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
    return `<p class="lead warn-text">O site dos clientes vai voltar da versão <code>${from}</code> para a versão <code>${to}</code>, mais antiga.</p>
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
  return `<p class="lead">O site dos clientes vai passar da versão <code>${from}</code> para a versão <code>${to}</code>.</p>
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
