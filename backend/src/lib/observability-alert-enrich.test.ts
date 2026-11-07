import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  build401Cenario,
  buildEnrichedContextFromLogs,
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
});
