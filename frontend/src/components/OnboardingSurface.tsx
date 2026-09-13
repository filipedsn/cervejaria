import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getNextOnboardingAction, initialSelectedModule } from '../lib/onboarding';
import { getOnboardingVisualAction } from '../lib/onboarding-visual';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useOnboardingReadiness } from '../hooks/useOnboardingReadiness';

/** Contextual, non-blocking guide derived exclusively from the current readiness snapshot. */
export function OnboardingSurface() {
  const { isOpen, source, selectedModule, selectModule, closeOnboarding, dismissAutoOnboarding } = useOnboarding();
  const { data: readiness, isError } = useOnboardingReadiness();
  const navigate = useNavigate();
  const location = useLocation();
  const isHybrid = readiness?.mode === 'HIBRIDA';
  const module = selectedModule ?? (readiness ? initialSelectedModule(readiness) : null);
  const nextAction = getNextOnboardingAction(readiness, module);
  const action = useMemo(() => nextAction && module ? getOnboardingVisualAction(nextAction, module) : null, [module, nextAction]);

  useEffect(() => {
    if (!isOpen || !action) return;
    const target = document.querySelector(`[data-onboarding-target="${action.target}"]`);
    target?.classList.add('onboarding-target-highlight');
    return () => target?.classList.remove('onboarding-target-highlight');
  }, [action, location.pathname]);

  const goToAction = () => {
    if (!action) return;
    const target = document.querySelector(`[data-onboarding-target="${action.target}"]`) as HTMLElement | null;
    if (target) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      target.focus?.({ preventScroll: true });
      return;
    }
    navigate(action.to);
  };

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
            {isHybrid && !selectedModule && (
              <div className="mt-4 flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => selectModule('QUIOSQUE')}>Quiosque</button>
                <button type="button" className="btn-secondary" onClick={() => selectModule('CERVEJARIA')}>Cervejaria</button>
              </div>
            )}
            {action && (
              <div className="mt-4">
                <p className="text-sm font-semibold" data-testid="onboarding-next-action">{action.title}</p>
                <p className="mt-1 text-sm text-ink-faint">{action.detail}</p>
              </div>
            )}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {action && <button type="button" className="touch-btn-primary" onClick={goToAction}>{action.cta}</button>}
          {source === 'AUTO' && <button type="button" className="touch-btn-ghost" onClick={dismissAutoOnboarding}>Agora não</button>}
          <button type="button" className="btn-primary" onClick={closeOnboarding}>Fechar</button>
        </div>
      </section>
    </aside>
  );
}
