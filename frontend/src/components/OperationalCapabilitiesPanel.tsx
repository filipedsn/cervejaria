import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { ToggleAtivo } from './ToggleAtivo';

type CapabilityKey = 'tapsEnabled' | 'inventoryEnabled' | 'kitchenEnabled';
type OperationalConfiguration = Record<CapabilityKey | 'directSalesEnabled' | 'plannedOperationsEnabled', boolean | null>;
type Enablements = { directSales: boolean; plannedOperations: boolean; taps: boolean; inventory: boolean; kitchen: boolean };
type OperationalConfigResponse = { enablements: Enablements; configuration: OperationalConfiguration | null };

const ENABLEMENT_BY_KEY: Record<CapabilityKey, keyof Enablements> = { tapsEnabled: 'taps', inventoryEnabled: 'inventory', kitchenEnabled: 'kitchen' };
const CAPABILITIES: Array<{ key: CapabilityKey; title: string; description: string }> = [
  { key: 'tapsEnabled', title: 'Torneiras de chope', description: 'Utilizar torneiras nas operações.' },
  { key: 'inventoryEnabled', title: 'Controle de estoque', description: 'Controlar saldo e movimentação dos produtos.' },
  { key: 'kitchenEnabled', title: 'Cozinha / preparo', description: 'Utilizar o fluxo de preparo de pedidos.' },
];

export function OperationalCapabilitiesPanel() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<CapabilityKey | 'mode' | null>(null);
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['operational-configuration'], queryFn: () => api.get<OperationalConfigResponse>('/api/cervejaria/configuracao-operacional') });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['operational-configuration'] }), queryClient.invalidateQueries({ queryKey: ['quiosque-contexto'] })]);

  async function toggle(key: CapabilityKey) {
    if (!data) return;
    const enabled = !data.enablements[ENABLEMENT_BY_KEY[key]];
    setSaving(key); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { [key]: enabled, ...(key === 'inventoryEnabled' ? { confirmacaoEstoque: true } : {}) }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a configuração'); }
    finally { setSaving(null); }
  }
  async function selectMode(mode: 'CAIXA' | 'EVENTO') {
    setSaving('mode'); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { operationMode: mode }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o modo de operação'); }
    finally { setSaving(null); }
  }
  const operationMode = data?.enablements.plannedOperations ? 'EVENTO' : 'CAIXA';
  return <section className="space-y-3" aria-labelledby="operational-capabilities-title">
    <div><h2 id="operational-capabilities-title" className="text-base font-bold text-ink">Como você trabalha?</h2><p className="mt-1 text-sm text-ink-muted">Escolha um único modo de operação.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" className={`card text-left ${operationMode === 'CAIXA' ? 'ring-2 ring-brand-400 bg-brand-50/40' : ''}`} onClick={() => selectMode('CAIXA')} disabled={isLoading || saving !== null} aria-pressed={operationMode === 'CAIXA'} data-selected={operationMode === 'CAIXA'}><span className="flex items-center justify-between gap-2 font-semibold text-ink"><span>Por caixa</span>{operationMode === 'CAIXA' && <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Selecionado</span>}</span><span className="mt-1 block text-sm text-ink-muted">Abra o caixa e venda diretamente no balcão.</span></button>
      <button type="button" className={`card text-left ${operationMode === 'EVENTO' ? 'ring-2 ring-brand-400 bg-brand-50/40' : ''}`} onClick={() => selectMode('EVENTO')} disabled={isLoading || saving !== null} aria-pressed={operationMode === 'EVENTO'} data-selected={operationMode === 'EVENTO'}><span className="flex items-center justify-between gap-2 font-semibold text-ink"><span>Por operações / eventos</span>{operationMode === 'EVENTO' && <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Selecionado</span>}</span><span className="mt-1 block text-sm text-ink-muted">Inicie uma operação agora ou agende para outro momento.</span></button>
    </div>
    <p className="text-sm font-semibold text-ink">Recursos complementares</p>
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {CAPABILITIES.map(({ key, title, description }) => <div key={key} className="flex min-h-20 items-center justify-between gap-3 px-4 py-4"><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{title}</p><p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p></div><ToggleAtivo ativo={data?.enablements[ENABLEMENT_BY_KEY[key]] ?? false} loading={isLoading || saving !== null} onToggle={() => toggle(key)} labelAtivo={`Desativar ${title}`} labelInativo={`Ativar ${title}`} /></div>)}
    </div>
    {error && <div className="alert-error text-sm">{error}</div>}
  </section>;
}
