import assert from 'node:assert/strict';
import test from 'node:test';
import { schedulesOverlap, sessaoReservaTrailerWhere } from './evento-overlap.js';

test('somente eventos abertos ou ainda não iniciados reservam o trailer', () => {
  assert.deepEqual(sessaoReservaTrailerWhere(), {
    OR: [
      { status: 'ABERTO' },
      { status: 'FECHADO', encerradoEm: null },
    ],
  });
});

test('detecta sobreposição e permite horários adjacentes', () => {
  assert.equal(
    schedulesOverlap(
      { horaInicio: '18:00', horaFim: null },
      { horaInicio: '18:00', horaFim: '20:00' },
    ),
    true,
  );
  assert.equal(
    schedulesOverlap(
      { horaInicio: '20:00', horaFim: '21:00' },
      { horaInicio: '18:00', horaFim: '20:00' },
    ),
    false,
  );
});
