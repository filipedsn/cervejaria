import assert from 'node:assert/strict';
import test from 'node:test';
import { createSinglePdv, SinglePdvProvisioningConflictError } from './single-pdv-provisioning.js';

test('existing PDV blocks a second creation without changing the point or config', async () => {
  const calls: string[] = [];
  const tx = {
    $executeRaw: async () => { calls.push('lock'); },
    pontoVenda: {
      findMany: async () => { calls.push('read'); return [{ id: 'existing' }, { id: 'legacy-second' }]; },
      create: async () => { calls.push('create-point'); throw new Error('must not create'); },
    },
    configuracaoPontoVenda: { create: async () => { calls.push('create-config'); } },
  };
  await assert.rejects(createSinglePdv(tx, { cervejariaId: 'tenant', nome: 'Second' }), (error) => {
    assert(error instanceof SinglePdvProvisioningConflictError);
    assert.equal(error.existingCount, 2);
    assert.equal(error.code, 'PDV_ALREADY_EXISTS');
    return true;
  });
  assert.deepEqual(calls, ['lock', 'read']);
});
