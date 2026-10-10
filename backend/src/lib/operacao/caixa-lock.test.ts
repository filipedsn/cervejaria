import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lockCaixaEmTx } from './caixa-lock.js';

describe('cash session advisory lock', () => {
  it('uses one tenant and point lock across operational days', async () => {
    const keys: unknown[] = [];
    const tx = {
      $executeRaw: async (_strings: TemplateStringsArray, key: unknown) => { keys.push(key); },
    };
    await lockCaixaEmTx(tx as never, 'tenant-a', 'point-a', new Date('2026-10-09T00:00:00Z'));
    await lockCaixaEmTx(tx as never, 'tenant-a', 'point-a', new Date('2026-10-10T00:00:00Z'));
    await lockCaixaEmTx(tx as never, 'tenant-b', 'point-a', new Date('2026-10-10T00:00:00Z'));
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
  });
});
