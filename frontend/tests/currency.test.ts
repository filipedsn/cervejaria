import assert from 'node:assert/strict';
import { it } from 'node:test';
import { formatCurrencyInput, formatCurrencyInputFromNumber, parseCurrencyInput } from '../src/lib/currency';

it('masks typed currency digits as Brazilian reais and cents', () => {
  assert.equal(formatCurrencyInput('500'), 'R$\u00a05,00');
  assert.equal(parseCurrencyInput('R$ 5,00'), 5);
  assert.equal(formatCurrencyInputFromNumber(5), 'R$\u00a05,00');
  assert.equal(parseCurrencyInput(''), 0);
});
