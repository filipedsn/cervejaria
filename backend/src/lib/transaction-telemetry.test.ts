import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterTransactionCommit, currentTransactionTelemetry, withTransactionTelemetry } from './transaction-telemetry.js';

test('publishes success after commit only, never after rollback or ambiguous commit failure', async () => {
  const effects: string[] = [];
  const states: string[] = [];
  await withTransactionTelemetry(async () => {
    afterTransactionCommit(() => effects.push('success'));
    assert.deepEqual(effects, []);
  }, (_id, state) => states.push(state));
  assert.deepEqual(effects, ['success']);
  const failure = new Error('commit refused');
  await assert.rejects(withTransactionTelemetry(async () => {
    afterTransactionCommit(() => effects.push('false-success'));
    throw failure;
  }, (_id, state, _duration, discarded) => {
    states.push(state); assert.equal(discarded, 1);
  }), failure);
  assert.deepEqual(effects, ['success']);
  assert.deepEqual(states, ['committed', 'not_confirmed']);
});

test('parallel transactions isolate their queues and preserve business results when exporters fail', async () => {
  const ids = new Set<string>();
  const effects: number[] = [];
  const outcomes = await Promise.allSettled([1, 2].map(n => withTransactionTelemetry(async () => {
    ids.add(currentTransactionTelemetry()!.id);
    afterTransactionCommit(() => effects.push(n));
    afterTransactionCommit(() => { throw new Error('export unavailable'); });
    await new Promise(resolve => setTimeout(resolve, 5));
    if (n === 2) throw new Error('rollback');
    return n;
  }, () => { throw new Error('logger unavailable'); })));
  assert.equal(ids.size, 2);
  assert.deepEqual(effects, [1]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(currentTransactionTelemetry(), undefined);
});
