import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyEvent, emptyHealth, IncidentGrouper, IncidentStore, normalizeIncidentRoute, recordProcessingHealth } from '../src/incidents/index.js';
import type { CorrelationRelation } from '../src/correlation.js';
import type { Incident, NormalizedEvent } from '../src/types.js';

function event(id: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { schemaVersion: 1, eventId: id, timestamp: '2026-08-31T12:00:00.000Z', source: 'technical', service: 'quiver-api', releaseSha: 'r1', rawRef: { index: 'synthetic', id }, ...overrides };
}
function group(events: readonly NormalizedEvent[], relations: readonly CorrelationRelation[] = [], existingIncidents: readonly Incident[] = [], referenceTime = '2026-08-31T12:05:00.000Z') { return new IncidentGrouper().group({ events, relations, existingIncidents, referenceTime }); }

test('normalizes routes and generates one multi-request DB incident despite different correlation IDs', () => {
  assert.equal(normalizeIncidentRoute('/api/comandas/12345/fechar?x=1'), '/api/comandas/:id/fechar');
  assert.equal(normalizeIncidentRoute('/api/item/550e8400-e29b-41d4-a716-446655440000'), '/api/item/:id');
  const result = group([
    event('a', { correlationId: 'corr-a', eventType: 'db.connection.failed', db: { category: 'CONNECTION' }, http: { route: '/api/comandas/1/fechar', statusCode: 500 }, tenantId: 'one' }),
    event('b', { timestamp: '2026-08-31T12:10:00.000Z', correlationId: 'corr-b', eventType: 'db.connection.failed', db: { category: 'CONNECTION' }, http: { route: '/api/comandas/2/fechar', statusCode: 500 }, tenantId: 'two' })
  ]);
  assert.equal(result.incidents.length, 1); assert.equal(result.incidents[0]?.occurrences, 2);
  assert.equal(result.decisions.find((decision) => decision.eventId === 'b')?.code, 'SAME_INCIDENT_FINGERPRINT');
});

test('deduplicates repeated event IDs, does not mutate inputs, and is input-order deterministic', () => {
  const events = [event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } }), event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })];
  const before = structuredClone(events); const first = group(events); const second = group([...events].reverse());
  assert.deepEqual(events, before); assert.equal(first.incidents[0]?.occurrences, 1); assert.deepEqual(first.incidents, second.incidents);
});

test('splits releases and opens a new episode after the active grouping window', () => {
  const a = event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } });
  const releaseB = event('b', { timestamp: '2026-08-31T12:01:00.000Z', releaseSha: 'r2', eventType: 'db.connection.failed', db: { category: 'CONNECTION' } });
  assert.equal(group([a, releaseB]).incidents.length, 2);
  const original = group([a]).incidents;
  const future = event('future', { timestamp: '2026-08-31T12:31:00.000Z', eventType: 'db.connection.failed', db: { category: 'CONNECTION' } });
  const result = group([future], [], original, '2026-08-31T12:31:00.000Z');
  assert.equal(result.incidents.length, 2); assert.notEqual(result.incidents[0]?.incidentId, result.incidents[1]?.incidentId);
});

test('uses a deterministic relation to group batch events while preserving release conflicts', () => {
  const a = event('a', { correlationId: 'shared', eventType: 'http.request.failed', http: { route: '/a', statusCode: 500 } });
  const b = event('b', { timestamp: '2026-08-31T12:40:00.000Z', correlationId: 'shared', eventType: 'http.request.failed', http: { route: '/a', statusCode: 500 } });
  const relation: CorrelationRelation = { anchorEventId: 'a', relatedEventId: 'b', level: 'DETERMINISTIC', reasons: [{ code: 'SAME_CORRELATION_ID' }] };
  assert.equal(group([a, b], [relation]).incidents.length, 1);
  assert.equal(group([a, { ...b, releaseSha: 'r2' }], [relation]).incidents.length, 2);
});

test('closes inactive incidents only from explicit reference time', () => {
  const created = group([event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })]).incidents;
  const result = group([], [], created, '2026-08-31T13:00:00.000Z');
  assert.equal(result.incidents[0]?.status, 'CLOSED'); assert.ok(result.incidents[0]?.reasons.some((reason) => reason.code === 'CLOSED_INACTIVE_WINDOW'));
});

