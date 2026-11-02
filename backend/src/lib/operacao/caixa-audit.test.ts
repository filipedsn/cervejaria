import assert from 'node:assert/strict';
import test from 'node:test';
import { caixaAuditNomes } from './caixa-audit.js';

const db = (empresa: string | null, pontoVenda: string | null, calls: unknown[] = []) => ({
  cervejaria: { findUnique: async (args: unknown) => { calls.push(args); return empresa ? { nome: empresa } : null; } },
  pontoVenda: { findFirst: async (args: unknown) => { calls.push(args); return pontoVenda ? { nome: pontoVenda } : null; } },
});

test('caixaAuditNomes: nomes da empresa e do ponto de venda do mesmo tenant', async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await caixaAuditNomes('t1', 'pv1', db('Cervejaria Alfa', 'Balcão', calls)), { empresaNome: 'Cervejaria Alfa', pontoVendaNome: 'Balcão' });
  assert.deepEqual(calls[1], { where: { id: 'pv1', cervejariaId: 't1' }, select: { nome: true } });
});

test('caixaAuditNomes: sem ponto de venda ou sem registro, omite o campo', async () => {
  assert.deepEqual(await caixaAuditNomes('t1', null, db('Cervejaria Alfa', 'Balcão')), { empresaNome: 'Cervejaria Alfa' });
  assert.deepEqual(await caixaAuditNomes('t1', 'pv1', db(null, null)), {});
});

test('caixaAuditNomes: falha na consulta não bloqueia o caixa', async () => {
  const broken = { cervejaria: { findUnique: async () => { throw new Error('db down'); } }, pontoVenda: { findFirst: async () => null } };
  assert.deepEqual(await caixaAuditNomes('t1', 'pv1', broken), {});
});
