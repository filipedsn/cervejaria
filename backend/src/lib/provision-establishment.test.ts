import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptLegacyProvisioning, provisionEstablishment } from './provision-establishment.js';

function tx() {
  const calls: string[] = [];
  let pointSequence = 0;
  return {
    calls,
    cervejaria: { create: async ({ data }: any) => { calls.push('tenant'); return { id: 'tenant', ...data }; } },
    usuario: { create: async ({ data }: any) => { calls.push('owner'); return { id: 'owner', ...data }; } },
    configuracaoOperacional: { create: async ({ data }: any) => { calls.push('enablement'); return data; } },
    configuracaoOperacao: { create: async () => { calls.push('legacy'); } },
    $executeRaw: async () => { calls.push('tenant-lock'); },
    pontoVenda: {
      findMany: async () => { calls.push('check-pdv'); return []; },
      create: async ({ data }: any) => { calls.push('pdv'); return { id: `point-${++pointSequence}`, ...data }; },
    },
    configuracaoPontoVenda: { create: async ({ data }: any) => { calls.push('pdv-config'); return data; } },
  };
}

test('new provisioning atomically materializes one Por Caixa PDV and its canonical configuration', async () => {
  const db = tx();
  const result = await provisionEstablishment(db, { nome: 'Novo', slug: 'novo', dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' }, enablements: { plannedOperations: true, taps: true, inventory: true, kitchen: true } });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement', 'tenant-lock', 'check-pdv', 'pdv', 'pdv-config']);
  assert.equal(result.pontoVenda.nome, 'Principal');
  assert.deepEqual({ taps: result.configuracaoPdv.tapsEnabled, inventory: result.configuracaoPdv.inventoryEnabled, kitchen: result.configuracaoPdv.kitchenEnabled }, { taps: true, inventory: true, kitchen: true });
  assert.equal(result.configuracaoOperacional.plannedOperationsEnabled, false, 'legacy EVENTO selection does not choose another canonical motor');
});

test('new basic provisioning leaves operational setup pending for the owner first access', async () => {
  const db = tx();
  const result = await provisionEstablishment(db, {
    nome: 'Novo',
    slug: 'novo',
    dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' },
  });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement', 'tenant-lock', 'check-pdv', 'pdv', 'pdv-config']);
  assert.equal(result.configuracaoOperacional.setupCompletedAt, null);
  assert.equal('plannedOperationsEnabled' in result.configuracaoOperacional, false);
  assert.equal('tapsEnabled' in result.configuracaoOperacional, false);
  assert.equal(result.configuracaoPdv.tapsEnabled, false);
  assert.equal(result.configuracaoPdv.inventoryEnabled, false);
  assert.equal(result.configuracaoPdv.kitchenEnabled, false);
});

test('legacy adapter preserves explicit feature choices but does not create a Trailer as a PDV substitute', () => {
  const legacy = adaptLegacyProvisioning({ cervejariaNome: 'Legado', donoNome: 'Dono', donoEmail: 'd@x.test', senhaHash: 'hash', moduloCervejaria: true, moduloOperacao: true, operacaoControlaEstoque: true, operacaoTemCozinha: false }, 'legado');
  assert.deepEqual(legacy.input.enablements, { plannedOperations: true, taps: true, inventory: true, kitchen: false });
  assert.equal('createTrailer' in legacy.resources, false);
  assert.equal('createPointOfSale' in legacy.resources, false);
});
