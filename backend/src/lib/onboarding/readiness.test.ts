import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOnboardingReadiness,
  type OnboardingReadinessFacts,
} from './readiness.js';

function facts(overrides: Partial<OnboardingReadinessFacts> = {}): OnboardingReadinessFacts {
  return {
    hasHistoricalSale: false,
    quiosque: {
      enabled: true,
      controlaEstoque: false,
      temCozinha: false,
      hasActivePointOrTrailer: true,
      hasSellableProduct: true,
      hasSellableAssociation: true,
      hasOpenOperation: false,
    },
    cervejaria: {
      enabled: false,
      hasActivePointOrTrailer: false,
      hasSellableProduct: false,
      hasSellableAssociation: false,
      hasOpenOperation: false,
    },
    ...overrides,
  };
}

function codes(result: ReturnType<typeof deriveOnboardingReadiness>, module: 'quiosque' | 'cervejaria') {
  return result.modules[module].missingSteps.map((item) => item.code);
}

test('quiosque 00 não exige estoque e fica pronto com produto, ponto e caixa', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: { ...facts().quiosque, hasOpenOperation: true },
  }), true);

  assert.equal(result.mode, 'QUIOSQUE');
  assert.equal(result.modules.quiosque.ready, true);
  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_FIRST_SALE']);
});

test('quiosque 10 bloqueia saldo somente quando não há produto vendável no ponto', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: {
      ...facts().quiosque,
      controlaEstoque: true,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_STOCK']);
});

test('quiosque 10 aceita produto que não controla estoque', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: {
      ...facts().quiosque,
      controlaEstoque: true,
      hasOpenOperation: true,
      hasSellableAssociation: true,
    },
  }), true);

  assert.equal(result.modules.quiosque.ready, true);
  assert.equal(result.capacities.controlaEstoque, true);
});

test('quiosque 01 não cria requisito artificial de cozinha', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: { ...facts().quiosque, temCozinha: true, hasOpenOperation: true },
  }), true);

  assert.equal(result.modules.quiosque.ready, true);
  assert.equal(result.capacities.temCozinha, true);
  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_FIRST_SALE']);
});

test('quiosque 11 mantém somente a pendência real de caixa após saldo disponível', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: {
      ...facts().quiosque,
      controlaEstoque: true,
      temCozinha: true,
      hasOpenOperation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_CASH_REGISTER']);
});

test('quiosque sem produto não anuncia saldo nem caixa antecipadamente', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: {
      ...facts().quiosque,
      controlaEstoque: true,
      hasSellableProduct: false,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_PRODUCT']);
});

test('produto sem preço válido é tratado como produto pendente', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: {
      ...facts().quiosque,
      hasSellableProduct: false,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_PRODUCT']);
});

test('cervejaria distingue produto, tap e operação aberta', () => {
  const base = facts({
    quiosque: { ...facts().quiosque, enabled: false },
    cervejaria: {
      enabled: true,
      hasActivePointOrTrailer: true,
      hasSellableProduct: true,
      hasSellableAssociation: false,
      hasOpenOperation: false,
    },
  });

  assert.deepEqual(codes(deriveOnboardingReadiness(base, true), 'cervejaria'), ['CERVEJARIA_TAP']);

  const withTap = deriveOnboardingReadiness({
    ...base,
    cervejaria: { ...base.cervejaria, hasSellableAssociation: true },
  }, true);
  assert.deepEqual(codes(withTap, 'cervejaria'), ['CERVEJARIA_OPERATION']);
});

test('cervejaria pronta sem venda mantém apenas FIRST_SALE', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: { ...facts().quiosque, enabled: false },
    cervejaria: {
      enabled: true,
      hasActivePointOrTrailer: true,
      hasSellableProduct: true,
      hasSellableAssociation: true,
      hasOpenOperation: true,
    },
  }), true);

  assert.equal(result.operationReady, true);
  assert.deepEqual(codes(result, 'cervejaria'), ['CERVEJARIA_FIRST_SALE']);
});

test('híbrida calcula ambos os módulos sem selecionar um deles', () => {
  const result = deriveOnboardingReadiness(facts({
    quiosque: { ...facts().quiosque, hasOpenOperation: true },
    cervejaria: {
      enabled: true,
      hasActivePointOrTrailer: true,
      hasSellableProduct: false,
      hasSellableAssociation: false,
      hasOpenOperation: false,
    },
  }), true);

  assert.equal(result.mode, 'HIBRIDA');
  assert.equal(result.modules.quiosque.ready, true);
  assert.deepEqual(codes(result, 'cervejaria'), ['CERVEJARIA_PRODUCT']);
});

test('venda histórica encerra FIRST_SALE sem esconder readiness atual', () => {
  const result = deriveOnboardingReadiness(facts({
    hasHistoricalSale: true,
    quiosque: { ...facts().quiosque, hasOpenOperation: true },
  }), true);

  assert.equal(result.hasHistoricalSale, true);
  assert.equal(result.firstSaleCompleted, true);
  assert.deepEqual(codes(result, 'quiosque'), []);
});

test('atendente recebe readiness mas não capacidade administrativa', () => {
  const result = deriveOnboardingReadiness(facts(), false);

  assert.equal(result.canConfigure, false);
  assert.deepEqual(codes(result, 'quiosque'), ['QUIOSQUE_CASH_REGISTER']);
});
