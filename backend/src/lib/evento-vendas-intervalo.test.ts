import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVendasPorIntervalo,
  getCloseTime,
  sumVendasPorIntervalo,
} from './evento-vendas-intervalo.js';
import { parseTimeOnEventDate } from './event-datetime.js';

test('getCloseTime prefere fechadaEm sobre updatedAt', () => {
  const fechadaEm = new Date('2026-07-15T20:00:00.000Z');
  const updatedAt = new Date('2026-07-14T23:00:00.000Z');
  assert.equal(getCloseTime({ fechadaEm, updatedAt, total: 10, pagamentos: [] }).getTime(), fechadaEm.getTime());
});

test('buildVendasPorIntervalo inclui fechamento fora da janela agendada', () => {
  const eventoData = new Date('2026-07-14T00:00:00.000Z');
  const evento = {
    data: eventoData,
    horaInicio: '18:00',
    horaFim: '23:45',
  };

  const fechadaEm = parseTimeOnEventDate(new Date('2026-07-15T00:00:00.000Z'), '20:30');
  const comandas = [
    {
      fechadaEm,
      updatedAt: fechadaEm,
      total: 28,
      pagamentos: [{ pagoEm: fechadaEm }],
    },
    {
      fechadaEm,
      updatedAt: fechadaEm,
      total: 15,
      pagamentos: [{ pagoEm: fechadaEm }],
    },
  ];

  const buckets = buildVendasPorIntervalo(evento, comandas);
  const chartTotal = sumVendasPorIntervalo(buckets);
  const comandasNoGrafico = buckets.reduce((s, b) => s + b.comandas, 0);

  assert.equal(chartTotal, 43);
  assert.equal(comandasNoGrafico, 2);
  assert.ok(buckets.some((b) => b.receita > 0), 'deve existir bucket com receita > 0');
});

test('buildVendasPorIntervalo mantem vendas dentro do horario agendado', () => {
  const eventoData = new Date('2026-07-14T00:00:00.000Z');
  const fechadaEm = parseTimeOnEventDate(eventoData, '20:15');
  const comandas = [
    {
      fechadaEm,
      updatedAt: fechadaEm,
      total: 50,
      pagamentos: [{ pagoEm: fechadaEm }],
    },
  ];

  const buckets = buildVendasPorIntervalo(
    { data: eventoData, horaInicio: '18:00', horaFim: '23:45' },
    comandas,
  );

  assert.equal(sumVendasPorIntervalo(buckets), 50);
  assert.ok(buckets.some((b) => b.intervalo === '20:15' && b.receita === 50));
});
