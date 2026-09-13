import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useOnboardingReadiness } from '../hooks/useOnboardingReadiness';
import {
  createOnboardingUiState,
  initialSelectedModule,
  isAutoStartAllowed,
  isManualStartAllowed,
  isOnboardingDismissed,
  onboardingDismissStorageKey,
  onboardingUiReducer,
  safeLocalStorageSet,
  type OnboardingModule,
  type OnboardingSource,
} from '../lib/onboarding';

interface OpenOnboardingOptions {
  source: OnboardingSource;
}

interface OnboardingContextType {
  isOpen: boolean;
  source: OnboardingSource | null;
  selectedModule: OnboardingModule | null;
  dismissedLocally: boolean;
  manualStartAllowed: boolean;
  manualEntryVisible: boolean;
  openError: string | null;
  openOnboarding: (options: OpenOnboardingOptions) => Promise<boolean>;
  closeOnboarding: () => void;
  dismissAutoOnboarding: () => void;
  selectModule: (module: OnboardingModule | null) => void;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);
// Survives route-level provider remounts without turning a temporary close into
// a persisted dismissal. A full browser refresh may legitimately try auto-start again.
const autoAttemptedInSession = new Set<string>();

function readDismissed(storageKey: string | null): boolean {
  return Boolean(storageKey && isOnboardingDismissed(storageKey));
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { cervejaria, usuario, isDono, isAdmin } = useAuth();
  const readinessQuery = useOnboardingReadiness();
  const cervejariaId = cervejaria?.id ?? null;
  const usuarioId = usuario?.id ?? null;
  const storageKey = cervejariaId && usuarioId ? onboardingDismissStorageKey(cervejariaId, usuarioId) : null;
  const [state, dispatch] = useReducer(onboardingUiReducer, readDismissed(storageKey), createOnboardingUiState);
  const [openError, setOpenError] = useReducer((_: string | null, value: string | null) => value, null);

  useEffect(() => {
    dispatch({ type: 'SET_DISMISSED', dismissedLocally: readDismissed(storageKey) });
    setOpenError(null);
  }, [storageKey]);

  const eligibility = useMemo(
    () => ({
      isDono,
      isAdmin,
      readiness: readinessQuery.data,
      isLoading: readinessQuery.isLoading,
      isError: readinessQuery.isError,
      dismissedLocally: state.dismissedLocally,
    }),
    [isAdmin, isDono, readinessQuery.data, readinessQuery.isError, readinessQuery.isLoading, state.dismissedLocally],
  );
  const manualStartAllowed = isManualStartAllowed(eligibility);
  // In a degraded query state the owner still needs an entry point to retry;
  // opening remains guarded by a fresh readiness result.
  const manualEntryVisible = Boolean(
    isDono && !isAdmin && cervejariaId && usuarioId && (manualStartAllowed || readinessQuery.isError),
  );

  useEffect(() => {
    const sessionKey = storageKey;
    if (!sessionKey || autoAttemptedInSession.has(sessionKey) || !isAutoStartAllowed(eligibility)) return;

    autoAttemptedInSession.add(sessionKey);
    dispatch({
      type: 'OPEN',
      source: 'AUTO',
      selectedModule: initialSelectedModule(eligibility.readiness!),
    });
  }, [eligibility, storageKey]);

  const openOnboarding = useCallback(async ({ source }: OpenOnboardingOptions): Promise<boolean> => {
    setOpenError(null);
    const result = await readinessQuery.refetch();
    if (result.isError || !result.data) {
      setOpenError('Não foi possível carregar o estado atual da operação. Tente novamente.');
      return false;
    }

    const canOpen = source === 'MANUAL'
      ? isManualStartAllowed({ isDono, isAdmin, readiness: result.data })
      : isAutoStartAllowed({
          isDono,
          isAdmin,
          readiness: result.data,
          isLoading: false,
          isError: false,
          dismissedLocally: state.dismissedLocally,
        });
    if (!canOpen) return false;

    dispatch({ type: 'OPEN', source, selectedModule: initialSelectedModule(result.data) });
    return true;
  }, [isAdmin, isDono, readinessQuery, state.dismissedLocally]);

  const closeOnboarding = useCallback(() => {
    setOpenError(null);
    dispatch({ type: 'CLOSE' });
  }, []);

  const dismissAutoOnboarding = useCallback(() => {
    if (storageKey) safeLocalStorageSet(storageKey, 'true');
    dispatch({ type: 'DISMISS_AUTO' });
  }, [storageKey]);

  const value = useMemo<OnboardingContextType>(() => ({
    isOpen: state.isOpen,
    source: state.source,
    selectedModule: state.selectedModule,
    dismissedLocally: state.dismissedLocally,
    manualStartAllowed,
    manualEntryVisible,
    openError,
    openOnboarding,
    closeOnboarding,
    dismissAutoOnboarding,
    selectModule: (selectedModule) => dispatch({ type: 'SELECT_MODULE', selectedModule }),
  }), [closeOnboarding, dismissAutoOnboarding, manualEntryVisible, manualStartAllowed, openError, openOnboarding, state]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used within OnboardingProvider');
  return context;
}
