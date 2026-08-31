import assert from 'node:assert/strict';
import test from 'node:test';
import { CorrelationEngine, differenceInMinutes } from '../src/correlation.js';
import type { NormalizedEvent } from '../src/types.js';

const engine = new CorrelationEngine();
function event(id: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { schemaVersion: 1, eventId: id, timestamp: '2026-08-31T12:00:00.000Z', source: 'audit', rawRef: { index: 'synthetic', id }, ...overrides };
}
function one(anchor: NormalizedEvent, candidate: NormalizedEvent) { return engine.correlate(anchor, [candidate]); }

test('correlates exact correlation, request and trace IDs deterministically with priority', () => {
  assert.equal(one(event('a', { correlationId: 'corr' }), event('b', { correlationId: 'corr' })).relations[0]?.reasons[0]?.code, 'SAME_CORRELATION_ID');
  assert.equal(one(event('a', { requestId: 'request' }), event('b', { requestId: 'request' })).relations[0]?.reasons[0]?.code, 'SAME_REQUEST_ID');
  assert.equal(one(event('a', { traceId: 'trace' }), event('b', { traceId: 'trace' })).relations[0]?.reasons[0]?.code, 'SAME_TRACE_ID');
  const priority = one(event('a', { correlationId: 'corr', requestId: 'req' }), event('b', { correlationId: 'corr', requestId: 'req' }));
  assert.deepEqual(priority.relations[0], { anchorEventId: 'a', relatedEventId: 'b', level: 'DETERMINISTIC', reasons: [{ code: 'SAME_CORRELATION_ID' }] });
});

test('classifies strong, probable and temporal-only weak evidence', () => {
  const anchor = event('a', { service: 'api', releaseSha: 'r1', tenantId: 't1', http: { route: '/orders' } });
  assert.equal(one(anchor, event('strong', { timestamp: '2026-08-31T12:04:00.000Z', service: 'api', releaseSha: 'r1', tenantId: 't1', http: { route: '/orders' } })).relations[0]?.level, 'STRONG');
  assert.equal(one(anchor, event('probable', { timestamp: '2026-08-31T12:10:00.000Z', service: 'api', releaseSha: 'r1', http: { route: '/orders' } })).relations[0]?.level, 'PROBABLE');
  assert.equal(one(anchor, event('weak', { timestamp: '2026-08-31T12:04:00.000Z' })).relations[0]?.level, 'WEAK');
});

test('does not promote conflicting explicit IDs based on matching tenant, route and time', () => {
  const result = one(event('a', { correlationId: 'corr-a', tenantId: 't', http: { route: '/orders' } }), event('b', { timestamp: '2026-08-31T12:01:00.000Z', correlationId: 'corr-b', tenantId: 't', http: { route: '/orders' }, service: 'api', releaseSha: 'r' }));
  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.conflicts, [{ anchorEventId: 'a', relatedEventId: 'b', conflictingKeys: ['correlationId'] }]);
});

test('uses DB category as probable contextual evidence and rejects distant events', () => {
  const anchor = event('a', { service: 'api', releaseSha: 'r', db: { category: 'TIMEOUT' } });
  assert.equal(one(anchor, event('b', { timestamp: '2026-08-31T12:14:00.000Z', service: 'api', releaseSha: 'r', db: { category: 'TIMEOUT' } })).relations[0]?.level, 'PROBABLE');
  assert.deepEqual(one(anchor, event('far', { timestamp: '2026-08-31T13:00:00.000Z' })).relations, []);
  assert.equal(differenceInMinutes('2026-08-31T12:00:00Z', '2026-08-31T12:05:00Z'), 5);
});

test('is deterministic, deduplicates candidates, ignores anchor and does not mutate input', () => {
  const anchor = event('a', { correlationId: 'corr' });
  const candidate = event('b', { correlationId: 'corr' });
  const input = [candidate, anchor, candidate, event('c', { correlationId: 'corr' })];
  const before = structuredClone(input);
  const first = engine.correlate(anchor, input);
  const second = engine.correlate(anchor, [...input].reverse());
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.relations.map((relation) => relation.relatedEventId), ['b', 'c']);
});

test('records a source failure as technical state without treating absence as evidence', () => {
  const result = engine.correlate(event('a'), [], [{ source: 'technical', kind: 'timeout' }]);
  assert.deepEqual(result, { relations: [], conflicts: [], sourceFailures: [{ source: 'technical', kind: 'timeout' }] });
});
