import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveAlertCopy,
  formatAlertStateLabel,
  isOperationalAlertRule,
} from './observability-alert-copy.js';
import { formatObservabilityAlertTelegramText } from './observability-alert-format.js';
import { buildTechnicalDetailsFromLog } from './observability-alert-enrich.js';
import { resolveOperationLabel } from './operation-labels.js';

describe('observability alert copy', () => {
  it('resolve copy for known 5xx rule', () => {
    const copy = resolveAlertCopy('quiver-tap-5xx-rate-prd');
    assert.equal(copy.severity, 'critical');
    assert.match(copy.summary, /5xx/i);
    assert.ok(copy.actions.length >= 2);
  });

  it('classifies operational vs infra rules', () => {
    assert.equal(isOperationalAlertRule('quiver-tap-transacao-failure-prd'), true);
    assert.equal(isOperationalAlertRule('quiver-tap-api-ready-down-prd'), false);
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

  it('operational telegram uses empresa, usuario, operacao layout', () => {
    const text = formatObservabilityAlertTelegramText({
      ruleName: 'quiver-tap-transacao-failure-prd',
      alertState: 'active',
      reason: 'fallback reason',
      viewInAppUrl: 'https://kibana.example/alerts',
      context: {
        empresa: 'CIA Maritima',
        usuario: 'Filipe (filipe@example.com)',
        operacao: 'Fechar comanda',
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
    assert.match(text, /Operacao:/);
    assert.match(text, /Fechar comanda/);
    assert.match(text, /Descricao do erro:/);
    assert.match(text, /timeout no banco/);
    assert.match(text, /Detalhamento:/);
    assert.match(text, /transacao\.comanda_fechada/);
    assert.match(text, /Trace ID/);
    assert.doesNotMatch(text, /O que aconteceu/);
    assert.match(text, /Abrir no Kibana/);
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
    assert.match(text, /normalizou/i);
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
