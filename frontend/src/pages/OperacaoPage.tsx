import { PageHeader } from '../components/PageHeader';
import { ConfigKpisComandaPanel } from '../components/ConfigKpisComandaPanel';
import { ConfigComandasLayoutPanel } from '../components/ConfigComandasLayoutPanel';
import { ConfigCardapioPanel } from '../components/ConfigCardapioPanel';
import { ConfigCardapioQuiosquePanel } from '../components/ConfigCardapioQuiosquePanel';
import { ConfigMesasQuiosquePanel } from '../components/ConfigMesasQuiosquePanel';
import { ConfigRecursosQuiosquePanel } from '../components/ConfigRecursosQuiosquePanel';
import { OnboardingManualEntry } from '../components/OnboardingManualEntry';

type OperacaoPageProps = {
  embedded?: boolean;
  /** Quiosque: só preferências do quiosque; cervejaria (padrão): inclui cardápio por evento. */
  modo?: 'cervejaria' | 'quiosque';
};

export function OperacaoPage({ embedded, modo = 'cervejaria' }: OperacaoPageProps = {}) {
  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader title="Operação" subtitle="Preferências do dia a dia na tela de comandas" />
      )}
      <ConfigRecursosQuiosquePanel />
      <ConfigKpisComandaPanel />
      <ConfigComandasLayoutPanel />
      {modo === 'cervejaria' && <ConfigCardapioPanel />}
      {modo === 'quiosque' && <ConfigCardapioQuiosquePanel />}
      {modo === 'quiosque' && <ConfigMesasQuiosquePanel />}
      {modo === 'cervejaria' && <ConfigCardapioQuiosquePanel />}
      <OnboardingManualEntry />
    </div>
  );
}
