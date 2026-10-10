import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveCashSessionConflictError, resolveUniqueOpenCashSession } from './cash-session-resolution.js';

describe('active operational cash session resolution', () => {
  it('returns no session or the sole open session without consulting a civil day', () => {
    const session = { id: 'overnight-session', diaOperacional: '2026-10-09' };
    assert.equal(resolveUniqueOpenCashSession([]), null);
    assert.equal(resolveUniqueOpenCashSession([session]), session);
  });

  it('reports multiple active sessions without choosing one', () => {
    assert.throws(
      () => resolveUniqueOpenCashSession([{ id: 'first' }, { id: 'second' }]),
      (error: unknown) => error instanceof ActiveCashSessionConflictError && error.statusCode === 409,
    );
  });
});
