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

test('captures bounded portal business details without idempotency credentials or free text', () => {
  const metadata = buildHttpAuditMetadata(
    '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/pedidos',
    {
      idempotencyKey: 'synthetic-idempotency-key',
      itens: [{ produtoId: 'synthetic-product', quantidade: 2, opcionais: [{ opcionalId: 'synthetic-option', quantidade: 1 }] }],
      paraViagem: true,
    },
  );
  assert.deepEqual(metadata?.requestBody, {
    itens: [{ produtoId: 'synthetic-product', quantidade: 2, opcionais: [{ opcionalId: 'synthetic-option', quantidade: 1 }] }],
    paraViagem: true,
  });
  assert.doesNotMatch(JSON.stringify(metadata), /synthetic-idempotency-key/);
  assert.deepEqual(metadata?.payloadPolicy, { version: 1, omitted: true, truncated: false, identitySource: 'request_untrusted' });
});

test('retains safe response errors when a portal order payload is omitted', () => {
  const metadata = buildHttpAuditMetadata(
    '/api/public/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/pedidos',
    { itens: [{ produtoId: 'synthetic-product' }] },
    { error: 'request rejected' },
  );
  assert.deepEqual(metadata?.responseError, { error: 'request rejected' });
});

test('payload policy drops arbitrary personal text and bounds nested arrays', () => {
  const metadata = buildHttpAuditMetadata('/api/test', {
    tenant: 'forged', nome: 'private-person', senha: 'secret', telefone: '27999999999',
    itens: Array.from({ length: 1000 }, () => ({ produtoId: 'p1', quantidade: 2, observacao: 'private-note' })),
  });
  const json = JSON.stringify(metadata);
  assert.doesNotMatch(json, /forged|private-person|secret|27999999999|private-note/);
  assert.equal((metadata?.payloadPolicy as Record<string, unknown>).truncated, true);
  assert.ok(json.length < 5000);
});
