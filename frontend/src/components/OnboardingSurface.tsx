import { useEffect, useMemo } from 'react';
import { getNextOnboardingAction, initialSelectedModule } from '../lib/onboarding';
import { getOnboardingVisualAction } from '../lib/onboarding-visual';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useOnboardingReadiness } from '../hooks/useOnboardingReadiness';

/** Contextual, non-blocking guide derived exclusively from the current readiness snapshot. */
export function OnboardingSurface() {
  const { isOpen, source, selectedModule, closeOnboarding, dismissAutoOnboarding } = useOnboarding();
  const { data: readiness, isError } = useOnboardingReadiness();
  const module = selectedModule ?? (readiness ? initialSelectedModule(readiness) : null);
  const nextAction = getNextOnboardingAction(readiness, module);
  const action = useMemo(() => nextAction && module ? getOnboardingVisualAction(nextAction, module) : null, [module, nextAction]);

  useEffect(() => {
    if (!isOpen || !action) return;
    const target = document.querySelector(`[data-onboarding-target="${action.target}"]`);
    target?.classList.add('onboarding-target-highlight');
    return () => target?.classList.remove('onboarding-target-highlight');
  }, [action]);

  if (!isOpen) return null;

  return (
    <aside role="region" aria-label="Como começar a vender" className="onboarding-sheet">
      <section className="onboarding-sheet-card">
        <h2 className="text-lg font-semibold">Como começar a vender</h2>
        {isError || !readiness ? (
          <p className="mt-2 text-sm text-ink-faint">Não foi possível carregar o estado atual da operação.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-faint">
              {readiness.firstSaleCompleted ? 'Use este resumo como ajuda para a operação atual.' : 'Estado atual da operação carregado.'}
            </p>
            {action && (
              <div className="mt-4">
                <p className="text-sm font-semibold" data-testid="onboarding-next-action">{action.title}</p>
                <p className="mt-1 text-sm text-ink-faint">{action.detail}</p>
              </div>
            )}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {/* The surrounding page already owns the operational CTA. Keep this guide informational. */}
          {source === 'AUTO' && <button type="button" className="touch-btn-ghost" onClick={dismissAutoOnboarding}>Agora não</button>}
          <button type="button" className="btn-primary" onClick={closeOnboarding}>Fechar</button>
        </div>
      </section>
    </aside>
  );
}
