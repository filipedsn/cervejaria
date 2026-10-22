import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { buildHttpAuditMetadata, registerAuditHooks } from './audit-hooks.js';
import { registerCorrelationContext } from './correlation-context.js';
import { getTelemetryContext } from './telemetry-context.js';
import type { AuditEventInput } from './audit/emit-audit-event.js';

async function makeApp() {
  const app = Fastify();
  const events: Array<{ input: AuditEventInput; context: ReturnType<typeof getTelemetryContext> }> = [];
  await app.register(cookie);
  registerCorrelationContext(app);
  registerAuditHooks(app, (input) => events.push({ input, context: getTelemetryContext() }));
  app.get('/api/reports/:reportId', async () => ({ result: 'synthetic-only' }));
  app.get('/api/operacao/cozinha', async () => []);
  app.get('/api/operacao/cozinha/failure/:status', async (request, reply) => reply.code(Number((request.params as { status: string }).status)).send({ error: 'synthetic failure' }));
  return { app, events };
}

test('audits successful API reads with route template and duration but no query or response content', async () => {
  const { app, events } = await makeApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/reports/private-record-987?email=private%40example.test&token=secret-value',
      headers: { 'x-correlation-id': '123e4567-e89b-42d3-a456-426614174010' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.input.action, 'http.get');
    assert.equal(events[0]?.input.outcome, 'success');
    assert.deepEqual(events[0]?.input.http, {
      method: 'GET',
      route: '/api/reports/:reportId',
      statusCode: 200,
      durationMs: events[0]?.input.http?.durationMs,
    });
    assert.equal(Number.isFinite(events[0]?.input.http?.durationMs), true);
    assert.equal(events[0]?.context?.correlationId, '123e4567-e89b-42d3-a456-426614174010');
    assert.equal(Object.hasOwn(events[0]?.input ?? {}, 'metadata'), false);
    const serialized = JSON.stringify(events[0]);
    assert.equal(serialized.includes('private-record-987'), false);
    assert.equal(serialized.includes('private@example.test'), false);
    assert.equal(serialized.includes('secret-value'), false);
    assert.equal(serialized.includes('synthetic-only'), false);
  } finally {
    await app.close();
  }
});

test('polling exclusions preserve 401, 403 and 500 with correlation context', async () => {
  const { app, events } = await makeApp();
  try {
    for (const status of [401, 403, 500]) await app.inject(`/api/operacao/cozinha/failure/${status}`);
    assert.deepEqual(events.map(e => e.input.http?.statusCode), [401, 403, 500]);
    assert.ok(events.every(e => e.context?.correlationId));
  } finally { await app.close(); }
});

test('keeps high-frequency kitchen polling out of successful-read audit', async () => {
  const { app, events } = await makeApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/api/operacao/cozinha?cursor=next' });
    assert.equal(response.statusCode, 200);
    assert.equal(events.length, 0);
  } finally {
    await app.close();
  }
});

test('omits product, options, and idempotency payload from portal order HTTP audit', () => {
  const metadata = buildHttpAuditMetadata(
    '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/pedidos',
    {
      idempotencyKey: 'synthetic-idempotency-key',
      itens: [{ produtoId: 'synthetic-product', quantidade: 2, opcionais: [{ opcionalId: 'synthetic-option', quantidade: 1 }] }],
      paraViagem: true,
    },
  );
  assert.equal(metadata, undefined);
});

test('retains safe response errors when a portal order payload is omitted', () => {
  const metadata = buildHttpAuditMetadata(
    '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/pedidos',
    { itens: [{ produtoId: 'synthetic-product' }] },
    { error: 'request rejected' },
  );
  assert.deepEqual(metadata, { responseError: { error: 'request rejected' } });
});
