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
