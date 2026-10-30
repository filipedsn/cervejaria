import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCervejariaDashboardPeriodo } from './cervejaria-dashboard-periodo.js';

const now = new Date(2026, 9, 18, 12, 0, 0);

test('modo mes defaults to current month', () => {
  const result = parseCervejariaDashboardPeriodo({}, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.periodo.tipo, 'mes');
  if (result.periodo.tipo === 'mes') {
    assert.equal(result.periodo.ano, 2026);
    assert.equal(result.periodo.mes, 10);
  }
});

test('modo periodo accepts inclusive range', () => {
  const result = parseCervejariaDashboardPeriodo({
    modo: 'periodo',
    de: '2026-09-10',
    ate: '2026-09-25',
  }, now);
  assert.equal(result.ok, true);
  if (!result.ok || result.periodo.tipo !== 'periodo') return;
  assert.equal(result.periodo.de, '2026-09-10');
  assert.equal(result.periodo.ate, '2026-09-25');
  assert.match(result.periodo.label, /10\/09\/2026/);
});

test('modo periodo refuses inverted or future ranges', () => {
  assert.equal(parseCervejariaDashboardPeriodo({ modo: 'periodo', de: '2026-10-20', ate: '2026-10-10' }, now).ok, false);
  assert.equal(parseCervejariaDashboardPeriodo({ modo: 'periodo', de: '2026-11-01', ate: '2026-11-05' }, now).ok, false);
});
