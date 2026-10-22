import assert from 'node:assert/strict';
import test from 'node:test';
import * as tracker from '../src/lib/audit-tracker';

test('401 queued in A is not replayed when B logs in', async () => {
  Object.assign(globalThis, { window: { location: { pathname: '/operacao' } } });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    tracker.setAuditIdentity?.('actor-a', 'tenant-a');
    globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }); };
    tracker.trackClick('operacao-caixa-abrir');
    await tracker.flushAuditEvents();
    tracker.setAuditIdentity?.(null, null);
    tracker.setAuditIdentity?.('actor-b', 'tenant-b');
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
    tracker.flushPendingAuditAfterAuth();
    await tracker.flushAuditEvents();
    assert.equal(calls, 1, 'A action must be discarded rather than attributed to B');
  } finally { tracker.setAuditIdentity?.(null, null); globalThis.fetch = original; }
});
