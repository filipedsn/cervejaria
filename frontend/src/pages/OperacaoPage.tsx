import { PageHeader } from '../components/PageHeader';
import { ConfigKpisComandaPanel } from '../components/ConfigKpisComandaPanel';
import { ConfigComandasLayoutPanel } from '../components/ConfigComandasLayoutPanel';
import { ConfigMesasOperacaoPanel } from '../components/ConfigMesasOperacaoPanel';
import { OperationalCapabilitiesPanel } from '../components/OperationalCapabilitiesPanel';
import { OnboardingManualEntry } from '../components/OnboardingManualEntry';
import { ConfigChavePixPanel } from '../components/ConfigChavePixPanel';
import { ConfigPortalCategoriasPanel } from '../components/ConfigPortalCategoriasPanel';

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
      <ConfigChavePixPanel />
      <ConfigKpisComandaPanel />
      <ConfigComandasLayoutPanel />
      {modo === 'cervejaria' && <ConfigPortalCategoriasPanel />}
      {modo === 'operacao' && <ConfigMesasOperacaoPanel />}
      <OnboardingManualEntry />
    </div>
  );
}
