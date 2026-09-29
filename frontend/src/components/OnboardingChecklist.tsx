import { useOnboarding } from '../contexts/OnboardingContext';
import { useOnboardingReadiness } from '../hooks/useOnboardingReadiness';
import { getNextOnboardingAction, initialSelectedModule } from '../lib/onboarding';
import { getOnboardingVisualAction } from '../lib/onboarding-visual';

/** Compact residual affordance: it never covers the primary operation controls. */
export function OnboardingChecklist() {
  const { isOpen, dismissedLocally, autoStartAllowed, manualEntryVisible, openOnboarding } = useOnboarding();
  const { data: readiness } = useOnboardingReadiness();
  // The settings page already offers an in-flow manual entry. Keep the
  // floating reminder from covering that page's controls.
  if (isOpen || dismissedLocally || manualEntryVisible || !autoStartAllowed || !readiness || readiness.firstSaleCompleted) return null;
  const module = initialSelectedModule(readiness);
  const next = getNextOnboardingAction(readiness, module);
  if (!module || !next) return null;
  const action = getOnboardingVisualAction(next, module);
  if (!action) return null;
  return (
    <aside className="onboarding-checklist" aria-label="Próxima ação para começar a vender">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Falta pouco para começar a vender</p>
      <button type="button" className="mt-1 text-left font-semibold text-brand-700" onClick={() => void openOnboarding({ source: 'AUTO' })}>
        {action.cta}
      </button>
    </aside>
  );
}
