import assert from 'node:assert/strict';
import test from 'node:test';
import { proximoVencimento } from './admin-empresas.js';
import { socketPertenceACervejaria } from './realtime.js';

// 2026-11-10 15:00 BRT
const now = new Date('2026-11-10T18:00:00Z');

test('sem dia de vencimento não há próximo vencimento', () => {
  assert.equal(proximoVencimento(null, null, now), null);
});

test('vencimento ainda neste mês, inclusive hoje', () => {
  assert.deepEqual(proximoVencimento(15, null, now), { data: '2026-11-15', diasRestantes: 5 });
  assert.deepEqual(proximoVencimento(10, null, now), { data: '2026-11-10', diasRestantes: 0 });
});

test('vencimento já passado neste mês vai para o próximo', () => {
  assert.deepEqual(proximoVencimento(5, null, now), { data: '2026-12-05', diasRestantes: 25 });
});

test('dia 31 vence no último dia de meses mais curtos', () => {
  const fevereiro = new Date('2027-02-01T15:00:00Z');
  assert.deepEqual(proximoVencimento(31, null, fevereiro), { data: '2027-02-28', diasRestantes: 27 });
  assert.deepEqual(proximoVencimento(31, null, now), { data: '2026-11-30', diasRestantes: 20 });
});

test('dezembro passa para janeiro do ano seguinte', () => {
  const dezembro = new Date('2026-12-20T15:00:00Z');
  assert.deepEqual(proximoVencimento(10, null, dezembro), { data: '2027-01-10', diasRestantes: 21 });
});

test('contrato que ainda não começou vence a partir do início', () => {
  const inicio = new Date(Date.UTC(2027, 0, 20));
  assert.deepEqual(proximoVencimento(10, inicio, now), { data: '2027-02-10', diasRestantes: 92 });
});

test('o dia de hoje segue Brasília perto da meia-noite UTC', () => {
  const noiteBrt = new Date('2026-11-11T01:30:00Z'); // 10/11 22:30 BRT
  assert.deepEqual(proximoVencimento(10, null, noiteBrt), { data: '2026-11-10', diasRestantes: 0 });
});

test('inativação derruba equipe e portal da empresa, nunca o admin da plataforma', () => {
  assert.equal(socketPertenceACervejaria({ user: { papel: 'DONO', cervejariaId: 'a' } }, 'a'), true);
  assert.equal(socketPertenceACervejaria({ user: { papel: 'ATENDENTE', cervejariaId: 'a' } }, 'a'), true);
  assert.equal(socketPertenceACervejaria({ clienteSession: { cervejariaId: 'a' } }, 'a'), true);
  assert.equal(socketPertenceACervejaria({ user: { papel: 'ADMIN', cervejariaId: null } }, 'a'), false);
  assert.equal(socketPertenceACervejaria({ user: { papel: 'DONO', cervejariaId: 'b' } }, 'a'), false);
  assert.equal(socketPertenceACervejaria(undefined, 'a'), false);
});
