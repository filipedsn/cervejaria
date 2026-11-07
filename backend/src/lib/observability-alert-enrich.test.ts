import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  build401Cenario,
  buildEnrichedContextFromLogs,
  buildUiErrorCenario,
  extractResponseErrorMessage,
  formatUsuario,
  parseAuditLogSource,
  parseMetadataValue,
} from './observability-alert-enrich.js';

describe('observability alert enrich', () => {
  it('parses metadata when Elasticsearch stores it as JSON string', () => {
    const metadata = parseMetadataValue(
      '{"responseError":{"error":"Sessão expirada. Identifique-se novamente."}}',
    );
    assert.equal(
      extractResponseErrorMessage(metadata),
      'Sessão expirada. Identifique-se novamente.',
    );
  });

  it('parses audit source with string metadata and body.text', () => {
    const log = parseAuditLogSource({
      '@timestamp': '2026-11-06T23:37:00.000Z',
      body: {
        text: 'Consultou /api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda → 401 (falhou)',
      },
      attributes: {
        'event.action': 'http.get',
        'event.outcome': 'failure',
        'http.request.method': 'GET',
        'http.route': '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda',
        'http.response.status_code': 401,
        'cervejaria.slug': 'churrasquinho-do-thiago',
        'actor.type': 'anonymous',
        'client.address': '2804:18:5081:baaa:85a7:6c46:a0c6:519a',
        metadata: '{"responseError":{"error":"Sessão expirada. Identifique-se novamente."}}',
      },
    });

    assert.equal(log.httpStatus, 401);
    assert.equal(log.cervejariaSlug, 'churrasquinho-do-thiago');
    assert.equal(log.actorType, 'anonymous');
    assert.equal(
      extractResponseErrorMessage(log.metadata),
      'Sessão expirada. Identifique-se novamente.',
    );
    assert.match(log.message, /401/);
  });

  it('labels anonymous public PDV actor as cliente do portal', () => {
    const label = formatUsuario({
      message: '',
      actorType: 'anonymous',
      httpRoute: '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda',
    });
    assert.equal(label, 'Cliente do portal PDV (nao identificado)');
  });

  it('builds 401 surge cenario with empresa, funcionalidade and API reason', () => {
    const logs = Array.from({ length: 3 }, () =>
      parseAuditLogSource({
        attributes: {
          'event.action': 'http.get',
          'event.outcome': 'failure',
          'http.request.method': 'GET',
          'http.route': '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda',
          'http.response.status_code': 401,
          'cervejaria.slug': 'churrasquinho-do-thiago',
          'actor.type': 'anonymous',
          metadata: '{"responseError":{"error":"Sessão expirada. Identifique-se novamente."}}',
        },
      }),
    );

    const cenario = build401Cenario(logs, logs[0]!, {
      ruleName: 'quiver-tap-401-surge-prd',
      alertState: 'active',
      reason:
        'Document count is 46 in the last 10m in logs-audit*.otel-prd index. Alert when greater than 10.',
    });

    assert.match(cenario, /Pico de 46 respostas 401/);
    assert.match(cenario, /Churrasquinho Do Thiago/);
    assert.match(cenario, /comanda\/cardapio/i);
    assert.match(cenario, /Sessão expirada/);
    assert.match(cenario, /Nao indica necessariamente ataque/);
  });

  it('enrich context for 401-surge exposes empresa, usuario, operacao and cenario', () => {
    const log = parseAuditLogSource({
      attributes: {
        'event.action': 'http.get',
        'event.outcome': 'failure',
        'http.request.method': 'GET',
        'http.route': '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda',
        'http.response.status_code': 401,
        'cervejaria.slug': 'churrasquinho-do-thiago',
        'actor.type': 'anonymous',
        metadata: '{"responseError":{"error":"Comanda encerrada. Identifique-se novamente."}}',
      },
    });

    const ctx = buildEnrichedContextFromLogs(
      {
        ruleName: 'quiver-tap-401-surge-prd',
        alertState: 'active',
        reason: 'Document count is 12 in the last 10m',
      },
      [log],
    );

    assert.ok(ctx);
    assert.equal(ctx?.empresa, 'Churrasquinho Do Thiago');
    assert.equal(ctx?.usuario, 'Cliente do portal PDV (nao identificado)');
    assert.equal(ctx?.operacao, 'Consultar comanda/cardapio do cliente (portal PDV)');
    assert.equal(ctx?.errorDescription, 'Comanda encerrada. Identifique-se novamente.');
    assert.match(ctx?.cenario ?? '', /comanda nao esta mais aberta/i);
    assert.ok(ctx?.technicalDetails?.some((line) => line.includes('Erro da API')));
  });

  it('reads staff identity from user.name / user.email (ECS), not only actor.name', () => {
    const log = parseAuditLogSource({
      attributes: {
        'event.action': 'ui.error',
        'event.outcome': 'failure',
        'cervejaria.slug': 'churrasquinho-do-thiago',
        'actor.type': 'usuario',
        'actor.id': 'cmsry9xrs0002hvlgkaq7g6c5',
        'user.name': 'Thiago Silva',
        'user.email': 'thiago@example.test',
        'ui.page': '/operacao/comandas/cmw5mmn8b08cjl601ul30q44d',
        message: 'Erro na interface em /operacao/comandas/:id: Servidor indisponível. Execute npm run restart na raiz do projeto.',
      },
    });

    assert.equal(log.actorName, 'Thiago Silva');
    assert.equal(log.actorEmail, 'thiago@example.test');
    assert.equal(formatUsuario(log), 'Thiago Silva (thiago@example.test)');
  });

  it('builds ui.error network cenario with empresa, funcionalidade and no restart instruction', () => {
    const log = parseAuditLogSource({
      attributes: {
        'event.action': 'ui.error',
        'event.outcome': 'failure',
        'cervejaria.slug': 'churrasquinho-do-thiago',
        'actor.type': 'usuario',
        'actor.id': 'cmsry9xrs0002hvlgkaq7g6c5',
        'user.name': 'Thiago Silva',
        'user.email': 'thiago@example.test',
        'ui.page': '/operacao/comandas/cmw5mmn8b08cjl601ul30q44d',
        'ui.label': 'frontend_error',
        message:
          'Erro na interface em /operacao/comandas/:id: Servidor indisponível. Execute npm run restart na raiz do projeto.',
        metadata: '{"outcome":"network_error","kind":"unhandledrejection"}',
      },
    });

    const cenario = buildUiErrorCenario(log, {
      ruleName: 'quiver-tap-ui-error-prd',
      alertState: 'active',
      reason: 'Document count is 1 in the last 15m in logs-audit*.otel-prd index. Alert when greater than 0.',
    });

    assert.match(cenario, /Thiago Silva/);
    assert.match(cenario, /Churrasquinho Do Thiago/);
    assert.match(cenario, /Detalhe da comanda/i);
    assert.match(cenario, /navegador nao conseguiu falar com o servidor/i);
    assert.match(cenario, /Nao prova que a API caiu/i);
    assert.doesNotMatch(cenario, /Execute npm run restart/i);
  });

  it('enrich context for ui-error exposes empresa, usuario, funcionalidade and cenario', () => {
    const log = parseAuditLogSource({
      attributes: {
        'event.action': 'ui.error',
        'event.outcome': 'failure',
        'cervejaria.slug': 'churrasquinho-do-thiago',
        'actor.type': 'usuario',
        'actor.id': 'cmsry9xrs0002hvlgkaq7g6c5',
        'user.name': 'Thiago Silva',
        'ui.page': '/operacao/comandas/cmw5mmn8b08cjl601ul30q44d',
        message:
          'Erro na interface em /operacao/comandas/:id: Servidor indisponível. Execute npm run restart na raiz do projeto.',
      },
    });

    const ctx = buildEnrichedContextFromLogs(
      {
        ruleName: 'quiver-tap-ui-error-prd',
        alertState: 'active',
        reason: 'Document count is 1 in the last 15m',
      },
      [log],
    );

    assert.ok(ctx);
    assert.equal(ctx?.empresa, 'Churrasquinho Do Thiago');
    assert.equal(ctx?.usuario, 'Thiago Silva');
    assert.equal(ctx?.operacao, 'Detalhe da comanda (Operacao)');
    assert.match(ctx?.cenario ?? '', /navegador nao conseguiu falar com o servidor/i);
    assert.doesNotMatch(ctx?.cenario ?? '', /Execute npm run restart/i);
  });
});
