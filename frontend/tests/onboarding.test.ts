import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOnboardingUiState,
  getNextOnboardingAction,
  initialSelectedModule,
  isAutoStartAllowed,
  isManualStartAllowed,
  onboardingDismissStorageKey,
  onboardingUiReducer,
  isOnboardingDismissed,
  safeLocalStorageSet,
  type OnboardingReadiness,
} from '../src/lib/onboarding.ts';

function readiness(overrides: Partial<OnboardingReadiness> = {}): OnboardingReadiness {
  return {
    mode: 'CAIXA',
    capacities: { controlaEstoque: false, temCozinha: false },
    hasHistoricalSale: false,
    firstSaleCompleted: false,
    operationReady: false,
    canConfigure: true,
    modules: {
      operacao: { enabled: true, ready: false, missingSteps: [{ code: 'CAIXA_POINT', complete: false }] },
      cervejaria: { enabled: false, ready: false, missingSteps: [] },
    },
    ...overrides,
  };
}

test('onboarding: auto permite somente DONO sem venda e sem dispensa local', () => {
  const base = { isDono: true, isAdmin: false, readiness: readiness(), isLoading: false, isError: false, dismissedLocally: false };
  assert.equal(isAutoStartAllowed(base), true);
  assert.equal(isAutoStartAllowed({ ...base, readiness: readiness({ hasHistoricalSale: true }) }), false);
  assert.equal(isAutoStartAllowed({ ...base, dismissedLocally: true }), false);
  assert.equal(isAutoStartAllowed({ ...base, isDono: false }), false);
});

test('onboarding: manual ignora venda histórica e dispensa, mas exige DONO', () => {
  const historical = readiness({ hasHistoricalSale: true, firstSaleCompleted: true });
  assert.equal(isManualStartAllowed({ isDono: true, isAdmin: false, readiness: historical }), true);
  assert.equal(isManualStartAllowed({ isDono: false, isAdmin: false, readiness: historical }), false);
  assert.equal(isManualStartAllowed({ isDono: true, isAdmin: true, readiness: historical }), false);
});

test('onboarding: dispensa é isolada por tenant e usuário', () => {
  assert.equal(onboardingDismissStorageKey('cervejaria-a', 'usuario-a'), 'tap-quiver:onboarding-dismissed:cervejaria-a:usuario-a');
  assert.notEqual(onboardingDismissStorageKey('cervejaria-a', 'usuario-a'), onboardingDismissStorageKey('cervejaria-b', 'usuario-a'));
  assert.notEqual(onboardingDismissStorageKey('cervejaria-a', 'usuario-a'), onboardingDismissStorageKey('cervejaria-a', 'usuario-b'));
});

test('onboarding: SecurityError na leitura de storage degrada para não dispensado', () => {
  const blockedStorage = {
    getItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
    setItem: () => undefined,
  };
  const key = onboardingDismissStorageKey('cervejaria-a', 'usuario-a');
  assert.equal(isOnboardingDismissed(key, blockedStorage), false);
});

test('onboarding: SecurityError na gravação de storage não escapa', () => {
  const blockedStorage = {
    getItem: () => null,
    setItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
  };
  const key = onboardingDismissStorageKey('cervejaria-a', 'usuario-a');
  // The wrapper is directly injectable so the blocked-storage behavior stays deterministic in Node tests.
  assert.doesNotThrow(() => safeLocalStorageSet(key, 'true', blockedStorage));
});

test('onboarding: dismiss fecha a sessão mesmo se a gravação local falhar', () => {
  let state = createOnboardingUiState(false);
  state = onboardingUiReducer(state, { type: 'OPEN', source: 'AUTO', selectedModule: 'CAIXA' });
  state = onboardingUiReducer(state, { type: 'DISMISS_AUTO' });
  assert.equal(state.isOpen, false);
  assert.equal(state.dismissedLocally, true);
});

test('onboarding: híbrida começa sem módulo e mantém a escolha transitória', () => {
  const hybrid = readiness({
    mode: 'EVENTO',
    modules: {
      operacao: { enabled: true, ready: false, missingSteps: [{ code: 'CAIXA_PRODUCT', complete: false }] },
      cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_PRODUCT', complete: false }] },
    },
  });
  assert.equal(initialSelectedModule(hybrid), 'CERVEJARIA');
  let state = createOnboardingUiState(false);
  state = onboardingUiReducer(state, { type: 'OPEN', source: 'MANUAL', selectedModule: null });
  state = onboardingUiReducer(state, { type: 'SELECT_MODULE', selectedModule: 'CAIXA' });
  assert.equal(state.selectedModule, 'CAIXA');
  state = onboardingUiReducer(state, { type: 'SELECT_MODULE', selectedModule: 'CERVEJARIA' });
  assert.equal(state.selectedModule, 'CERVEJARIA');
});

test('onboarding: próxima ação respeita capacidades, módulo e primeira venda', () => {
  const operacao00 = readiness({ capacities: { controlaEstoque: false, temCozinha: false } });
  const operacao10 = readiness({ capacities: { controlaEstoque: true, temCozinha: false }, modules: { operacao: { enabled: true, ready: false, missingSteps: [{ code: 'CAIXA_STOCK', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  const operacao01 = readiness({ capacities: { controlaEstoque: false, temCozinha: true } });
  const operacao11 = readiness({ capacities: { controlaEstoque: true, temCozinha: true }, modules: { operacao: { enabled: true, ready: false, missingSteps: [{ code: 'CAIXA_CASH_REGISTER', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  assert.equal(getNextOnboardingAction(operacao00, 'CAIXA'), 'CAIXA_POINT');
  assert.equal(getNextOnboardingAction(operacao10, 'CAIXA'), 'CAIXA_STOCK');
  assert.equal(getNextOnboardingAction(operacao01, 'CAIXA'), 'CAIXA_POINT');
  assert.equal(getNextOnboardingAction(operacao11, 'CAIXA'), 'CAIXA_CASH_REGISTER');

  const brewery = readiness({ mode: 'CERVEJARIA', modules: { operacao: { enabled: false, ready: false, missingSteps: [] }, cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_TAP', complete: false }] } } });
  assert.equal(getNextOnboardingAction(brewery, 'CERVEJARIA'), 'CERVEJARIA_TAP');
  const hybrid = readiness({ mode: 'HIBRIDA', modules: { operacao: { enabled: true, ready: false, missingSteps: [{ code: 'CAIXA_PRODUCT', complete: false }] }, cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_OPERATION', complete: false }] } } });
  assert.equal(getNextOnboardingAction(hybrid, 'CAIXA'), 'CAIXA_PRODUCT');
  assert.equal(getNextOnboardingAction(hybrid, 'CERVEJARIA'), 'CERVEJARIA_OPERATION');
  const firstSale = readiness({ operationReady: true, modules: { operacao: { enabled: true, ready: true, missingSteps: [{ code: 'CAIXA_FIRST_SALE', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  assert.equal(getNextOnboardingAction(firstSale, 'CAIXA'), 'CAIXA_FIRST_SALE');
  assert.equal(getNextOnboardingAction(readiness({ firstSaleCompleted: true }), 'CAIXA'), 'CAIXA_POINT');
  assert.equal(getNextOnboardingAction(readiness({
    firstSaleCompleted: true,
    modules: { operacao: { enabled: true, ready: true, missingSteps: [{ code: 'CAIXA_FIRST_SALE', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } },
  }), 'CAIXA'), null);
});