test('classifier covers all V1 classes with objective synthetic signals', () => {
  const cases: Array<[string, Partial<NormalizedEvent>]> = [
    ['AVAILABILITY', { eventType: 'service.unavailable' }], ['DATABASE_FAILURE', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } }], ['DATABASE_SLOW', { eventType: 'db.operation.slow', db: { category: 'TIMEOUT', durationMs: 1000 } }],
    ['AUTH_FAILURE', { action: 'auth.login', outcome: 'failure' }], ['AUTHORIZATION_DENIED', { http: { statusCode: 403 } }], ['REALTIME_AUTH_FAILURE', { realtime: { action: 'connection.denied' } }], ['APPLICATION_ERROR', { http: { statusCode: 500 } }],
    ['FRONTEND_ERROR', { eventType: 'frontend.render' }], ['PERFORMANCE', { http: { durationMs: 1000 } }], ['BUSINESS_FAILURE', { action: 'order.checkout', outcome: 'failure' }], ['TELEMETRY_FAILURE', { eventType: 'telemetry.ingest' }], ['UNKNOWN', {}]
  ];
  for (const [expected, overrides] of cases) assert.equal(classifyEvent(event(expected, overrides)).class, expected);
});

test('severity is conservative and confidence is distinct from correlation level', () => {
  const db = group([event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } }), event('b', { timestamp: '2026-08-31T12:01:00.000Z', eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })]).incidents[0];
  assert.equal(db?.severity, 'SEV2'); assert.equal(db?.confidence, 'MEDIUM');
  const auth = group([event('auth', { action: 'auth.login', outcome: 'failure' })]).incidents[0]; assert.equal(auth?.severity, 'SEV3');
  const unknown = group([event('unknown')]).incidents[0]; assert.equal(unknown?.severity, 'SEV4'); assert.equal(unknown?.confidence, 'LOW');
  const deterministic: CorrelationRelation = { anchorEventId: 'x', relatedEventId: 'y', level: 'DETERMINISTIC', reasons: [{ code: 'SAME_REQUEST_ID' }] };
  const high = group([event('x', { source: 'audit', eventType: 'db.connection.failed', db: { category: 'CONNECTION' } }), event('y', { source: 'technical', eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })], [deterministic]).incidents[0];
  assert.equal(high?.confidence, 'HIGH');
});

test('confidence applies source failure and conflict penalties', () => {
  const result = new IncidentGrouper().group({ events: [event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' } })], relations: [], conflicts: [{ anchorEventId: 'a', relatedEventId: 'none', conflictingKeys: ['requestId'] }], sourceFailures: [{ source: 'technical', kind: 'timeout' }], existingIncidents: [], referenceTime: '2026-08-31T12:01:00.000Z' });
  assert.equal(result.incidents[0]?.confidence, 'LOW'); assert.ok(result.incidents[0]?.reasons.some((reason) => reason.code.includes('PENALTY')));
});

test('store loads empty, atomically saves/reloads, locks, rejects corrupt/schema-invalid data and excludes PII', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sa-store-')); const store = new IncidentStore(directory); const second = new IncidentStore(directory);
  try {
    assert.deepEqual(await store.loadIncidents(), { schemaVersion: 1, storeVersion: 1, incidents: [] });
    const incident = group([event('a', { eventType: 'db.connection.failed', db: { category: 'CONNECTION' }, tenantId: 'tenant-safe' })]).incidents[0]!;
    await store.acquireLock(); await assert.rejects(second.acquireLock(), /lock already exists/); await store.saveIncidents([incident]);
    const health = recordProcessingHealth(emptyHealth(), { referenceTime: '2026-08-31T12:00:00.000Z', eventsProcessed: 1, incidentsCreated: 1 }); await store.saveState(health); assert.equal((await store.loadState()).health.lastProcessingSuccessAt, '2026-08-31T12:00:00.000Z');
    const persisted = await store.loadIncidents(); assert.equal(persisted.incidents[0]?.incidentId, incident.incidentId); assert.equal(persisted.incidents[0]?.occurrences, 1);
    const serialized = await readFile(join(directory, 'incidents.json'), 'utf8'); for (const key of ['actorId', 'correlationId', 'raw', 'email', 'sql']) assert.equal(serialized.toLowerCase().includes(key.toLowerCase()), false);
    await store.releaseLock(); await writeFile(join(directory, 'incidents.json'), '{broken'); await assert.rejects(store.loadIncidents(), /corrupted/);
    await writeFile(join(directory, 'incidents.json'), JSON.stringify({ schemaVersion: 2, incidents: [] })); await assert.rejects(store.loadIncidents(), /incompatible/);
  } finally { await store.releaseLock(); await second.releaseLock(); await rm(directory, { recursive: true, force: true }); }
});
