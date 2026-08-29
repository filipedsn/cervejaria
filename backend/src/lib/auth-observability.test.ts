import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionReasonCode } from './auth-observability.js';

test('categoriza rejeições de sessão sem carregar detalhes sensíveis', () => {
  assert.equal(sessionReasonCode(new Error('Sessão expirada')), 'SESSION_EXPIRED');
  assert.equal(sessionReasonCode(new Error('token missing')), 'SESSION_MISSING');
  assert.equal(sessionReasonCode(new Error('assinatura inválida')), 'SESSION_INVALID');
  assert.equal(
    sessionReasonCode(Object.assign(new Error('contexto inválido'), { name: 'ClienteSessionValidationError' })),
    'PORTAL_SESSION_INVALID',
  );
  assert.equal(
    sessionReasonCode(Object.assign(new Error('Sessão encerrada'), { authReasonCode: 'PORTAL_SESSION_INVALID' })),
    'PORTAL_SESSION_INVALID',
  );
});
