import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDashboardPeriodo } from './dashboard-periodo.js';

const now = new Date(2026, 9, 18, 12, 0, 0);

test('current and past months are accepted, defaulting to the current month', () => {
  assert.deepEqual(parseDashboardPeriodo({}, now), { ok: true, periodo: { ano: 2026, mes: 10 } });
  assert.deepEqual(parseDashboardPeriodo({ ano: '2026', mes: '10' }, now), { ok: true, periodo: { ano: 2026, mes: 10 } });
  assert.deepEqual(parseDashboardPeriodo({ ano: '2025', mes: '12' }, now), { ok: true, periodo: { ano: 2025, mes: 12 } });
});

test('future months and years are refused', () => {
  assert.deepEqual(parseDashboardPeriodo({ ano: '2026', mes: '11' }, now), { ok: false, error: 'Período futuro indisponível' });
  assert.deepEqual(parseDashboardPeriodo({ ano: '2027', mes: '1' }, now), { ok: false, error: 'Período futuro indisponível' });
});

test('malformed periods are refused', () => {
  for (const query of [{ ano: 'x', mes: '1' }, { ano: '2026', mes: '0' }, { ano: '2026', mes: '13' }]) {
    assert.deepEqual(parseDashboardPeriodo(query, now), { ok: false, error: 'Período inválido' });
  }
});
