export type OnboardingMode = 'CAIXA' | 'EVENTO';
export type OnboardingModule = 'QUIOSQUE' | 'CERVEJARIA';
export type OnboardingSource = 'AUTO' | 'MANUAL';

export type OnboardingStepCode =
  | 'QUIOSQUE_POINT'
  | 'QUIOSQUE_PRODUCT'
  | 'QUIOSQUE_STOCK'
  | 'QUIOSQUE_CASH_REGISTER'
  | 'QUIOSQUE_FIRST_SALE'
  | 'CERVEJARIA_TRAILER'
  | 'CERVEJARIA_PRODUCT'
  | 'CERVEJARIA_TAP'
  | 'CERVEJARIA_OPERATION'
  | 'CERVEJARIA_FIRST_SALE';

export interface OnboardingStep {
  code: OnboardingStepCode;
  complete: boolean;
}

export interface OnboardingModuleReadiness {
  enabled: boolean;
  ready: boolean;
  missingSteps: OnboardingStep[];
}

export interface OnboardingReadiness {
  mode: OnboardingMode;
  capacities: {
    controlaEstoque: boolean;
    temCozinha: boolean;
  };
  hasHistoricalSale: boolean;
  firstSaleCompleted: boolean;
  operationReady: boolean;
  canConfigure: boolean;
  modules: {
    quiosque: OnboardingModuleReadiness;
    cervejaria: OnboardingModuleReadiness;
  };
}

export interface OnboardingEligibilityInput {
  isDono: boolean;
  isAdmin: boolean;
  readiness?: OnboardingReadiness;
  isLoading: boolean;
  isError: boolean;
  dismissedLocally: boolean;
}

export interface OnboardingUiState {
  isOpen: boolean;
  source: OnboardingSource | null;
  selectedModule: OnboardingModule | null;
  dismissedLocally: boolean;
}

export type OnboardingUiAction =
  | { type: 'OPEN'; source: OnboardingSource; selectedModule: OnboardingModule | null }
  | { type: 'CLOSE' }
  | { type: 'DISMISS_AUTO' }
  | { type: 'SELECT_MODULE'; selectedModule: OnboardingModule | null }
  | { type: 'SET_DISMISSED'; dismissedLocally: boolean };

export const ONBOARDING_QUERY_KEY = 'onboarding-readiness';

/** Refreshes the operational snapshot after a real mutation; it never changes onboarding UI state. */
export function invalidateOnboardingReadiness(queryClient: {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
}): unknown {
  return queryClient.invalidateQueries({ queryKey: [ONBOARDING_QUERY_KEY] });
}

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserLocalStorage(): LocalStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Storage is an optional convenience only: onboarding must remain fail-open. */
export function safeLocalStorageGet(key: string, storage: LocalStorageLike | null = browserLocalStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(
  key: string,
  value: string,
  storage: LocalStorageLike | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // A blocked browser storage must not prevent the operational UI from continuing.
  }
}

export function onboardingQueryKey(cervejariaId: string | null, usuarioId: string | null) {
  return [ONBOARDING_QUERY_KEY, cervejariaId, usuarioId] as const;
}

export function onboardingDismissStorageKey(cervejariaId: string, usuarioId: string): string {
  return `tap-quiver:onboarding-dismissed:${cervejariaId}:${usuarioId}`;
}

export function isOnboardingDismissed(storageKey: string, storage?: LocalStorageLike | null): boolean {
  return Boolean(safeLocalStorageGet(storageKey, storage));
}

export function hasApplicableOnboardingModule(readiness: OnboardingReadiness | undefined): boolean {
  return Boolean(readiness?.modules.quiosque.enabled || readiness?.modules.cervejaria.enabled);
}

export function isAutoStartAllowed(input: OnboardingEligibilityInput): boolean {
  const { readiness } = input;
  return Boolean(
    input.isDono &&
      !input.isAdmin &&
      readiness?.canConfigure &&
      !readiness.hasHistoricalSale &&
      !input.dismissedLocally &&
      !input.isLoading &&
      !input.isError &&
      hasApplicableOnboardingModule(readiness),
  );
}

export function isManualStartAllowed(input: Pick<OnboardingEligibilityInput, 'isDono' | 'isAdmin' | 'readiness'>): boolean {
  return Boolean(
    input.isDono &&
      !input.isAdmin &&
      input.readiness?.canConfigure &&
      hasApplicableOnboardingModule(input.readiness),
  );
}

export function initialSelectedModule(readiness: OnboardingReadiness): OnboardingModule | null {
  if (readiness.mode === 'CAIXA') return 'QUIOSQUE';
  if (readiness.mode === 'EVENTO') return 'CERVEJARIA';
  if (readiness.modules.quiosque.enabled) return 'QUIOSQUE';
  if (readiness.modules.cervejaria.enabled) return 'CERVEJARIA';
  return null;
}

export function getNextOnboardingAction(
  readiness: OnboardingReadiness | undefined,
  selectedModule: OnboardingModule | null,
): OnboardingStepCode | null {
  if (!readiness) return null;

  const module = selectedModule ?? initialSelectedModule(readiness);
  if (!module) return null;

  const readinessModule = module === 'QUIOSQUE' ? readiness.modules.quiosque : readiness.modules.cervejaria;
  return readinessModule.missingSteps.find(
    (missingStep) => !readiness.firstSaleCompleted || !missingStep.code.endsWith('_FIRST_SALE'),
  )?.code ?? null;
}

export function createOnboardingUiState(dismissedLocally: boolean): OnboardingUiState {
  return { isOpen: false, source: null, selectedModule: null, dismissedLocally };
}

export function onboardingUiReducer(state: OnboardingUiState, action: OnboardingUiAction): OnboardingUiState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, isOpen: true, source: action.source, selectedModule: action.selectedModule };
    case 'CLOSE':
      return { ...state, isOpen: false, source: null, selectedModule: null };
    case 'DISMISS_AUTO':
      return { ...state, isOpen: false, source: null, selectedModule: null, dismissedLocally: true };
    case 'SELECT_MODULE':
      return { ...state, selectedModule: action.selectedModule };
    case 'SET_DISMISSED':
      return { ...state, dismissedLocally: action.dismissedLocally };
  }
}
