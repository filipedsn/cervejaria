import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEventoWhen } from '../src/lib/api';

test('formata data de evento sem deslocar o dia por fuso horário', () => {
  assert.equal(
    formatEventoWhen({ data: '2026-09-27', horaInicio: '18:00:00' }),
    '27/09/2026 · 18:00',
  );
});
