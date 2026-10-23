import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dateToMesKey, mesToDateRange, mesesDisponiveisFromDates } from './chope-ranking.js';

describe('calendário do ranking mensal', () => {
  it('usa o primeiro dia inclusivo e o próximo mês exclusivo em UTC', () => {
    const range = mesToDateRange('2026-10');
    assert.ok(range);
    assert.equal(range.gte.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(range.lt.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(dateToMesKey(new Date('2026-10-01T00:00:00.000Z')), '2026-10');
    assert.equal(dateToMesKey(new Date('2026-10-31T00:00:00.000Z')), '2026-10');
    assert.equal(dateToMesKey(new Date('2026-11-01T00:00:00.000Z')), '2026-11');
  });

  it('ordena meses pelo universo de datas de vendas', () => {
    assert.deepEqual(mesesDisponiveisFromDates([
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-10-31T00:00:00.000Z'),
      new Date('2026-11-01T00:00:00.000Z'),
      null,
    ]), ['2026-11', '2026-10']);
  });
});
