const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR') : '');

const ACTION_TEXT = {
  'dev.stop': 'Para a API :3002, o web :5202 e o supervisor do DEV. Postgres e Elasticsearch continuam no Docker.',
  'dev.restart': 'Para e sobe de novo a API :3002 e o web :5202 do DEV.',
  'deploy.reject': 'O run é encerrado sem publicar. Produção continua na versão atual.',
};

const CI_TEXT = { success: 'verde', failure: 'vermelho', pending: 'rodando', none: 'sem check' };

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
  if (!action) return '';
  if (action.info) return `<p class="hint">${esc(action.label)}</p>`;
  if (action.href) {
    return `<a class="btn${action.primary ? ' primary' : ''}" href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>`;
  }
  const id = `a${++seq}`;
  registry.set(id, action);
  return `<button type="button" class="${action.primary ? 'primary' : ''}" data-action="${id}">${esc(action.label)}</button>`;
}

const facts = (list) =>
  list?.length ? `<dl>${list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';

function area(id, title, card, extra = '') {
  $(`card-${id}`).innerHTML = `
    <header>
      <h2 id="h-${id}">${esc(title)}</h2>
      <span class="badge" data-level="${esc(card.level)}">${esc(card.title)}</span>
    </header>
    ${facts(card.facts)}
    ${extra}
    ${card.actions?.length ? `<div class="actions">${card.actions.map(control).join('')}</div>` : ''}`;
}

function prList(prs) {
  if (!prs?.length) return '<p class="empty">Nenhum PR aberto.</p>';
  return `<ul class="rows">${prs
    .map(
      (pr) => `<li>
        <a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number} ${esc(pr.title)}</a>
        <span class="chip" data-ci="${esc(pr.ci)}">CI ${esc(pr.ciLabel)}</span>
        ${pr.isDraft ? '<span class="chip">rascunho</span>' : ''}
        ${pr.mergeable === 'CONFLICTING' ? '<span class="chip" data-ci="failure">conflito</span>' : ''}
        ${control(pr.action)}
      </li>`,
    )
    .join('')}</ul>`;
}

function runList(runs) {
  if (!runs?.length) return '<p class="empty">Nenhum run da esteira ainda.</p>';
  return `<ul class="rows">${runs
    .map(
      (r) => `<li>
        <a href="${esc(r.url)}" target="_blank" rel="noopener"><code>${esc(r.short)}</code> ${esc(r.title)}</a>
        <span class="chip" data-run="${esc(r.conclusion ?? r.status)}">${esc(r.label)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function deployList(card) {
  const rows = card.deploys?.length
    ? `<ul class="rows">${card.deploys
        .map((d) => `<li><span><code>${esc(String(d.sha).slice(0, 7))}</code> ${esc(new Date(d.at).toLocaleString('pt-BR'))}</span><span class="chip" data-run="${d.result === 'ok' ? 'success' : 'failure'}">${esc(d.result)}</span></li>`)
        .join('')}</ul>`
    : '';
  return `${rows}<p class="links"><a href="${esc(card.url)}" target="_blank" rel="noopener">Abrir o site</a></p>`;
}

function render(data) {
  state = data;
  registry.clear();
  $('updated').textContent = `atualizado às ${time(data.at)}`;

  const verdict = $('verdict');
  verdict.dataset.level = data.verdict.level;
  $('verdict-text').textContent = data.verdict.text;
  $('verdict-extra').innerHTML = data.verdict.extra.map((t) => `<li>${esc(t)}</li>`).join('');
  $('next').innerHTML = control(data.next);

  $('line').innerHTML = data.delivery.steps
    .map(
      (s) => `<li data-status="${esc(s.status)}">
        <span class="station" aria-hidden="true"></span>
        <strong>${esc(s.label)}</strong>
        <span class="detail">${esc(s.detail)}</span>
      </li>`,
    )
    .join('');

  area('git', 'Git', data.cards.git, prList(data.cards.git.prs));
  area('dev', 'DEV', data.cards.dev);
  area('pipeline', 'Esteira', data.cards.pipeline, runList(data.cards.pipeline.runs));
  area('prd', 'Produção', data.cards.prd, deployList(data.cards.prd));

  $('audit').innerHTML = data.audit.length
    ? data.audit
        .map(
          (e) =>
            `<li data-ok="${e.ok}"><time>${esc(time(e.at))}</time> <span>${esc(e.ok ? e.message : `${e.label} falhou: ${e.message}`)}</span></li>`,
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
  toast.timer = setTimeout(() => (el.hidden = true), 7000);
}

/* ---------- modal ---------- */

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
    $('modal-error').textContent = error.message;
    $('modal-error').hidden = false;
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
});

const list = (items, render) => (items.length ? `<ul class="plain">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>` : '<p class="empty">Nenhum.</p>');

function previewHtml(p) {
  const head =
    p.direction === 'rollback'
      ? `<p class="warn-text">Produção volta de <code>${esc(p.from.slice(0, 7))}</code> para <code>${esc(p.to.slice(0, 7))}</code>. Estes commits saem:</p>`
      : `<p>Produção vai de <code>${esc(p.from.slice(0, 7))}</code> para <code>${esc(p.to.slice(0, 7))}</code>:</p>`;
  const migrations = p.migrations.length
    ? `<h3>Migrations (${p.migrations.length})</h3>${list(p.migrations, (m) => `<code>${esc(m)}</code>`)}
       <p class="hint">${p.direction === 'rollback'
         ? 'Rollback não desfaz migrations: o schema continua como está.'
         : 'A esteira ensaia numa cópia do banco antes de aplicar em produção. Migration destrutiva é bloqueada.'}</p>`
    : '<p class="hint">Sem migrations.</p>';
  return `${head}${list(p.commits, (c) => `<code>${esc(c.sha)}</code> ${esc(c.subject)}`)}${migrations}`;
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
      toast(error.message, false);
      refresh(true);
    }
    return;
  }

  if (action.confirm === 'simple') {
    openModal(`${action.label}?`, `<p>${esc(ACTION_TEXT[action.name] ?? '')}</p>`, action.label, () => runAction(action));
    return;
  }

  if (action.confirm === 'merge') {
    const label = `Mergear PR #${action.params.number}`;
    openModal(`${label}?`, '<p class="hint">Carregando o PR…</p>', label, null);
    try {
      const pr = await api(`/api/preview/pr/${action.params.number}`);
      setModalBody(
        `<p><a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number} ${esc(pr.title)}</a>, CI ${esc(CI_TEXT[pr.ci] ?? pr.ci)}</p>
         <h3>Commits</h3>${list(pr.commits, (c) => `<code>${esc(c.sha)}</code> ${esc(c.subject)}`)}
         <h3>Migrations</h3>${list(pr.migrations, (m) => `<code>${esc(m)}</code>`)}
         <p class="hint">Merge squash na main. Depois a esteira roda CI e build e para esperando sua aprovação.</p>`,
        () => runAction(action),
      );
    } catch (error) {
      setModalBody(`<p class="error">${esc(error.message)}</p>`, null);
    }
    return;
  }

  if (action.confirm === 'deploy') {
    const sha = action.params?.sha;
    openModal(action.label, '<p class="hint">Calculando o que vai para produção…</p>', action.label, null);
    try {
      setModalBody(previewHtml(await api(`/api/preview/deploy?to=${sha}`)), () => runAction(action));
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
          <code>${esc(c.short)}</code> ${esc(c.subject)} ${c.isPrd ? '<em>(em produção)</em>' : ''}
        </label>`,
      )
      .join('');
    openModal(
      'Publicar um commit da main',
      `<p>Escolha a versão. A esteira roda e para esperando sua aprovação.</p><div class="picks">${options}</div><div id="pick-preview"></div>`,
      'Disparar esteira',
      null,
    );
    $('modal-body').onchange = async (event) => {
      if (event.target.name !== 'sha') return;
      const sha = event.target.value;
      $('pick-preview').innerHTML = '<p class="hint">Calculando…</p>';
      $('modal-confirm').disabled = true;
      try {
        $('pick-preview').innerHTML = previewHtml(await api(`/api/preview/deploy?to=${sha}`));
        onConfirm = () => runAction({ name: 'deploy.dispatch' }, { sha });
        $('modal-confirm').disabled = false;
      } catch (error) {
        $('pick-preview').innerHTML = `<p class="error">${esc(error.message)}</p>`;
      }
    };
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handle(registry.get(button.dataset.action), button);
});
$('refresh').addEventListener('click', () => refresh(true));
setInterval(() => {
  if (!document.hidden && !modal.open) refresh(false);
}, 15_000);
refresh(false);
