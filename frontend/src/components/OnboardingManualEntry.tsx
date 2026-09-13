import { useState } from 'react';
import { useOnboarding } from '../contexts/OnboardingContext';

export function OnboardingManualEntry() {
  const { manualEntryVisible, openOnboarding, openError } = useOnboarding();
  const [isOpening, setIsOpening] = useState(false);
  if (!manualEntryVisible) return null;

  const open = async () => {
    setIsOpening(true);
    await openOnboarding({ source: 'MANUAL' });
    setIsOpening(false);
  };

  return (
    <section className="settings-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Como começar a vender</h2>
          <p className="text-sm text-ink-faint">Revise os próximos passos com base na operação atual.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void open()} disabled={isOpening}>
          {isOpening ? 'Carregando…' : 'Abrir'}
        </button>
      </div>
      {openError && <p className="mt-3 text-sm text-red-600" role="status">{openError}</p>}
    </section>
  );
}
