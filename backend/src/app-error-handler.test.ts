import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from './app.js';
import { ZodError } from 'zod';
import { getTelemetryContext } from './lib/telemetry-context.js';
import { buildAuditPayload } from './lib/audit/emit-audit-event.js';

test('handler global preserva respostas públicas para erros conhecidos e desconhecidos', async () => {
  const app = await buildApp();

  app.get('/__test/error', async () => {
    throw new Error('detalhe interno');
  });
  app.get('/__test/context', async () => getTelemetryContext());
  app.get('/__test/audit-context', async () =>
    buildAuditPayload({ action: 'test.correlation', message: 'Teste de correlação ponta a ponta' }),
  );
  app.get('/__test/status', async () => {
    throw Object.assign(new Error('status conhecido'), { statusCode: 418 });
  });
  app.get('/__test/zod', async () => {
    throw new ZodError([{ code: 'custom', path: [], message: 'campo inválido' }]);
  });
  app.get('/__test/validation', {
    schema: {
      querystring: {
        type: 'object',
        required: ['nome'],
        properties: { nome: { type: 'string' } },
      },
    },
  }, async () => ({ ok: true }));
  app.get('/__test/object', async () => {
    throw { motivo: 'objeto inesperado' };
  });
  app.get('/__test/string', async () => {
    throw 'texto inesperado';
  });

  try {
    const suppliedCorrelationId = 'd2719d5c-0982-4b83-95c6-0a8e355a5e28';
    const preserved = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-correlation-id': suppliedCorrelationId },
    });
    assert.equal(preserved.headers['x-correlation-id'], suppliedCorrelationId);

    const context = await app.inject({
      method: 'GET',
      url: '/__test/context',
      headers: { 'x-correlation-id': suppliedCorrelationId },
    });
    assert.equal(context.json().correlationId, suppliedCorrelationId);
    assert.ok(context.json().requestId);

    const audit = await app.inject({
      method: 'GET',
      url: '/__test/audit-context',
      headers: { 'x-correlation-id': suppliedCorrelationId },
    });
    assert.equal(audit.headers['x-correlation-id'], suppliedCorrelationId);
    assert.equal(audit.json().correlationId, suppliedCorrelationId);
    assert.ok(audit.json().requestId);

    const generatedOne = await app.inject('/api/health');
    const generatedTwo = await app.inject('/api/health');
    assert.match(String(generatedOne.headers['x-correlation-id'] ?? ''), /^[0-9a-f-]{36}$/i);
    assert.notEqual(generatedOne.headers['x-correlation-id'], generatedTwo.headers['x-correlation-id']);

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-correlation-id': 'unsafe-value' },
    });
    assert.match(String(invalid.headers['x-correlation-id'] ?? ''), /^[0-9a-f-]{36}$/i);
    assert.notEqual(invalid.headers['x-correlation-id'], 'unsafe-value');

    const error = await app.inject('/__test/error');
    assert.equal(error.statusCode, 500);
    assert.deepEqual(error.json(), { error: 'Erro interno do servidor' });
    assert.match(String(error.headers['x-correlation-id'] ?? ''), /^[0-9a-f-]{36}$/i);

    const status = await app.inject('/__test/status');
    assert.equal(status.statusCode, 418);
    assert.deepEqual(status.json(), { error: 'status conhecido' });

    const zod = await app.inject('/__test/zod');
    assert.equal(zod.statusCode, 400);
    assert.deepEqual(zod.json(), { error: 'campo inválido' });

    const validation = await app.inject('/__test/validation');
    assert.equal(validation.statusCode, 400);
    assert.equal(validation.json().error, 'Dados inválidos');
    assert.ok(Array.isArray(validation.json().details));

    const object = await app.inject('/__test/object');
    assert.equal(object.statusCode, 500);
    assert.deepEqual(object.json(), { error: 'Erro interno do servidor' });

    const string = await app.inject('/__test/string');
    assert.equal(string.statusCode, 500);
    assert.deepEqual(string.json(), { error: 'Erro interno do servidor' });
  } finally {
    await app.close();
  }
});
