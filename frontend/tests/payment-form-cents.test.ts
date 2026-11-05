import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moneyEquals, toCents, formatCurrencyInputFromNumber, parseCurrencyInput } from '../src/lib/currency';
import {
  createDefaultPaymentForm,
  paymentSummary,
  syncCoveringPaymentForm,
  type PaymentFormRow,
} from '../src/components/PaymentFormModal';

describe('money cents helpers', () => {
  it('toCents arredonda para centavos inteiros', () => {
    assert.equal(toCents(383), 38300);
    assert.equal(toCents(382.99), 38299);
    assert.equal(toCents(0.005), 1);
  });

  it('moneyEquals distingue 382.99 de 383.00', () => {
    assert.equal(moneyEquals(382.99, 383), false);
    assert.equal(moneyEquals(383, 383), true);
    assert.equal(moneyEquals(383.001, 383), true);
  });
});

describe('paymentSummary isBalanced', () => {
  it('não considera balanceado quando falta 1 centavo (382.99 vs 383.00)', () => {
    const form: PaymentFormRow[] = [
      { forma: 'CARTAO', tipoCartao: 'DEBITO', valor: formatCurrencyInputFromNumber(382.99) },
    ];
    const summary = paymentSummary(form, 383);
    assert.equal(parseCurrencyInput(form[0].valor), 382.99);
    assert.equal(summary.isBalanced, false);
    assert.equal(toCents(summary.remaining), 1);
  });

  it('considera balanceado só com diff 0 centavos', () => {
    const form: PaymentFormRow[] = [
      { forma: 'PIX', valor: formatCurrencyInputFromNumber(383) },
    ];
    assert.equal(paymentSummary(form, 383).isBalanced, true);
  });

  it('cortesia: total 0 centavos sem linhas', () => {
    assert.deepEqual(createDefaultPaymentForm(0), []);
    assert.deepEqual(createDefaultPaymentForm(0.004), []);
  });
});

describe('syncCoveringPaymentForm', () => {
  it('atualiza quando o formulário ficou 1 centavo atrás do total', () => {
    const prev: PaymentFormRow[] = [
      { forma: 'CARTAO', tipoCartao: 'DEBITO', valor: formatCurrencyInputFromNumber(382.99) },
    ];
    const next = syncCoveringPaymentForm(prev, 383);
    assert.equal(parseCurrencyInput(next[0].valor), 383);
    assert.equal(next[0].forma, 'CARTAO');
    assert.equal(next[0].tipoCartao, 'DEBITO');
  });

  it('não altera quando cents já batem', () => {
    const prev: PaymentFormRow[] = [
      { forma: 'PIX', valor: formatCurrencyInputFromNumber(383) },
    ];
    const next = syncCoveringPaymentForm(prev, 383);
    assert.equal(next, prev);
  });

  it('não mexe em pagamento dividido', () => {
    const prev: PaymentFormRow[] = [
      { forma: 'PIX', valor: formatCurrencyInputFromNumber(200) },
      { forma: 'DINHEIRO', valor: formatCurrencyInputFromNumber(183) },
    ];
    assert.equal(syncCoveringPaymentForm(prev, 383), prev);
  });
});
