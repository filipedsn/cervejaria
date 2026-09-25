import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOnboardingReadiness,
  type OnboardingReadinessFacts,
} from './readiness.js';

function facts(overrides: Partial<OnboardingReadinessFacts> = {}): OnboardingReadinessFacts {
  return {
    hasHistoricalSale: false,
    operacao: {
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

function codes(result: ReturnType<typeof deriveOnboardingReadiness>, module: 'operacao' | 'cervejaria') {
  return result.modules[module].missingSteps.map((item) => item.code);
}

test('operacao 00 não exige estoque e fica pronto com produto, ponto e caixa', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: { ...facts().operacao, hasOpenOperation: true },
  }), true);

  assert.equal(result.mode, 'CAIXA');
  assert.equal(result.modules.operacao.ready, true);
  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_FIRST_SALE']);
});

test('operacao 10 bloqueia saldo somente quando não há produto vendável no ponto', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: {
      ...facts().operacao,
      controlaEstoque: true,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_STOCK']);
});

test('operacao 10 aceita produto que não controla estoque', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: {
      ...facts().operacao,
      controlaEstoque: true,
      hasOpenOperation: true,
      hasSellableAssociation: true,
    },
  }), true);

  assert.equal(result.modules.operacao.ready, true);
  assert.equal(result.capacities.controlaEstoque, true);
});

test('operacao 01 não cria requisito artificial de cozinha', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: { ...facts().operacao, temCozinha: true, hasOpenOperation: true },
  }), true);

  assert.equal(result.modules.operacao.ready, true);
  assert.equal(result.capacities.temCozinha, true);
  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_FIRST_SALE']);
});

test('operacao 11 mantém somente a pendência real de caixa após saldo disponível', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: {
      ...facts().operacao,
      controlaEstoque: true,
      temCozinha: true,
      hasOpenOperation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_CASH_REGISTER']);
});

test('operacao sem produto não anuncia saldo nem caixa antecipadamente', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: {
      ...facts().operacao,
      controlaEstoque: true,
      hasSellableProduct: false,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_PRODUCT']);
});

test('produto sem preço válido é tratado como produto pendente', () => {
  const result = deriveOnboardingReadiness(facts({
    operacao: {
      ...facts().operacao,
      hasSellableProduct: false,
      hasSellableAssociation: false,
    },
  }), true);

  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_PRODUCT']);
});

test('cervejaria distingue produto, tap e operação aberta', () => {
  const base = facts({
    operacao: { ...facts().operacao, enabled: false },
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
    operacao: { ...facts().operacao, enabled: false },
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
    operacao: { ...facts().operacao, hasOpenOperation: true },
    cervejaria: {
      enabled: true,
      hasActivePointOrTrailer: true,
      hasSellableProduct: false,
      hasSellableAssociation: false,
      hasOpenOperation: false,
    },
  }), true);

  assert.equal(result.mode, 'EVENTO');
  assert.deepEqual(codes(result, 'cervejaria'), ['CERVEJARIA_PRODUCT']);
});

test('venda histórica encerra FIRST_SALE sem esconder readiness atual', () => {
  const result = deriveOnboardingReadiness(facts({
    hasHistoricalSale: true,
    operacao: { ...facts().operacao, hasOpenOperation: true },
  }), true);

  assert.equal(result.hasHistoricalSale, true);
  assert.equal(result.firstSaleCompleted, true);
  assert.deepEqual(codes(result, 'operacao'), []);
});

test('atendente recebe readiness mas não capacidade administrativa', () => {
  const result = deriveOnboardingReadiness(facts(), false);

  assert.equal(result.canConfigure, false);
  assert.deepEqual(codes(result, 'operacao'), ['CAIXA_CASH_REGISTER']);
});
