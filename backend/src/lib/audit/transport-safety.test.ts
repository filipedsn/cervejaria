import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuditPayload } from './emit-audit-event.js';
import { redactLogValue } from '../logger.js';

test('audit direct transport sanitizes messages, URLs and nested metadata', () => {
  const payload = buildAuditPayload({ action: 'test.safe', message: 'Bearer synthetic-private-marker',
    metadata: { url: 'postgresql://user:synthetic-private-marker@localhost/db', accessToken: 'synthetic-private-marker',
      array: [{ authorization: 'synthetic-private-marker' }] } });
  assert.doesNotMatch(JSON.stringify(payload), /synthetic-private-marker/);
});

test('deep and cyclic values never escape and Error retains technical code', () => {
  let nested: unknown = { password: 'synthetic-private-marker' };
  for (let i = 0; i < 12; i++) nested = { nested };
  assert.doesNotMatch(JSON.stringify(redactLogValue(nested)), /synthetic-private-marker/);
  const error = Object.assign(new Error('Bearer synthetic-private-marker'), { code: 'P2002' });
  const safe = redactLogValue(error) as Error & { code: string };
  assert.equal(safe.code, 'P2002');
  assert.doesNotMatch(safe.message, /synthetic-private-marker/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.doesNotThrow(() => JSON.stringify(redactLogValue(cycle)));
});
