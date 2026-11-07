import assert from 'node:assert/strict';
import test from 'node:test';
import { readReleaseInfoConfig, type ReleaseInfoConfig } from '../src/config.js';
import { describeRelease, formatReleaseNotice, summarizePullBody, summarizeWorkItemHtml } from '../src/watch/index.js';

const config: ReleaseInfoConfig = { githubRepo: 'filipedsn/cervejaria', planeUrl: 'http://plane.test', planeWorkspace: 'quiver', planeApiKey: 'test-key' };

const pr190Body = [
  '## Summary',
  '- Lista os 4 crons do VPS no cartão Site dos clientes (horário em Brasília).',
  '- Liga/desliga e altera horário via forced command SSH (`quiver-tap-cron-manage`).',
  '',
  '## Test plan',
  '- [ ] `cd ops-panel && npm run test:unit`',
  '',
  'Refs: TAP-178',
  'Made with [Cursor](https://cursor.com)',
].join('\n');

function fakeFetch(calls: string[], options: { githubDown?: boolean } = {}) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('https://api.github.com')) {
      if (options.githubDown) return new Response('rate limited', { status: 403 });
      if (url.endsWith('/compare/d11a78fc...9d76cb21')) {
        return json({ commits: [
          { commit: { message: 'feat(obs): padrao semantico (TAP-177) (#189)\n\nRefs: TAP-177' } },
          { commit: { message: 'feat(ops): gerenciar crons do VPS no painel Ops (#190)\n\nLista os quatro schedules.\n\nRefs: TAP-178' } },
          { commit: { message: 'chore: ajuste direto em main' } },
        ] });
      }
      if (url.endsWith('/pulls/190')) return json({ title: 'feat(ops): gerenciar crons do VPS no painel (TAP-178)', body: pr190Body, html_url: 'https://github.com/filipedsn/cervejaria/pull/190' });
      if (url.endsWith('/pulls/189')) return json({ title: 'feat(obs): padrao semantico de erros (TAP-177)', body: 'Erros tratados chegam ao Kibana com contexto.', html_url: 'https://github.com/filipedsn/cervejaria/pull/189' });
      if (url.endsWith('/commits/9d76cb21')) return json({ commit: { message: 'feat(ops): gerenciar crons do VPS no painel Ops (#190)\n\nRefs: TAP-178' } });
      return new Response('{}', { status: 404 });
    }
    if (url.startsWith('http://plane.test')) {
      assert.equal(new Headers(init?.headers).get('X-API-Key'), 'test-key');
      if (url.includes('/work-items/TAP-178/')) return json({ name: 'Gerenciar crons do VPS no painel Ops', state: { name: 'Done' }, description_html: '<p><b>Problema:</b> crons só via SSH.</p><p>Objetivo: ligar &amp; desligar pelo painel.</p>' });
      if (url.includes('/work-items/TAP-177/')) return json({ name: 'Padrão semântico de erros no Kibana', state: 'uuid-sem-expand', description_html: '' });
      return new Response('{}', { status: 404 });
    }
    throw new Error(`unexpected url: ${url}`);
  };
}

test('resumo do PR ignora títulos, checklist, Refs e rodapé da ferramenta', () => {
  assert.equal(
    summarizePullBody(pr190Body),
    'Lista os 4 crons do VPS no cartão Site dos clientes (horário em Brasília). Liga/desliga e altera horário via forced command SSH (quiver-tap-cron-manage).',
  );
  assert.equal(summarizePullBody('- primeiro\n- segundo'), 'primeiro; segundo');
  assert.equal(summarizePullBody('## Test plan\n- [x] ok'), undefined);
});

test('resumo do WI converte HTML do Plane em texto', () => {
  assert.equal(summarizeWorkItemHtml('<p><b>Problema:</b> a &amp; b</p><ul><li>item</li></ul>'), 'Problema: a & b item');
});

test('nova versão lista os PRs desde a anterior com seus WIs (nome, estado e descrição)', async () => {
  const calls: string[] = [];
  const details = await describeRelease(fakeFetch(calls), config, '9d76cb21', 'd11a78fc');
  const notice = formatReleaseNotice(details);
  assert.equal(notice, [
    'Nova versão no ar: 9d76cb2 (anterior: d11a78f)',
    '',
    'PR #190 — feat(ops): gerenciar crons do VPS no painel (TAP-178)',
    'https://github.com/filipedsn/cervejaria/pull/190',
    'O que muda: Lista os 4 crons do VPS no cartão Site dos clientes (horário em Brasília). Liga/desliga e altera horário via forced command SSH (quiver-tap-cron-manage).',
    'WI TAP-178 — Gerenciar crons do VPS no painel Ops (Done)',
    'Sobre o WI: Problema: crons só via SSH. Objetivo: ligar & desligar pelo painel.',
    '',
    'PR #189 — feat(obs): padrao semantico de erros (TAP-177)',
    'https://github.com/filipedsn/cervejaria/pull/189',
    'O que muda: Erros tratados chegam ao Kibana com contexto.',
    'WI TAP-177 — Padrão semântico de erros no Kibana',
    '',
    'Commits sem PR: chore: ajuste direto em main',
  ].join('\n'));
});

test('sem chave do Plane mostra só o identificador do WI e não chama o Plane', async () => {
  const calls: string[] = [];
  const details = await describeRelease(fakeFetch(calls), { ...config, planeApiKey: undefined }, '9d76cb21');
  assert.match(formatReleaseNotice(details), /PR #190 — feat\(ops\)[\s\S]*\nWI TAP-178$/);
  assert.equal(calls.some((url) => url.startsWith('http://plane.test')), false);
});

test('GitHub fora do ar mantém o aviso com o SHA', async () => {
  const details = await describeRelease(fakeFetch([], { githubDown: true }), config, '9d76cb21', 'd11a78fc');
  assert.equal(formatReleaseNotice(details), 'Nova versão no ar: 9d76cb2 (anterior: d11a78f)\nPR e WI não identificados (GitHub indisponível).');
});

test('configuração valida repo, URL do Plane e workspace', () => {
  const defaults = readReleaseInfoConfig({});
  assert.deepEqual(defaults, { ok: true, config: { githubRepo: 'filipedsn/cervejaria', planeUrl: 'http://127.0.0.1:8090', planeWorkspace: 'quiver', planeApiKey: undefined } });
  assert.equal(readReleaseInfoConfig({ SUPPORT_ANALYST_GITHUB_REPO: 'sem-barra' }).ok, false);
  assert.equal(readReleaseInfoConfig({ SUPPORT_ANALYST_PLANE_URL: 'http://user:pw@plane.test' }).ok, false);
  assert.equal(readReleaseInfoConfig({ SUPPORT_ANALYST_PLANE_WORKSPACE: 'Quiver Space' }).ok, false);
});
