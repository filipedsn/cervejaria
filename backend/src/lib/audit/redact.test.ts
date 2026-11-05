import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactObject } from './redact.js';

test('sanitizes secrets in strings, nested documents and deeply nested payloads', () => {
  const value = redactObject({ accessToken: 'secret-a', apiKey: 'secret-b', cpf: '12345678901',
    nested: { value: 'Bearer private-secret', text: 'ok', safe: 'x'.repeat(5000) } });
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /secret-a|secret-b|12345678901|private-secret/);
  assert.ok(serialized.length < 1500);
});

test('preserva cadastro de cliente aninhado e no metadata', () => {
  const value = redactObject({
    clienteId: 'cli-1',
    clienteNome: 'Priscilla Kfuri',
    nome: 'Priscilla Kfuri',
    telefone: '27999525261',
    email: 'priscilla@example.test',
    contaPendente: true,
    payload: {
      comanda: {
        cliente: {
          id: 'cli-1',
          nome: 'Priscilla Kfuri',
          telefone: '27999525261',
          email: 'priscilla@example.test',
        },
      },
    },
    senha: 'secret',
    cvv: '123',
  });
  assert.deepEqual(value, {
    clienteId: 'cli-1',
    clienteNome: 'Priscilla Kfuri',
    nome: 'Priscilla Kfuri',
    telefone: '27999525261',
    email: 'priscilla@example.test',
    contaPendente: true,
    payload: {
      comanda: {
        cliente: {
          id: 'cli-1',
          nome: 'Priscilla Kfuri',
          telefone: '27999525261',
          email: 'priscilla@example.test',
        },
      },
    },
    senha: '[REDACTED]',
    cvv: '[REDACTED]',
  });
});

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
