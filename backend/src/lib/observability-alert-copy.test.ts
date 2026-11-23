import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveAlertCopy,
  formatAlertStateLabel,
  isOperationalAlertRule,
} from './observability-alert-copy.js';
import { formatObservabilityAlertTelegramText, truncateTelegramHtml } from './observability-alert-format.js';
import { buildTechnicalDetailsFromLog } from './observability-alert-enrich.js';
import { resolveOperationLabel, resolveUiFeatureLabel } from './operation-labels.js';

describe('observability alert copy', () => {
  it('resolve copy for known 5xx rule', () => {
    const copy = resolveAlertCopy('quiver-tap-5xx-rate-prd');
    assert.equal(copy.severity, 'critical');
    assert.match(copy.summary, /5xx/i);
    assert.ok(copy.actions.length >= 2);
  });

  it('classifies operational vs infra rules', () => {
    assert.equal(isOperationalAlertRule('quiver-tap-transacao-failure-prd'), true);
    assert.equal(isOperationalAlertRule('quiver-tap-401-surge-prd'), true);
    assert.equal(isOperationalAlertRule('quiver-tap-401-surge-dev'), true);
    assert.equal(isOperationalAlertRule('quiver-tap-api-ready-down-prd'), false);
  });

  it('maps public PDV comanda route to readable operation', () => {
    assert.equal(
      resolveOperationLabel(
        'http.get',
        undefined,
        '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda',
        'GET',
      ),
      'Consultar comanda/cardapio do cliente (portal PDV)',
    );
  });

  it('formats recovered state', () => {
    const state = formatAlertStateLabel('recovered');
    assert.equal(state.isRecovered, true);
    assert.match(state.label, /Recuperado/i);
  });

  it('maps transaction actions to readable operation names', () => {
    assert.equal(resolveOperationLabel('transacao.comanda_fechada'), 'Fechar comanda');
    assert.equal(resolveOperationLabel('transacao.operacao_caixa_aberto'), 'Abrir caixa do operacao');
  });

  it('operational telegram uses empresa, funcionalidade, usuario e cenario layout', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-transacao-failure-prd',
      alertState: 'active',
      reason: 'fallback reason',
      viewInAppUrl: 'https://kibana.example/alerts',
      context: {
        empresa: 'CIA Maritima',
        usuario: 'Filipe (filipe@example.com)',
        operacao: 'Fechar comanda',
        cenario: 'Filipe falhou ao fechar comanda na CIA Maritima por timeout no banco.',
        errorDescription: 'Falha ao registrar pagamento — timeout no banco',
        technicalDetails: [
          'Acao tecnica: transacao.comanda_fechada',
          'HTTP: POST /api/comandas/fechar status 500',
          'Trace ID: abc123def456',
          'comandaId: cmd_01',
        ],
      },
      raw: { '@timestamp': '2026-08-13T14:00:00.000Z' },
    });

    assert.match(text, /ERRO NA OPERACAO/);
    assert.match(text, /Empresa:/);
    assert.match(text, /CIA Maritima/);
    assert.match(text, /Usuario:/);
    assert.match(text, /Filipe/);
    assert.match(text, /Funcionalidade:/);
    assert.match(text, /Fechar comanda/);
    assert.match(text, /Cenario:/);
    assert.match(text, /timeout no banco/);
    assert.doesNotMatch(text, /Descricao do erro:/);
    assert.match(text, /Detalhamento:/);
    assert.match(text, /transacao\.comanda_fechada/);
    assert.match(text, /Trace ID/);
    assert.doesNotMatch(text, /O que aconteceu/);
    assert.match(text, /Abrir no Kibana/);
  });

  it('maps ui.page detalhe de comanda to feature label', () => {
    assert.equal(
      resolveUiFeatureLabel('/operacao/comandas/cmw5mmn8b08cjl601ul30q44d'),
      'Detalhe da comanda (Operacao)',
    );
    assert.equal(
      resolveOperationLabel('ui.error', undefined, undefined, undefined),
      'Erro na tela do app',
    );
  });

  it('401-surge telegram uses operational layout with business cenario', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-401-surge-prd',
      alertState: 'active',
      reason: 'Document count is 46 in the last 10m in logs-audit*.otel-prd index. Alert when greater than 10.',
      context: {
        empresa: 'Churrasquinho Do Thiago',
        usuario: 'Cliente do portal PDV (nao identificado)',
        operacao: 'Consultar comanda/cardapio do cliente (portal PDV)',
        cenario:
          'Pico de 46 respostas 401 na janela analisada (~10 min). Dominante: Cliente do portal PDV (nao identificado) tentando consultar comanda/cardapio do cliente (portal pdv) em Churrasquinho Do Thiago, mas estava sem sessao valida (cookie ausente ou expirado). Motivo da API: "Sessão expirada. Identifique-se novamente.". Possiveis causas: sessao expirou, cookie limpo, ou aba aberta apos logout. Nao indica necessariamente ataque.',
        errorDescription: 'Sessão expirada. Identifique-se novamente.',
        technicalDetails: [
          'HTTP: GET /api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda status 401',
          'Motivo do alerta: Document count is 46 in the last 10m',
        ],
      },
    });

    assert.match(text, /ERRO NA OPERACAO/);
    assert.match(text, /Empresa:/);
    assert.match(text, /Churrasquinho Do Thiago/);
    assert.match(text, /Cenario:/);
    assert.match(text, /Pico de 46/);
    assert.match(text, /Sessão expirada/);
    assert.doesNotMatch(text, /<b>Problema:<\/b>/);
  });

  it('infra telegram uses problema and detalhamento layout', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-api-ready-down-prd',
      alertState: 'active',
      reason: 'Health check falhou 3 vezes',
      viewInAppUrl: 'https://kibana.example/alerts',
    });

    assert.match(text, /ALERTA/);
    assert.match(text, /Problema:/);
    assert.match(text, /Detalhamento:/);
    assert.match(text, /health check/i);
    assert.doesNotMatch(text, /Empresa:/);
    assert.doesNotMatch(text, /O que fazer/);
  });

  it('recovered infra telegram keeps problema layout', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-api-ready-down-prd',
      alertState: 'recovered',
      reason: 'Health check OK novamente',
    });

    assert.match(text, /OK/);
    assert.match(text, /Problema:/);
    assert.match(text, /Detalhamento:/);
    assert.match(text, /blip de publicacao/i);
  });

  it('hides Document count reason from infra telegram body', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-api-ready-down-prd',
      alertState: 'active',
      reason: 'Document count is 12 in the last 3m in metrics-httpcheckreceiver.otel-infra* index. Alert when greater than 0.',
    });

    assert.match(text, /ALERTA/);
    assert.doesNotMatch(text, /Document count is 12/i);
  });

  it('negocio telegram uses [NEGÓCIO] prefix and skips recover', () => {
    const active = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-ui-negocio-prd',
      alertState: 'active',
      reason: 'Document count is 1',
      context: {
        empresa: 'Churrasquinho Do Thiago',
        operacao: 'Detalhe da comanda (Operacao)',
        usuario: 'Thiago',
        cenario: 'O atendente Thiago ao tentar "Incluir 1x Churrasquinho": Estoque insuficiente.',
      },
    });
    assert.equal(active.startsWith('[NEGÓCIO] '), true);
    assert.match(active, /AVISO DE OPERACAO/);
    assert.match(active, /ℹ️/);

    const recovered = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-ui-negocio-prd',
      alertState: 'recovered',
      reason: 'Document count is 0',
      context: { cenario: 'qualquer' },
    });
    assert.equal(recovered, '');
  });

  it('operational recover repeats cenario', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-ui-error-prd',
      alertState: 'recovered',
      reason: 'Document count is 0',
      context: {
        empresa: 'Churrasquinho Do Thiago',
        operacao: 'Lista de comandas (Operacao)',
        cenario: 'O atendente Thiago ao usar "Lista de comandas": falha de rede.',
      },
    });
    assert.match(text, /RECUPERADO/);
    assert.match(text, /voltou ao normal/i);
    assert.match(text, /falha de rede/);
  });

  it('builds technical details from audit log fields', () => {
    const details = buildTechnicalDetailsFromLog(
      {
        timestamp: '2026-08-13T17:00:00.000Z',
        message: 'Falha ao fechar comanda',
        eventAction: 'transacao.comanda_fechada',
        eventOutcome: 'failure',
        cervejariaSlug: 'cia-maritima',
        httpMethod: 'POST',
        httpRoute: '/api/comandas/fechar',
        httpStatus: 500,
        traceId: 'abc123',
        metadata: { comandaId: 'cmd_01', error: 'timeout' },
      },
      {
        ruleName: 'quiver-tap-transacao-failure-prd',
        alertState: 'active',
        reason: '1 falha de transacao em 15 min',
      },
    );

    assert.ok(details.some((line) => line.includes('transacao.comanda_fechada')));
    assert.ok(details.some((line) => line.includes('POST')));
    assert.ok(details.some((line) => line.includes('abc123')));
    assert.ok(details.some((line) => line.includes('cmd_01')));
  });
});

describe('telegram [KIBANA] prefix and safe truncation', () => {
  it('prefixes every Kibana telegram message', () => {
    const text = formatObservabilityAlertTelegramText({ ruleName: 'quiver-tap-api-ready-down-prd', alertState: 'active', reason: 'teste' });
    assert.equal(text.startsWith('[KIBANA] '), true);
  });

  it('truncates long HTML without partial tags and closes open tags', () => {
    const long = `[KIBANA] <b>Titulo</b>\n<code>${'x'.repeat(5000)}</code>`;
    const out = truncateTelegramHtml(long);
    assert.ok(out.length <= 4000);
    assert.ok(out.endsWith('</code>'));
    assert.equal(/<[^>]*$/.test(out), false);
  });

  it('keeps short text unchanged', () => {
    assert.equal(truncateTelegramHtml('[KIBANA] curto'), '[KIBANA] curto');
  });
});
