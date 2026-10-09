import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTransacaoLogRows } from './pdv-unico-transacao-log-comparison.mjs';

const original = () => ({
  id: 'audit-1', cervejariaId: 'tenant-1', tipo: 'COMANDA_ATUALIZADA', usuarioId: 'user-1',
  eventoId: null, comandaId: 'command-1', entidadeTipo: 'Comanda', entidadeId: 'command-1',
  metadata: { values: ['first', { b: 2, a: 1 }], actor: { id: 'user-1', role: 'ADMIN' } },
  createdAt: new Date('2026-10-08T12:00:00.000Z'),
});

test('compara metadata completa, ignorando somente a ordem das chaves de objetos e instantes equivalentes', () => {
  const before = original();
  const after = { ...before, metadata: { actor: { role: 'ADMIN', id: 'user-1' }, values: ['first', { a: 1, b: 2 }] }, createdAt: new Date('2026-10-08T09:00:00.000-03:00') };
  assert.deepEqual(compareTransacaoLogRows([before], [after]).differences, []);
});

test('bloqueia alteração real de metadata e informa somente o caminho, nunca os valores', () => {
  const before = original();
  const after = original();
  after.metadata.actor.role = 'OWNER';
  const result = compareTransacaoLogRows([before], [after]);
  assert.deepEqual(result.differences, [{ id: 'audit-1', path: 'metadata.actor.role', kind: 'value-mismatch' }]);
  assert.equal(JSON.stringify(result).includes('OWNER'), false);
});

test('bloqueia mudança na ordem dos arrays e de seus valores', () => {
  const before = original();
  const after = original();
  after.metadata.values.reverse();
  assert.ok(compareTransacaoLogRows([before], [after]).differences.some(({ path }) => path === 'metadata.values[0]'));
});

test('bloqueia mudança em qualquer campo escalar, tenant ou conjunto de IDs', () => {
  const before = original();
  const after = original();
  after.cervejariaId = 'tenant-2';
  after.tipo = 'COMANDA_CANCELADA';
  assert.deepEqual(compareTransacaoLogRows([before], [after]).differences.map(({ path }) => path), ['cervejariaId', 'tipo']);
  assert.deepEqual(compareTransacaoLogRows([before], []).differences, [{ id: 'audit-1', path: '$', kind: 'missing-in-destination' }]);
});
