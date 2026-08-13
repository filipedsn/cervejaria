import { PageHeader } from '../components/PageHeader';
import { ConfigKpisComandaPanel } from '../components/ConfigKpisComandaPanel';
import { ConfigComandasLayoutPanel } from '../components/ConfigComandasLayoutPanel';
import { ConfigCardapioPanel } from '../components/ConfigCardapioPanel';
import { ConfigCardapioQuiosquePanel } from '../components/ConfigCardapioQuiosquePanel';

export function OperacaoPage({ embedded }: { embedded?: boolean } = {}) {
  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader title="Operação" subtitle="Preferências do dia a dia na tela de comandas" />
      )}
      <ConfigKpisComandaPanel />
      <ConfigComandasLayoutPanel />
      <ConfigCardapioPanel />
      <ConfigCardapioQuiosquePanel />
    </div>
  );
}
