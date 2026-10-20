import assert from 'node:assert/strict';
import test from 'node:test';
import { emitAuthEvent, sessionReasonCode } from './auth-observability.js';
import type { FastifyRequest } from 'fastify';
import type { AuditEventInput } from './audit/emit-audit-event.js';

function requestForLogin(): FastifyRequest {
  return {
    method: 'POST',
    url: '/api/auth/login?discard=this',
    routeOptions: { url: '/api/auth/login' },
  } as unknown as FastifyRequest;
}

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

test('login audit distinguishes valid, invalid and inactive-tenant outcomes without credentials', () => {
  const events: AuditEventInput[] = [];
  const emit = (input: AuditEventInput) => events.push(input);
  const request = requestForLogin();

  emitAuthEvent(request, 'auth.login.succeeded', {
    user: { id: 'user-safe-id', papel: 'DONO', cervejariaId: 'tenant-safe-id', cervejaria: { slug: 'tenant-qa' } },
    role: 'DONO',
    statusCode: 200,
  }, emit);
  emitAuthEvent(request, 'auth.login.failed', { reasonCode: 'INVALID_CREDENTIALS', statusCode: 401 }, emit);
  emitAuthEvent(request, 'auth.login.rejected', {
    reasonCode: 'TENANT_INACTIVE',
    user: { id: 'inactive-user-id', papel: 'DONO', cervejariaId: 'inactive-tenant-id', cervejaria: { slug: 'inactive-qa' } },
    role: 'DONO',
    statusCode: 403,
  }, emit);

  assert.deepEqual(events.map((event) => [event.action, event.outcome]), [
    ['auth.login.succeeded', 'success'],
    ['auth.login.failed', 'failure'],
    ['auth.login.rejected', 'failure'],
  ]);
  assert.equal(events[0].actor?.id, 'user-safe-id');
  assert.equal(events[0].cervejariaId, 'tenant-safe-id');
  assert.equal(events[0].slug, 'tenant-qa');
  assert.equal(events[1].actor, undefined);
  assert.equal(events[1].metadata?.reasonCode, 'INVALID_CREDENTIALS');
  assert.equal(events[2].actor?.id, 'inactive-user-id');
  assert.equal(events[2].cervejariaId, 'inactive-tenant-id');
  assert.equal(events[2].slug, 'inactive-qa');
  assert.equal(events[2].metadata?.reasonCode, 'TENANT_INACTIVE');
  assert.ok(events.every((event) => event.http?.route === '/api/auth/login'));
  assert.deepEqual(events.map((event) => event.http?.statusCode), [200, 401, 403]);
  assert.equal(events.length, 3);
  assert.equal(Object.keys(events[0]).some((key) => /email|senha|password|cookie|token/i.test(key)), false);
});
