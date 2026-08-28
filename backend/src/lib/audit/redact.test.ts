import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactObject } from './redact.js';

test('redige senha de autorização de correção de caixa', () => {
  assert.deepEqual(redactObject({ autorizadorSenha: 'segredo', motivo: 'digitação incorreta' }), {
    autorizadorSenha: '[REDACTED]',
    motivo: 'digitação incorreta',
  });
});
