import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessibleName,
  createAuditSessionId,
  elementRole,
  isSearchField,
  roundVital,
  routeTemplate,
  vitalRating,
  type AuditElementLike,
} from '../src/lib/audit-journey.ts';
import { flushAuditEvents, flushPendingAuditAfterAuth, trackPageView } from '../src/lib/audit-tracker.ts';

function element(tagName: string, attributes: Record<string, string> = {}, extra: Partial<AuditElementLike> = {}): AuditElementLike {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (name) => attributes[name] ?? null,
    ...extra,
  };
}

test('routeTemplate troca uuid, cuid, hex, números e dígitos longos por :id', () => {
  assert.equal(routeTemplate('/operacao/comandas/123e4567-e89b-42d3-a456-426614174000'), '/operacao/comandas/:id');
  assert.equal(routeTemplate('/c/minha-cervejaria/p/cmsry9xrn0000hvlgopjxy0oo'), '/c/minha-cervejaria/p/:id');
  assert.equal(routeTemplate('/x/0123456789abcdef0123'), '/x/:id');
  assert.equal(routeTemplate('/comandas/42/editar'), '/comandas/:id/editar');
  assert.equal(routeTemplate('/evento/festa-1234567'), '/evento/:id');
  assert.equal(routeTemplate('/relatorios/2026?mes=10#topo'), '/relatorios/:id');
  assert.equal(routeTemplate('/cervejaria-2026/cardapio'), '/cervejaria-2026/cardapio');
  assert.equal(routeTemplate('/operacao/caixa'), '/operacao/caixa');
  assert.equal(routeTemplate('/'), '/');
});

test('nome acessível segue aria-label, title, texto visível, name e tag', () => {
  assert.equal(accessibleName(element('button', { 'aria-label': 'Fechar comanda' }, { innerText: 'X' })), 'Fechar comanda');
  assert.equal(accessibleName(element('a', { title: 'Ajuda' }, { innerText: '?' })), 'Ajuda');
  assert.equal(accessibleName(element('button', {}, { innerText: '  Abrir\n\n caixa  ' })), 'Abrir caixa');
  assert.equal(accessibleName(element('button', {}, { innerText: 'a'.repeat(200) })).length, 80);
  assert.equal(accessibleName(element('button', { name: 'salvar' }, { innerText: '' })), 'salvar');
  assert.equal(accessibleName(element('summary')), 'summary');
});

test('campos de formulário nunca usam o valor digitado como nome', () => {
  const labels = [{ innerText: 'Aceito os termos', textContent: 'Aceito os termos' }];
  assert.equal(accessibleName(element('input', { type: 'checkbox' }, { labels, innerText: 'ignorado' })), 'Aceito os termos');
  assert.equal(accessibleName(element('input', { placeholder: 'Buscar cliente' }, { textContent: 'segredo digitado' })), 'Buscar cliente');
  assert.equal(accessibleName(element('select', { name: 'categoria' }, { innerText: 'Chopes Lanches Porções' })), 'categoria');
});

test('papel do elemento clicado', () => {
  assert.equal(elementRole(element('a', { href: '/x' })), 'link');
  assert.equal(elementRole(element('div', { role: 'menuitem' })), 'menuitem');
  assert.equal(elementRole(element('input', { type: 'checkbox' })), 'checkbox');
  assert.equal(elementRole(element('input', { type: 'submit' })), 'button');
  assert.equal(elementRole(element('summary')), 'button');
  assert.equal(elementRole(element('button')), 'button');
});

test('campos de busca: marcados, type=search ou placeholder de busca; nunca senha', () => {
  assert.equal(isSearchField(element('input', { 'data-audit-search': '' })), true);
  assert.equal(isSearchField(element('input', { type: 'search' })), true);
  assert.equal(isSearchField(element('input', { placeholder: 'Pesquisar produto' })), true);
  assert.equal(isSearchField(element('input', { placeholder: 'Procurar comanda' })), true);
  assert.equal(isSearchField(element('input', { placeholder: 'Nome do cliente' })), false);
  assert.equal(isSearchField(element('input', { type: 'password', 'data-audit-search': '' })), false);
  assert.equal(isSearchField(element('textarea', { placeholder: 'Buscar' })), false);
});

test('rating dos web vitals pelos limiares oficiais', () => {
  assert.equal(vitalRating('LCP', 2500), 'good');
  assert.equal(vitalRating('LCP', 4000), 'needs-improvement');
  assert.equal(vitalRating('LCP', 4001), 'poor');
  assert.equal(vitalRating('INP', 250), 'needs-improvement');
  assert.equal(vitalRating('CLS', 0.3), 'poor');
  assert.equal(vitalRating('TTFB', 700), 'good');
  assert.equal(vitalRating('FCP', 3500), 'poor');
  assert.equal(roundVital('CLS', 0.123456), 0.1235);
  assert.equal(roundVital('LCP', 2300.6), 2301);
});

test('sessão de auditoria tem 32 caracteres hex sem hífens', () => {
  const id = createAuditSessionId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, createAuditSessionId());
});

test('eventos levam sessão e rota-modelo; page_view mede o tempo desde a anterior', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    events.push(...JSON.parse(String(init?.body)).events);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    flushPendingAuditAfterAuth();
    trackPageView('/operacao/comandas/42?aba=itens');
    trackPageView('/operacao/caixa');
    await flushAuditEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0]?.page, '/operacao/comandas/42');
    assert.equal(events[0]?.route, '/operacao/comandas/:id');
    assert.match(String(events[0]?.sessionId), /^[0-9a-f]{32}$/);
    assert.equal(events[1]?.sessionId, events[0]?.sessionId);
    const meta = events[1]?.meta as Record<string, unknown>;
    assert.equal(typeof meta.sinceLastMs, 'number');
    assert.equal((events[0]?.meta as Record<string, unknown>).sinceLastMs, undefined);

    const previousSession = events[0]?.sessionId;
    flushPendingAuditAfterAuth();
    trackPageView('/operacao/estoque');
    await flushAuditEvents();
    assert.notEqual(events[2]?.sessionId, previousSession);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
