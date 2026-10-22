import assert from 'node:assert/strict';
import test from 'node:test';
import { flushAuditEvents, flushPendingAuditAfterAuth, trackClick, setAuditIdentity, setAuditPortalSession, getAuditQueueStats } from '../src/lib/audit-tracker';

test('failed queued events cannot cross user or tenant boundary and buffers are bounded', async () => {
  Object.assign(globalThis, { window: { location: { pathname: '/operacao' } } });
  const original = globalThis.fetch;
  const bodies: string[] = [];
  try {
    globalThis.fetch = async (_url, options) => { bodies.push(String(options?.body)); return new Response('', { status: 503 }); };
    setAuditIdentity('actor-a', 'tenant-a');
    trackClick('operacao-caixa-abrir'); await flushAuditEvents();
    setAuditIdentity(null, null);
    setAuditIdentity('actor-b', 'tenant-b'); flushPendingAuditAfterAuth();
    globalThis.fetch = async (_url, options) => { bodies.push(String(options?.body)); return new Response(null, { status: 204 }); };
    await flushAuditEvents();
    assert.equal(bodies.length, 1, 'A is never resent as B');
    globalThis.fetch = async () => new Response('', { status: 503 });
    for (let i = 0; i < 600; i++) trackClick('operacao-caixa-abrir');
    assert.ok(getAuditQueueStats().queued <= 200);
    assert.ok(getAuditQueueStats().dropped > 0);
  } finally { setAuditIdentity(null, null); globalThis.fetch = original; }
});

test('portal command changes discard failed events from the previous customer session', async () => {
  Object.assign(globalThis, { window: { location: { pathname: '/c/qa-a/p/pdv' } } });
  const original = globalThis.fetch;
  const bodies: Array<{ events: Array<{ portalSession?: { comandaId: string } }> }> = [];
  try {
    globalThis.fetch = async (_url, options) => { bodies.push(JSON.parse(String(options?.body))); return new Response('', { status: 503 }); };
    setAuditPortalSession('command-a', 'qa-a');
    trackClick('operacao-confirmar-pagamento');
    await flushAuditEvents();
    window.location.pathname = '/c/qa-b/p/pdv';
    setAuditPortalSession('command-b', 'qa-b');
    globalThis.fetch = async (_url, options) => { bodies.push(JSON.parse(String(options?.body))); return new Response(null, { status: 204 }); };
    await flushAuditEvents();
    assert.equal(bodies.length, 2);
    assert.ok(bodies[1].events.every(e => e.portalSession?.comandaId === 'command-b'));
    assert.doesNotMatch(JSON.stringify(bodies[1]), /command-a/);
  } finally { setAuditPortalSession(null, null); globalThis.fetch = original; }
});
