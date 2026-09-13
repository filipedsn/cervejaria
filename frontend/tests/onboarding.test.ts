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
  type OnboardingReadiness,
} from '../src/lib/onboarding.ts';

function readiness(overrides: Partial<OnboardingReadiness> = {}): OnboardingReadiness {
  return {
    mode: 'QUIOSQUE',
    capacities: { controlaEstoque: false, temCozinha: false },
    hasHistoricalSale: false,
    firstSaleCompleted: false,
    operationReady: false,
    canConfigure: true,
    modules: {
      quiosque: { enabled: true, ready: false, missingSteps: [{ code: 'QUIOSQUE_POINT', complete: false }] },
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

test('onboarding: híbrida começa sem módulo e mantém a escolha transitória', () => {
  const hybrid = readiness({
    mode: 'HIBRIDA',
    modules: {
      quiosque: { enabled: true, ready: false, missingSteps: [{ code: 'QUIOSQUE_PRODUCT', complete: false }] },
      cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_PRODUCT', complete: false }] },
    },
  });
  assert.equal(initialSelectedModule(hybrid), null);
  let state = createOnboardingUiState(false);
  state = onboardingUiReducer(state, { type: 'OPEN', source: 'MANUAL', selectedModule: null });
  state = onboardingUiReducer(state, { type: 'SELECT_MODULE', selectedModule: 'QUIOSQUE' });
  assert.equal(state.selectedModule, 'QUIOSQUE');
  state = onboardingUiReducer(state, { type: 'SELECT_MODULE', selectedModule: 'CERVEJARIA' });
  assert.equal(state.selectedModule, 'CERVEJARIA');
});

test('onboarding: próxima ação respeita capacidades, módulo e primeira venda', () => {
  const quiosque00 = readiness({ capacities: { controlaEstoque: false, temCozinha: false } });
  const quiosque10 = readiness({ capacities: { controlaEstoque: true, temCozinha: false }, modules: { quiosque: { enabled: true, ready: false, missingSteps: [{ code: 'QUIOSQUE_STOCK', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  const quiosque01 = readiness({ capacities: { controlaEstoque: false, temCozinha: true } });
  const quiosque11 = readiness({ capacities: { controlaEstoque: true, temCozinha: true }, modules: { quiosque: { enabled: true, ready: false, missingSteps: [{ code: 'QUIOSQUE_CASH_REGISTER', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  assert.equal(getNextOnboardingAction(quiosque00, 'QUIOSQUE'), 'QUIOSQUE_POINT');
  assert.equal(getNextOnboardingAction(quiosque10, 'QUIOSQUE'), 'QUIOSQUE_STOCK');
  assert.equal(getNextOnboardingAction(quiosque01, 'QUIOSQUE'), 'QUIOSQUE_POINT');
  assert.equal(getNextOnboardingAction(quiosque11, 'QUIOSQUE'), 'QUIOSQUE_CASH_REGISTER');

  const brewery = readiness({ mode: 'CERVEJARIA', modules: { quiosque: { enabled: false, ready: false, missingSteps: [] }, cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_TAP', complete: false }] } } });
  assert.equal(getNextOnboardingAction(brewery, 'CERVEJARIA'), 'CERVEJARIA_TAP');
  const hybrid = readiness({ mode: 'HIBRIDA', modules: { quiosque: { enabled: true, ready: false, missingSteps: [{ code: 'QUIOSQUE_PRODUCT', complete: false }] }, cervejaria: { enabled: true, ready: false, missingSteps: [{ code: 'CERVEJARIA_OPERATION', complete: false }] } } });
  assert.equal(getNextOnboardingAction(hybrid, 'QUIOSQUE'), 'QUIOSQUE_PRODUCT');
  assert.equal(getNextOnboardingAction(hybrid, 'CERVEJARIA'), 'CERVEJARIA_OPERATION');
  const firstSale = readiness({ operationReady: true, modules: { quiosque: { enabled: true, ready: true, missingSteps: [{ code: 'QUIOSQUE_FIRST_SALE', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
  assert.equal(getNextOnboardingAction(firstSale, 'QUIOSQUE'), 'QUIOSQUE_FIRST_SALE');
  assert.equal(getNextOnboardingAction(readiness({ firstSaleCompleted: true }), 'QUIOSQUE'), 'QUIOSQUE_POINT');
  assert.equal(getNextOnboardingAction(readiness({
    firstSaleCompleted: true,
    modules: { quiosque: { enabled: true, ready: true, missingSteps: [{ code: 'QUIOSQUE_FIRST_SALE', complete: false }] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } },
  }), 'QUIOSQUE'), null);
});
