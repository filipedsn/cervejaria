import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimeOnEventDate } from './event-datetime.js';
import { buildTempoComandaStats } from './evento-comanda-tempo.js';

const eventoData = new Date('2025-07-15T03:00:00.000Z');

test('buildTempoComandaStats calcula media e distribuicao por faixa', () => {
    const comandas = [
      {
        fechadaEm: parseTimeOnEventDate(eventoData, '20:20'),
        updatedAt: parseTimeOnEventDate(eventoData, '20:20'),
        total: 0,
        pagamentos: [{ pagoEm: parseTimeOnEventDate(eventoData, '20:20') }],
        itens: [{ createdAt: parseTimeOnEventDate(eventoData, '20:00') }],
      },
      {
        fechadaEm: parseTimeOnEventDate(eventoData, '21:00'),
        updatedAt: parseTimeOnEventDate(eventoData, '21:00'),
        total: 0,
        pagamentos: [{ pagoEm: parseTimeOnEventDate(eventoData, '21:00') }],
        itens: [{ createdAt: parseTimeOnEventDate(eventoData, '20:30') }],
      },
    ];

    const stats = buildTempoComandaStats(comandas);
    assert.equal(stats.mediaMinutos, 25);
    assert.equal(stats.distribuicao.find((d) => d.faixa === 'Até 15 min')?.comandas, 0);
    assert.equal(stats.distribuicao.find((d) => d.faixa === '15–30 min')?.comandas, 1);
    assert.equal(stats.distribuicao.find((d) => d.faixa === '30–60 min')?.comandas, 1);
});

test('buildTempoComandaStats ignora comandas sem itens', () => {
    const stats = buildTempoComandaStats([
      {
        fechadaEm: parseTimeOnEventDate(eventoData, '20:20'),
        updatedAt: parseTimeOnEventDate(eventoData, '20:20'),
        total: 0,
        pagamentos: [],
        itens: [],
      },
    ]);
    assert.equal(stats.mediaMinutos, 0);
    assert.equal(stats.distribuicao.every((d) => d.comandas === 0), true);
});
