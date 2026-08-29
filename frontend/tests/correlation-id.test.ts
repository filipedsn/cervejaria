import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequestHeaders } from '../src/lib/api.ts';
import { CORRELATION_ID_HEADER, createCorrelationId } from '../src/lib/correlation-id.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('gera UUID de correlação para uma requisição sem ID existente', () => {
  const correlationId = createCorrelationId();
  assert.equal(CORRELATION_ID_HEADER, 'X-Correlation-Id');
  assert.match(correlationId, UUID_PATTERN);
});

test('wrapper HTTP envia o ID de correlação gerado no header', () => {
  const headers = buildRequestHeaders({ method: 'POST', body: JSON.stringify({ ok: true }) });
  assert.match(headers[CORRELATION_ID_HEADER]!, UUID_PATTERN);
  assert.equal(headers['Content-Type'], 'application/json');
});
