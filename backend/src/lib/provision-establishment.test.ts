import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptLegacyProvisioning, provisionEstablishment } from './provision-establishment.js';

function tx({ oldModel = false } = {}) {
  const calls: string[] = [];
  let pointSequence = 0;
  const client: any = {
    calls,
    cervejaria: { create: async ({ data }: any) => { calls.push('tenant'); return { id: 'tenant', ...data }; } },
    usuario: { create: async ({ data }: any) => { calls.push('owner'); return { id: 'owner', ...data }; } },
    configuracaoOperacional: { create: async ({ data }: any) => { calls.push('enablement'); return data; } },
    configuracaoOperacao: { create: async ({ data }: any) => { calls.push('legacy'); return data; } },
    $executeRaw: async () => { calls.push('tenant-lock'); },
    pontoVenda: {
      findMany: async () => { calls.push('check-pdv'); return []; },
      create: async ({ data }: any) => { calls.push('pdv'); return { id: `point-${++pointSequence}`, ...data }; },
    },
    trailer: { findFirst: async () => null },
  };
  if (!oldModel) client.configuracaoPontoVenda = { create: async ({ data }: any) => { calls.push('pdv-config'); return data; } };
  return client;
}

const settings = { plannedOperations: true, taps: true, inventory: true, kitchen: true };
const input = { nome: 'Novo', slug: 'novo', dono: { nome: 'Dono', email: 'dono@x.test', senhaHash: 'hash' } };

test('canonical provisioning atomically materializes one Por Caixa PDV and its configuration while preserving legacy metadata', async () => {
  const db = tx();
  const result = await provisionEstablishment(db, { ...input, enablements: settings }, { mode: 'CANONICAL' });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement', 'tenant-lock', 'check-pdv', 'pdv', 'pdv-config']);
  assert.equal(result.pontoVenda.nome, 'Principal');
  assert.deepEqual({ taps: result.configuracaoPdv.tapsEnabled, inventory: result.configuracaoPdv.inventoryEnabled, kitchen: result.configuracaoPdv.kitchenEnabled }, { taps: true, inventory: true, kitchen: true });
  assert.equal(result.configuracaoOperacional.plannedOperationsEnabled, true, 'explicit legacy selector remains metadata and does not override canonical Por Caixa profile');
});

test('canonical defaults remain disabled/null and setup waits for owner first access', async () => {
  const db = tx();
  const result = await provisionEstablishment(db, input, { mode: 'CANONICAL' });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement', 'tenant-lock', 'check-pdv', 'pdv', 'pdv-config']);
  assert.equal(result.configuracaoOperacional.setupCompletedAt, null);
  assert.equal('plannedOperationsEnabled' in result.configuracaoOperacional, false);
  assert.equal(result.configuracaoPdv.tapsEnabled, false);
  assert.equal(result.configuracaoPdv.inventoryEnabled, false);
  assert.equal(result.configuracaoPdv.kitchenEnabled, false);
  assert.equal(result.configuracaoPdv.quantidadeMesas, null);
});

test('legacy JSON provisioning works with a client that has no PDV configuration model and preserves selector/response resources', async () => {
  const db = tx({ oldModel: true });
  const result = await provisionEstablishment(db, { ...input, enablements: settings }, { mode: 'LEGACY' });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement']);
  assert.equal(result.configuracaoOperacional.plannedOperationsEnabled, true);
  assert.equal(result.pontoVenda, null);
  assert.equal(result.configuracaoPdv, null);
});

test('legacy multipart adapter preserves Trailer, PDV and ConfiguracaoOperacao choices', async () => {
  const adapted = adaptLegacyProvisioning({ cervejariaNome: 'Legado', donoNome: 'Dono', donoEmail: 'd@x.test', senhaHash: 'hash', moduloCervejaria: true, moduloOperacao: true, operacaoControlaEstoque: true, operacaoTemCozinha: false }, 'legado');
  assert.deepEqual(adapted.input.enablements, { plannedOperations: true, taps: true, inventory: true, kitchen: false });
  assert.deepEqual(adapted.resources, { createTrailer: true, createPointOfSale: true, legacyProjection: true, legacyExclusivo: false });
  const db = tx({ oldModel: true });
  const result = await provisionEstablishment(db, adapted.input, { ...adapted.resources, mode: 'LEGACY' });
  assert.deepEqual(db.calls, ['tenant', 'owner', 'enablement', 'tenant-lock', 'check-pdv', 'pdv', 'legacy']);
  assert.equal(result.cervejaria.trailers.create.nome, 'Principal');
  assert.equal(result.pontoVenda.id, 'point-1');
  assert.equal(result.configuracaoPdv, null);
});
