import { getNextOnboardingAction } from '../lib/onboarding';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useOnboardingReadiness } from '../hooks/useOnboardingReadiness';

/** Temporary functional surface. The guided visual experience belongs to the next stage. */
export function OnboardingSurface() {
  const { isOpen, source, selectedModule, selectModule, closeOnboarding, dismissAutoOnboarding } = useOnboarding();
  const { data: readiness, isError } = useOnboardingReadiness();
  if (!isOpen) return null;

  const isHybrid = readiness?.mode === 'HIBRIDA';
  const nextAction = getNextOnboardingAction(readiness, selectedModule);

  return (
    <div role="dialog" aria-modal="true" aria-label="Como começar a vender" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
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
            {nextAction && <p className="mt-4 text-sm" data-testid="onboarding-next-action">Próxima ação: {nextAction}</p>}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {source === 'AUTO' && <button type="button" className="btn-secondary" onClick={dismissAutoOnboarding}>Agora não</button>}
          <button type="button" className="btn-primary" onClick={closeOnboarding}>Fechar</button>
        </div>
      </section>
    </div>
  );
}
