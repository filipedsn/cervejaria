import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarIntervaloAlarmeComandas } from '../src/hooks/useComandasAtendimentoAlarme.ts';

test('TAP-156: intervalo do alarme fica entre 5 e 120 segundos', () => {
  assert.equal(normalizarIntervaloAlarmeComandas(10), 10);
  assert.equal(normalizarIntervaloAlarmeComandas(3), 5);
  assert.equal(normalizarIntervaloAlarmeComandas(200), 120);
  assert.equal(normalizarIntervaloAlarmeComandas(Number.NaN), 10);
  assert.equal(normalizarIntervaloAlarmeComandas(7.6), 8);
});
