import { PageHeader } from '../components/PageHeader';
import { ConfigKpisComandaPanel } from '../components/ConfigKpisComandaPanel';
import { ConfigComandasLayoutPanel } from '../components/ConfigComandasLayoutPanel';
import { ConfigCardapioPanel } from '../components/ConfigCardapioPanel';
import { ConfigCardapioOperacaoPanel } from '../components/ConfigCardapioOperacaoPanel';
import { ConfigMesasOperacaoPanel } from '../components/ConfigMesasOperacaoPanel';
import { OperationalCapabilitiesPanel } from '../components/OperationalCapabilitiesPanel';
import { OnboardingManualEntry } from '../components/OnboardingManualEntry';

type OperacaoPageProps = {
  embedded?: boolean;
  /** Operacao: só preferências do operacao; cervejaria (padrão): inclui cardápio por evento. */
  modo?: 'cervejaria' | 'operacao';
};

export function OperacaoPage({ embedded, modo = 'cervejaria' }: OperacaoPageProps = {}) {
  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader title="Operação" subtitle="Preferências do dia a dia na tela de comandas" />
      )}
      <OperationalCapabilitiesPanel />
      <ConfigKpisComandaPanel />
      <ConfigComandasLayoutPanel />
      {modo === 'cervejaria' && <ConfigCardapioPanel />}
      {modo === 'operacao' && <ConfigCardapioOperacaoPanel />}
      {modo === 'operacao' && <ConfigMesasOperacaoPanel />}
      {modo === 'cervejaria' && <ConfigCardapioOperacaoPanel />}
      <OnboardingManualEntry />
    </div>
  );
}
