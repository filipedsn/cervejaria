import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { ToggleAtivo } from './ToggleAtivo';

type CapabilityKey = 'directSalesEnabled' | 'plannedOperationsEnabled' | 'tapsEnabled' | 'inventoryEnabled' | 'kitchenEnabled';
type OperationalConfiguration = Record<CapabilityKey, boolean | null>;
type Enablements = { directSales: boolean; plannedOperations: boolean; taps: boolean; inventory: boolean; kitchen: boolean };
type OperationalConfigResponse = { enablements: Enablements; configuration: OperationalConfiguration | null };

const ENABLEMENT_BY_KEY: Record<CapabilityKey, keyof Enablements> = {
  directSalesEnabled: 'directSales', plannedOperationsEnabled: 'plannedOperations', tapsEnabled: 'taps', inventoryEnabled: 'inventory', kitchenEnabled: 'kitchen',
};
const CAPABILITIES: Array<{ key: CapabilityKey; title: string; description: string }> = [
  { key: 'directSalesEnabled', title: 'Venda avulsa', description: 'Vender diretamente no balcão ou ponto de venda.' },
  { key: 'plannedOperationsEnabled', title: 'Operações', description: 'Trabalhar com operações iniciadas agora ou agendadas.' },
  { key: 'tapsEnabled', title: 'Torneiras de chope', description: 'Utilizar torneiras nas operações.' },
  { key: 'inventoryEnabled', title: 'Controle de estoque', description: 'Controlar saldo e movimentação dos produtos.' },
  { key: 'kitchenEnabled', title: 'Cozinha / preparo', description: 'Utilizar o fluxo de preparo de pedidos.' },
];

export function OperationalCapabilitiesPanel() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<CapabilityKey | null>(null);
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['operational-configuration'],
    queryFn: () => api.get<OperationalConfigResponse>('/api/cervejaria/configuracao-operacional'),
  });

  async function toggle(key: CapabilityKey) {
    if (!data) return;
    const enabled = !data.enablements[ENABLEMENT_BY_KEY[key]];
    if (key === 'inventoryEnabled' && !confirm('Confirma a alteração do controle de estoque? Saldos e histórico serão preservados.')) return;
    setSaving(key);
    setError('');
    try {
      await api.patch('/api/cervejaria/configuracao-operacional', { [key]: enabled, ...(key === 'inventoryEnabled' ? { confirmacaoEstoque: true } : {}) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operational-configuration'] }),
        queryClient.invalidateQueries({ queryKey: ['quiosque-contexto'] }),
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a configuração');
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="operational-capabilities-title">
      <div><h2 id="operational-capabilities-title" className="text-base font-bold text-ink">Como você opera</h2><p className="mt-1 text-sm text-ink-muted">Ative os recursos que fazem parte da sua operação.</p></div>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {CAPABILITIES.map(({ key, title, description }) => (
          <div key={key} className="flex min-h-20 items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{title}</p><p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p></div>
            <ToggleAtivo ativo={data?.enablements[ENABLEMENT_BY_KEY[key]] ?? false} loading={isLoading || saving !== null} onToggle={() => toggle(key)} labelAtivo={`Desativar ${title}`} labelInativo={`Ativar ${title}`} />
          </div>
        ))}
      </div>
      {error && <div className="alert-error text-sm">{error}</div>}
    </section>
  );
}
