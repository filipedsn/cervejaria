import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeEvent } from '../src/normalize/index.js';
import { MAX_FREE_TEXT_LENGTH } from '../src/privacy/sanitize.js';
import type { RawEventDocument } from '../src/types.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function fixture(name: string): Promise<RawEventDocument> {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf8')) as RawEventDocument;
}

async function eventFrom(name: string) {
  const result = normalizeEvent(await fixture(name));
  assert.equal(result.ok, true, `fixture ${name} should normalize`);
  return result.event;
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      collectKeys(child, keys);
    }
  }
  return keys;
}

test('normalizes a synthetic alert and converts timestamp to UTC', async () => {
  const event = await eventFrom('alert-telemetry-gap.json');
  assert.equal(event.source, 'alert');
  assert.equal(event.timestamp, '2026-08-31T15:00:00.000Z');
  assert.equal(event.alert?.ruleName, 'telemetry-gap-dev');
  assert.equal(event.environment, 'dev');
});

test('normalizes audit HTTP success with current tenant and tracing fields', async () => {
  const event = await eventFrom('audit-http-success.json');
  assert.equal(event.correlationId, 'corr-synthetic-001');
  assert.equal(event.requestId, 'req-synthetic-001');
  assert.equal(event.releaseSha, 'abc123synthetic');
  assert.equal(event.traceId, 'trace-synthetic-001');
  assert.equal(event.spanId, 'span-synthetic-001');
  assert.equal(event.tenantId, 'tenant-synthetic-001');
  assert.equal(event.tenantSlug, 'brew-demo');
  assert.deepEqual(event.http, { method: 'POST', route: '/api/pedidos/:id', statusCode: 200 });
  assert.equal(event.outcome, 'success');
});

test('uses legacy tenant fields only as a fallback', () => {
  const raw: RawEventDocument = {
    index: 'logs-audit.otel-dev-000001', id: 'legacy-tenant', sourceType: 'audit',
    source: { '@timestamp': '2026-08-31T12:00:00Z', attributes: { cervejariaId: 'legacy-id', cervejariaSlug: 'legacy-slug' } }
  };
  const result = normalizeEvent(raw);
  assert.equal(result.ok, true);
  assert.equal(result.event.tenantId, 'legacy-id');
  assert.equal(result.event.tenantSlug, 'legacy-slug');
});

test('normalizes audit authentication failure and its reason code', async () => {
  const event = await eventFrom('audit-auth-failure.json');
  assert.equal(event.action, 'auth.login');
  assert.equal(event.outcome, 'failure');
  assert.equal(event.reasonCode, 'INVALID_CREDENTIALS');
  assert.equal(event.actorType, 'anonymous');
});

test('normalizes technical HTTP failures using only allowlisted fields', async () => {
  const event = await eventFrom('technical-http-500.json');
  assert.equal(event.eventType, 'http.request.failed');
  assert.deepEqual(event.http, { method: 'POST', route: '/api/pedidos/:id', statusCode: 500, durationMs: 87 });
  assert.equal(event.correlationId, 'corr-synthetic-001');
});

test('normalizes a proven DB event and preserves its category', async () => {
  const event = await eventFrom('database-failure.json');
  assert.deepEqual(event.db, { category: 'CONNECTION', durationMs: 250, operation: undefined, model: undefined });
});

test('uses UNKNOWN DB category only for an explicitly DB event', () => {
  const raw: RawEventDocument = {
    index: 'logs-technical.otel-dev-000001', id: 'db-unknown', sourceType: 'technical',
    source: { '@timestamp': '2026-08-31T12:00:00Z', attributes: { event: 'db.query.failed', category: 'UNMAPPED' } }
  };
  const result = normalizeEvent(raw);
  assert.equal(result.ok, true);
  assert.equal(result.event.db?.category, 'UNKNOWN');
});

test('normalizes a realtime producer-contract fixture without asserting an operational mapping', async () => {
  const event = await eventFrom('realtime-producer-contract-synthetic.json');
  assert.deepEqual(event.realtime, { action: 'connection.denied', reasonCode: 'TENANT_ACCESS_DENIED' });
});

test('event ID is stable for repeated normalization of the same raw reference', async () => {
  const raw = await fixture('audit-http-success.json');
  const first = normalizeEvent(raw);
  const second = normalizeEvent(raw);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.match(first.event.eventId, /^sa1:[a-f0-9]{64}$/);
});

test('normalization does not mutate the raw document and identical input yields identical output', async () => {
  const raw = await fixture('technical-http-500.json');
  const before = structuredClone(raw);
  const first = normalizeEvent(raw);
  const second = normalizeEvent(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
});

test('invalid or absent timestamps return an explicit failure', () => {
  const invalid: RawEventDocument = { index: 'i', id: 'x', sourceType: 'alert', source: { '@timestamp': 'not-a-date' } };
  const absent: RawEventDocument = { index: 'i', id: 'x', sourceType: 'alert', source: {} };
  assert.deepEqual(normalizeEvent(invalid), { ok: false, reason: 'invalid_timestamp' });
  assert.deepEqual(normalizeEvent(absent), { ok: false, reason: 'missing_timestamp' });
});

test('normalizes Elasticsearch epoch-milliseconds serialized with a decimal suffix', () => {
  const raw: RawEventDocument = { index: 'logs-technical.otel-dev-000001', id: 'epoch', sourceType: 'technical', source: { '@timestamp': '1788204490623.0' } };
  const result = normalizeEvent(raw);
  assert.equal(result.ok, true);
  assert.equal(result.event.timestamp, '2026-08-31T19:28:10.623Z');
});

test('missing raw references return an explicit failure', () => {
  const raw: RawEventDocument = { index: '', id: '', sourceType: 'alert', source: { '@timestamp': '2026-08-31T12:00:00Z' } };
  assert.deepEqual(normalizeEvent(raw), { ok: false, reason: 'missing_raw_ref' });
});

test('unknown input fields and PII are ignored by the allowlist', async () => {
  const event = await eventFrom('privacy-attack.json');
  const serialized = JSON.stringify(event);
  for (const forbiddenValue of ['Jane Example', 'jane@example.test', '99999-9999', 'SELECT *', '4111111111111111']) {
    assert.equal(serialized.includes(forbiddenValue), false, `${forbiddenValue} must not leave the boundary`);
  }
});

test('alert free text is redacted and truncated', async () => {
  const raw = await fixture('alert-secret-and-long-reason.json');
  const source = raw.source as { reason: string };
  source.reason += ` ${'x'.repeat(MAX_FREE_TEXT_LENGTH + 50)}`;
  const result = normalizeEvent(raw);
  assert.equal(result.ok, true);
  assert.equal(result.event.alert?.reason?.includes('secret-token'), false);
  assert.equal(result.event.alert?.reason?.includes('top-secret'), false);
  assert.equal(result.event.alert?.reason?.includes('postgresql://'), false);
  assert.ok((result.event.alert?.reason?.length ?? 0) <= MAX_FREE_TEXT_LENGTH + 1);
});

test('privacy boundary rejects prohibited keys recursively and never persists raw payload', async () => {
  const event = await eventFrom('privacy-attack.json');
  const prohibited = ['authorization', 'cookie', 'jwt', 'password', 'email', 'phone', 'sql', 'bindings', 'connectionstring', 'body'];
  const keys = collectKeys(event);
  for (const key of prohibited) assert.equal(keys.includes(key), false, `${key} key must be absent`);
  assert.equal(Object.hasOwn(event, 'source'), true);
  assert.equal(JSON.stringify(event).includes('unknownPayload'), false);
});
