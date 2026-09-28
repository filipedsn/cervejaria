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
    configuracaoOperacao: { create: async () => { calls.push('legacy'); } },
    pontoVenda: { create: async () => { calls.push('pos'); } },
  };
}

test('new provisioning materializes one explicit operation mode without physical resources', async () => {
  const db = tx();
  await provisionEstablishment(db, { nome: 'Novo', slug: 'novo', dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' }, enablements: { plannedOperations: true, taps: true, inventory: true, kitchen: true } });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement']);
});

test('new basic provisioning leaves operational setup pending for the owner first access', async () => {
  const db = tx();
  const result = await provisionEstablishment(db, {
    nome: 'Novo',
    slug: 'novo',
    dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' },
  });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement']);
  assert.equal(result.configuracaoOperacional.setupCompletedAt, null);
  assert.equal('plannedOperationsEnabled' in result.configuracaoOperacional, false);
  assert.equal('tapsEnabled' in result.configuracaoOperacional, false);
});

test('legacy adapter confines mode mapping and legacy resources', () => {
  const legacy = adaptLegacyProvisioning({ cervejariaNome: 'Legado', donoNome: 'Dono', donoEmail: 'd@x.test', senhaHash: 'hash', moduloCervejaria: true, moduloOperacao: true, operacaoControlaEstoque: true, operacaoTemCozinha: false }, 'legado');
  assert.deepEqual(legacy.input.enablements, { plannedOperations: true, taps: true, inventory: true, kitchen: false });
  assert.equal(legacy.resources.createTrailer, true);
  assert.equal(legacy.resources.createPointOfSale, true);
});
