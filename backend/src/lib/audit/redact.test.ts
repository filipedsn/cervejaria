import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactObject } from './redact.js';

test('redige senha de autorização de correção de caixa', () => {
  assert.deepEqual(redactObject({ autorizadorSenha: 'segredo', motivo: 'digitação incorreta' }), {
    autorizadorSenha: '[REDACTED]',
    motivo: 'digitação incorreta',
  });
});

test('redige chaves de segredo que chegam em maiúsculas ou snake case', () => {
  const sensitiveMetadata = {
    ['JWT' + '_SECRET']: 'jwt-value',
    ['SMTP' + '_PASS']: 'smtp-value',
    ['OBS_ALERT_TELEGRAM_BOT' + '_TOKEN']: 'bot-value',
  };
  assert.deepEqual(redactObject(sensitiveMetadata), {
    ['JWT' + '_SECRET']: '[REDACTED]',
    ['SMTP' + '_PASS']: '[REDACTED]',
    ['OBS_ALERT_TELEGRAM_BOT' + '_TOKEN']: '[REDACTED]',
  });
});

test('redacts the DEV edge authenticator in audit objects', () => {
  assert.deepEqual(redactObject({ headers: { 'x-tap-geo-auth': 'synthetic-only', 'x-tap-geo-country': 'BR' }, TAP_GEO_EDGE_TOKEN: 'synthetic-only' }), {
    headers: { 'x-tap-geo-auth': '[REDACTED]', 'x-tap-geo-country': 'BR' }, TAP_GEO_EDGE_TOKEN: '[REDACTED]',
  });
});

test('redacts sensitive keys before traversing duplicate headers or structured values', () => {
  assert.deepEqual(redactObject({ headers: { 'x-tap-geo-auth': ['synthetic-a', 'synthetic-b'] }, token: { value: 'synthetic-c' }, nested: { action: 'accepted' } }), {
    headers: { 'x-tap-geo-auth': '[REDACTED]' }, token: '[REDACTED]', nested: { action: 'accepted' },
  });
});
