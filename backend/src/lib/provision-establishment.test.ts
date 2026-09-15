import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptLegacyProvisioning, provisionEstablishment } from './provision-establishment.js';

function tx() {
  const calls: string[] = [];
  return {
    calls,
    cervejaria: { create: async ({ data }: any) => { calls.push('tenant'); return { id: 'tenant', ...data }; } },
    usuario: { create: async ({ data }: any) => { calls.push('owner'); return { id: 'owner', ...data }; } },
    configuracaoOperacional: { create: async ({ data }: any) => { calls.push('enablement'); return data; } },
    configuracaoQuiosque: { create: async () => { calls.push('legacy'); } },
    pontoVenda: { create: async () => { calls.push('pos'); } },
  };
}

test('new provisioning materializes capabilities without physical resources', async () => {
  const db = tx();
  await provisionEstablishment(db, { nome: 'Novo', slug: 'novo', dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' }, enablements: { directSales: true, plannedOperations: true, taps: true, inventory: true, kitchen: true } });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement']);
});

test('legacy adapter confines mode mapping and legacy resources', () => {
  const legacy = adaptLegacyProvisioning({ cervejariaNome: 'Legado', donoNome: 'Dono', donoEmail: 'd@x.test', senhaHash: 'hash', moduloCervejaria: true, moduloQuiosque: true, quiosqueControlaEstoque: true, quiosqueTemCozinha: false }, 'legado');
  assert.deepEqual(legacy.input.enablements, { directSales: true, plannedOperations: true, taps: true, inventory: true, kitchen: false });
  assert.equal(legacy.resources.createTrailer, true);
  assert.equal(legacy.resources.createPointOfSale, true);
});
