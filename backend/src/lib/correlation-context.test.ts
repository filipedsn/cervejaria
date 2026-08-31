import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuditPayload } from './audit/emit-audit-event.js';
import { resolveCorrelationId, validCorrelationId } from './correlation-context.js';
import { runWithTelemetryContext } from './telemetry-context.js';

const suppliedId = 'd2719d5c-0982-4b83-95c6-0a8e355a5e28';

test('preserva correlation ID UUID válido e rejeita valores inseguros', () => {
  assert.equal(resolveCorrelationId(suppliedId), suppliedId);
  assert.equal(validCorrelationId('injected\nvalue'), false);
  assert.equal(validCorrelationId('a'.repeat(1_000)), false);

  const generated = resolveCorrelationId('injected\nvalue');
  assert.notEqual(generated, 'injected\nvalue');
  assert.equal(validCorrelationId(generated), true);
});

test('audit herda requestId e correlationId do contexto da requisição', () => {
  const payload = runWithTelemetryContext(
    {
      requestId: 'req-123',
      correlationId: suppliedId,
      slug: 'system',
      env: 'dev',
      actor: { type: 'anonymous' },
    },
    () => buildAuditPayload({ action: 'http.post', message: 'Teste de correlação' }),
  );

  assert.equal(payload.requestId, 'req-123');
  assert.equal(payload.correlationId, suppliedId);
  assert.equal(payload.releaseSha, 'dev');
  assert.equal(payload.service, 'quiver-tap-api');
  assert.equal(payload.environment, 'development');
  assert.equal(payload['data_stream.dataset'], 'audit_system');
  assert.equal(payload['data_stream.namespace'], 'dev');
  assert.equal(Object.hasOwn(payload, 'elasticsearch.index'), false);
});
