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
  assert.deepEqual(redactObject({ JWT_SECRET: 'jwt-value', SMTP_PASS: 'smtp-value', OBS_ALERT_TELEGRAM_BOT_TOKEN: 'bot-value' }), {
    JWT_SECRET: '[REDACTED]',
    SMTP_PASS: '[REDACTED]',
    OBS_ALERT_TELEGRAM_BOT_TOKEN: '[REDACTED]',
  });
});
