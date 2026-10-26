import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { cached } from './exec.mjs';

test('cache: leituras simultâneas viram uma só', async () => {
  let calls = 0;
  const slow = async () => {
    calls += 1;
    await sleep(20);
    return calls;
  };
  const [a, b] = await Promise.all([cached('t1', 1_000, slow), cached('t1', 1_000, slow)]);
  assert.deepEqual([a, b, calls], [1, 1, 1]);
});

test('cache stale: devolve o anterior na hora e renova em segundo plano', async () => {
  let n = 0;
  const read = async () => {
    await sleep(20);
    n += 1;
    return n;
  };
  assert.equal(await cached('t2', 0, read, false, { stale: true }), 1, 'sem valor anterior: espera a leitura');
  assert.equal(await cached('t2', 0, read, false, { stale: true }), 1, 'vencido: devolve o anterior');
  await sleep(40);
  assert.equal(await cached('t2', 60_000, read), 2, 'a renovação em segundo plano já gravou');
});
