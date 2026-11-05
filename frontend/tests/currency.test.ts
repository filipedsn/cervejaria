import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  formatCurrencyInput,
  formatCurrencyInputFromNumber,
  moneyEquals,
  parseCurrencyInput,
  toCents,
} from '../src/lib/currency';

it('masks typed currency digits as Brazilian reais and cents', () => {
  assert.equal(formatCurrencyInput('500'), 'R$\u00a05,00');
  assert.equal(parseCurrencyInput('R$ 5,00'), 5);
  assert.equal(formatCurrencyInputFromNumber(5), 'R$\u00a05,00');
  assert.equal(parseCurrencyInput(''), 0);
});

it('compares money in integer cents (382.99 !== 383.00)', () => {
  assert.equal(toCents(382.99), 38299);
  assert.equal(toCents(383), 38300);
  assert.equal(moneyEquals(382.99, 383), false);
  assert.equal(moneyEquals(383, 383.004), true);
});
