import assert from 'node:assert/strict';
import test from 'node:test';

import {
  descreverVencimento,
  formatDataCivil,
  formatTempoAberto,
  tempoAbertoMs,
} from '../src/lib/admin-empresas.ts';

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

test('tempo aberto usa a maior unidade relevante', () => {
  assert.equal(formatTempoAberto(0), '0 min');
  assert.equal(formatTempoAberto(42 * MIN), '42 min');
  assert.equal(formatTempoAberto(3 * HORA), '3 h');
  assert.equal(formatTempoAberto(3 * HORA + 12 * MIN), '3 h 12 min');
  assert.equal(formatTempoAberto(2 * DIA + 9 * HORA + 40 * MIN), '2 d 9 h');
  assert.equal(formatTempoAberto(33 * DIA), '33 d');
});

test('relógio adiantado no navegador não gera tempo negativo', () => {
  const agora = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(tempoAbertoMs('2026-11-01T12:05:00Z', agora), 0);
  assert.equal(tempoAbertoMs('2026-11-01T11:00:00Z', agora), HORA);
});

test('vencimento descrito em linguagem do dia a dia', () => {
  assert.equal(descreverVencimento(null), null);
  assert.equal(descreverVencimento({ data: '2026-11-10', diasRestantes: 0 }), 'Vence hoje (10/11)');
  assert.equal(descreverVencimento({ data: '2026-11-11', diasRestantes: 1 }), 'Vence amanhã (11/11)');
  assert.equal(descreverVencimento({ data: '2026-12-05', diasRestantes: 25 }), 'Vence em 25 dias (05/12)');
});

test('data civil do contrato é exibida sem conversão de fuso', () => {
  assert.equal(formatDataCivil('2026-01-01'), '01/01/2026');
});
