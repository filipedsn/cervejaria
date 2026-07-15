import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFluxoPorIntervalo, sumFluxoFechado } from './evento-fluxo-intervalo.js';
import { parseTimeOnEventDate } from './event-datetime.js';

const eventoData = new Date('2026-07-14T00:00:00.000Z');
const evento = { data: eventoData, horaInicio: '18:00', horaFim: '23:45' };

test('buildFluxoPorIntervalo separa pedido e fechado em buckets distintos', () => {
  const pedidoEm = parseTimeOnEventDate(eventoData, '20:00');
  const fechadaEm = parseTimeOnEventDate(eventoData, '21:00');

  const comandas = [
    {
      id: 'c1',
      status: 'FECHADA',
      createdAt: parseTimeOnEventDate(eventoData, '19:30'),
      fechadaEm,
      updatedAt: fechadaEm,
      total: 50,
      pagamentos: [{ pagoEm: fechadaEm }],
      itens: [
        {
          id: 'i1',
          createdAt: pedidoEm,
          precoUnit: 50,
          quantidade: 1,
        },
      ],
    },
  ];

  const buckets = buildFluxoPorIntervalo(evento, comandas);
  const pedidoBucket = buckets.find((b) => b.intervalo === '20:00');
  const fechadoBucket = buckets.find((b) => b.intervalo === '21:00');
  const entreBuckets = buckets.filter((b) => b.intervalo > '20:00' && b.intervalo < '21:00');

  assert.ok(pedidoBucket);
  assert.equal(pedidoBucket!.pedido, 50);
  assert.equal(pedidoBucket!.fechado, 0);

  assert.ok(fechadoBucket);
  assert.equal(fechadoBucket!.fechado, 50);
  assert.equal(sumFluxoFechado(buckets), 50);

  assert.ok(entreBuckets.some((b) => b.aberto > 0) || buckets.some((b) => b.intervalo === '20:15' && b.aberto > 0));
});

test('buildFluxoPorIntervalo soma dois itens no mesmo bucket de pedido', () => {
  const t = parseTimeOnEventDate(eventoData, '20:10');

  const comandas = [
    {
      id: 'c1',
      status: 'FECHADA',
      createdAt: t,
      fechadaEm: parseTimeOnEventDate(eventoData, '22:00'),
      updatedAt: t,
      total: 35,
      pagamentos: [{ pagoEm: parseTimeOnEventDate(eventoData, '22:00') }],
      itens: [
        { id: 'i1', createdAt: t, precoUnit: 20, quantidade: 1 },
        { id: 'i2', createdAt: t, precoUnit: 15, quantidade: 1 },
      ],
    },
  ];

  const buckets = buildFluxoPorIntervalo(evento, comandas);
  const pedidoBucket = buckets.find((b) => b.pedido > 0);

  assert.ok(pedidoBucket);
  assert.equal(pedidoBucket!.pedido, 35);
  assert.equal(pedidoBucket!.itens, 2);
});

test('buildFluxoPorIntervalo inclui item removido no saldo aberto antes da remoção', () => {
  const pedidoEm = parseTimeOnEventDate(eventoData, '20:00');
  const removidoEm = parseTimeOnEventDate(eventoData, '21:30');

  const comandas = [
    {
      id: 'c1',
      status: 'FECHADA',
      createdAt: parseTimeOnEventDate(eventoData, '19:00'),
      fechadaEm: parseTimeOnEventDate(eventoData, '22:00'),
      updatedAt: removidoEm,
      total: 10,
      pagamentos: [{ pagoEm: parseTimeOnEventDate(eventoData, '22:00') }],
      itens: [],
    },
  ];

  const remocoes = [{ comandaId: 'c1', createdAt: removidoEm, valor: 10 }];

  const buckets = buildFluxoPorIntervalo(evento, comandas, remocoes);
  const antesRemocao = buckets.find((b) => b.intervalo === '21:00');
  const depoisRemocao = buckets.find((b) => b.intervalo === '21:30');

  assert.ok(antesRemocao);
  assert.ok(depoisRemocao);
  assert.ok(antesRemocao!.aberto >= depoisRemocao!.aberto);
});
