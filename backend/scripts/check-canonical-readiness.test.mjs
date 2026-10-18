import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCanonicalReadiness } from './check-canonical-readiness.mjs';

const ready = { id: 'a', slug: 'a', nome: 'A', pontosVenda: [{ id: 'p1', ativo: true, configuracaoPdv: { id: 'c1' } }, { id: 'p0', ativo: false, configuracaoPdv: null }] };
const global = { PDV_CANONICAL_ALL: '1' };

test('ready when every active tenant has exactly one configured active PDV and activation is global', () => {
  assert.deepEqual(evaluateCanonicalReadiness([ready], global), { status: 'READY', activation: 'PDV_CANONICAL_ALL', activeTenants: 1, blocked: [] });
});

test('blocks tenants without PDV, with several PDVs or without canonical configuration', () => {
  const result = evaluateCanonicalReadiness([
    ready,
    { id: 'b', slug: 'b', nome: 'B', pontosVenda: [] },
    { id: 'c', slug: 'c', nome: 'C', pontosVenda: [{ id: 'p', ativo: true, configuracaoPdv: { id: 'x' } }, { id: 'q', ativo: true, configuracaoPdv: { id: 'y' } }] },
    { id: 'd', slug: 'd', nome: 'D', pontosVenda: [{ id: 'p', ativo: true, configuracaoPdv: null }] },
  ], global);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.blocked.map(({ slug, reasons }) => [slug, reasons]), [
    ['b', ['sem PDV ativo']],
    ['c', ['2 PDVs ativos']],
    ['d', ['PDV sem configuração canônica']],
  ]);
});

test('blocks while the runtime is not globally canonical', () => {
  assert.equal(evaluateCanonicalReadiness([ready], { PDV_CANONICAL_TENANTS: 'a' }).status, 'BLOCKED');
  assert.equal(evaluateCanonicalReadiness([ready], {}).activation, 'NONE');
});
