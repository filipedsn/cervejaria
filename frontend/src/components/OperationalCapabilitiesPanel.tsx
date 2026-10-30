import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { ToggleAtivo } from './ToggleAtivo';

type CapabilityKey = 'tapsEnabled' | 'inventoryEnabled' | 'kitchenEnabled';
type OperationalConfiguration = Record<CapabilityKey | 'plannedOperationsEnabled' | 'whatsappPedidoProntoEnabled' | 'whatsappPedidoProntoNaCozinha' | 'kitchenItemsChargeAtLaunch' | 'allowCloseComandaWithPendingKitchenOrders', boolean | null>;
type Enablements = { plannedOperations: boolean; cashRegister: boolean; cashMode: boolean; taps: boolean; inventory: boolean; kitchen: boolean };
type OperationalConfigResponse = { configurationSource: 'LEGACY' | 'CANONICAL_PDV'; enablements: Enablements; configuration: OperationalConfiguration | null };
type CapabilitySection = 'all' | 'resources' | 'attendance' | 'notifications';
type OperationalCapabilitiesPanelProps = { section?: CapabilitySection };
const ENABLEMENT_BY_KEY: Record<CapabilityKey, keyof Enablements> = { tapsEnabled: 'taps', inventoryEnabled: 'inventory', kitchenEnabled: 'kitchen' };
const CAPABILITIES: Array<{ key: CapabilityKey; title: string; description: string }> = [
  { key: 'tapsEnabled', title: 'Torneiras de chope', description: 'Utilizar torneiras nas operações.' },
  { key: 'inventoryEnabled', title: 'Controle de estoque', description: 'Controlar saldo e movimentação dos produtos.' },
  { key: 'kitchenEnabled', title: 'Cozinha / preparo', description: 'Utilizar o fluxo de preparo de pedidos.' },
];

export function OperationalCapabilitiesPanel({ section = 'all' }: OperationalCapabilitiesPanelProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<CapabilityKey | 'mode' | 'whatsapp' | 'whatsappLocation' | 'kitchenCharge' | 'closeWithKitchenPending' | null>(null);
  const [error, setError] = useState('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['operational-configuration'], queryFn: () => api.get<OperationalConfigResponse>('/api/cervejaria/configuracao-operacional') });
  const configurationSource = isError ? undefined : data?.configurationSource;
  const canonicalPdv = configurationSource === 'CANONICAL_PDV';
  const confirmedLegacy = configurationSource === 'LEGACY';
  const showResources = section === 'all' || section === 'resources';
  const showAttendance = section === 'all' || section === 'attendance';
  const showNotifications = section === 'all' || section === 'notifications';
  const showMode = section === 'all';
  const titleId = `operational-capabilities-title-${section}`;
  const refresh = (capability?: CapabilityKey) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['operational-configuration'] }),
    queryClient.invalidateQueries({ queryKey: ['operacao-contexto'] }),
    ...(capability === 'tapsEnabled'
      ? [
          queryClient.invalidateQueries({ queryKey: ['operacao-categorias'] }),
          queryClient.invalidateQueries({ queryKey: ['portal-categories-config'] }),
          queryClient.invalidateQueries({ queryKey: ['portal-balcao-alert-config'] }),
        ]
      : []),
  ]);
  async function toggle(key: CapabilityKey) {
    if (!data) return;
    const enabled = !data.enablements[ENABLEMENT_BY_KEY[key]];
    setSaving(key); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { [key]: enabled, ...(key === 'inventoryEnabled' ? { confirmacaoEstoque: true } : {}) }); await refresh(key); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a configuração'); }
    finally { setSaving(null); }
  }
  async function selectMode(mode: 'CAIXA' | 'EVENTO') {
    setSaving('mode'); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { operationMode: mode }); await refresh(); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(`Não foi possível alterar o modo: ${cause.message}`);
      } else {
        setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o modo de operação');
      }
    }
    finally { setSaving(null); }
  }
  async function updateWhatsAppSetting(key: 'whatsappPedidoProntoEnabled' | 'whatsappPedidoProntoNaCozinha') {
    const current = data?.configuration?.[key] ?? false;
    const savingKey = key === 'whatsappPedidoProntoEnabled' ? 'whatsapp' : 'whatsappLocation';
    setSaving(savingKey); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { [key]: !current }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a configuração do WhatsApp'); }
    finally { setSaving(null); }
  }
  async function updateKitchenChargeSetting() {
    const enabled = !(data?.configuration?.kitchenItemsChargeAtLaunch ?? false);
    setSaving('kitchenCharge'); setError('');
    try { await api.patch('/api/cervejaria/configuracao-operacional', { kitchenItemsChargeAtLaunch: enabled }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a regra de cobrança da cozinha'); }
    finally { setSaving(null); }
  }
  async function updateCloseWithKitchenPendingSetting() {
    const enabled = !(data?.configuration?.allowCloseComandaWithPendingKitchenOrders ?? false);
    setSaving('closeWithKitchenPending'); setError('');
    try {
      await api.patch('/api/cervejaria/configuracao-operacional', { allowCloseComandaWithPendingKitchenOrders: enabled });
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Nao foi possivel salvar a regra de fechamento com pedidos pendentes');
    } finally { setSaving(null); }
  }
  const attendanceControls = <>
    <div className="flex min-h-20 items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Pedidos pendentes na cozinha compõem o valor da comanda</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">Ligado: entram na comanda ao lançar. Desligado: entram quando forem entregues.</p>
      </div>
      <ToggleAtivo
        ativo={data?.configuration?.kitchenItemsChargeAtLaunch ?? false}
        loading={isLoading || saving !== null}
        onToggle={() => void updateKitchenChargeSetting()}
        labelAtivo="Desativar cobrança ao lançar itens da cozinha"
        labelInativo="Ativar cobrança ao lançar itens da cozinha"
      />
    </div>
    {data?.configuration?.kitchenItemsChargeAtLaunch && <div className="flex min-h-20 items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Permitir fechar comanda com pedido pendente na cozinha</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">Ligado: permite encerrar e receber mesmo antes da entrega. Desligado: exige que os pedidos de cozinha sejam entregues.</p>
      </div>
      <ToggleAtivo
        ativo={data?.configuration?.allowCloseComandaWithPendingKitchenOrders ?? false}
        loading={isLoading || saving !== null}
        onToggle={() => void updateCloseWithKitchenPendingSetting()}
        labelAtivo="Desativar fechamento com pedido pendente na cozinha"
        labelInativo="Ativar fechamento com pedido pendente na cozinha"
      />
    </div>}
  </>;
  const operationMode = data?.enablements.plannedOperations ? 'EVENTO' : 'CAIXA';
  if (section !== 'all' && !configurationSource) {
    return section === 'resources'
      ? <div className={isError ? 'alert-error' : 'text-sm text-ink-muted'} role={isError ? 'alert' : undefined}>{isError ? 'Nao foi possivel validar a configuracao operacional.' : 'Carregando configuracao do PDV...'}</div>
      : null;
  }
  return <section className="space-y-3" aria-labelledby={showMode ? titleId : undefined} aria-label={showMode ? undefined : section}>
    {showMode && (canonicalPdv ? <p className="text-sm text-ink-muted">O PDV opera por caixa. Você pode associar uma ocorrência ao abrir o caixa.</p> : confirmedLegacy ? <>
    <div><h2 id={titleId} className="text-base font-bold text-ink">Como você trabalha?</h2><p className="mt-1 text-sm text-ink-muted">Escolha um único modo de operação.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" className={`card text-left ${operationMode === 'CAIXA' ? 'ring-2 ring-brand-400 bg-brand-50/40' : ''}`} onClick={() => selectMode('CAIXA')} disabled={isLoading || saving !== null} aria-pressed={operationMode === 'CAIXA'} data-selected={operationMode === 'CAIXA'}><span className="flex items-center justify-between gap-2 font-semibold text-ink"><span>Por caixa</span>{operationMode === 'CAIXA' && <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Selecionado</span>}</span><span className="mt-1 block text-sm text-ink-muted">Abra o caixa e venda diretamente no balcão.</span></button>
      <button type="button" className={`card text-left ${operationMode === 'EVENTO' ? 'ring-2 ring-brand-400 bg-brand-50/40' : ''}`} onClick={() => selectMode('EVENTO')} disabled={isLoading || saving !== null} aria-pressed={operationMode === 'EVENTO'} data-selected={operationMode === 'EVENTO'}><span className="flex items-center justify-between gap-2 font-semibold text-ink"><span>Por operações / eventos</span>{operationMode === 'EVENTO' && <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Selecionado</span>}</span><span className="mt-1 block text-sm text-ink-muted">Inicie uma operação agora ou agende para outro momento.</span></button>
    </div>
    {operationMode === 'CAIXA' && data && !data.enablements.cashRegister && (
      <div className="flex flex-col gap-3 rounded-xl border border-brand-400/30 bg-brand-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">Modo por caixa selecionado. Para começar a vender, crie seu ponto de venda.</p>
        <Link to="/operacao/caixa" className="touch-btn-primary inline-flex shrink-0 items-center justify-center px-4">Criar ponto de venda</Link>
      </div>
    )}
    </> : <div className={isError ? 'alert-error' : 'text-sm text-ink-muted'} role={isError ? 'alert' : undefined}>{isError ? 'Não foi possível validar a configuração operacional.' : 'Carregando configuração operacional…'}</div>)}
    {section === 'resources' && canonicalPdv && <p className="text-sm text-ink-muted">O PDV opera por caixa. Você pode associar uma ocorrência ao abrir o caixa.</p>}
    {showMode && <p className="text-sm font-semibold text-ink">Recursos complementares</p>}
    {configurationSource && showResources && <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {CAPABILITIES.map(({ key, title, description }) => <div key={key} className="flex min-h-20 items-center justify-between gap-3 px-4 py-4"><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{title}</p><p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p></div><ToggleAtivo ativo={data?.enablements[ENABLEMENT_BY_KEY[key]] ?? false} loading={isLoading || saving !== null} onToggle={() => toggle(key)} labelAtivo={`Desativar ${title}`} labelInativo={`Ativar ${title}`} /></div>)}
      {section === 'all' && showAttendance && attendanceControls}
    </div>}
    {section !== 'all' && showAttendance && configurationSource && <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{attendanceControls}</div>}
    {configurationSource && showNotifications && <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex min-h-20 items-center justify-between gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Avisar cliente quando o pedido ficar pronto</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">Abre o WhatsApp com a mensagem pronta para a equipe revisar e enviar. Use com clientes que aceitaram receber avisos por WhatsApp.</p>
        </div>
        <ToggleAtivo
          ativo={data?.configuration?.whatsappPedidoProntoEnabled ?? false}
          loading={isLoading || saving !== null}
          onToggle={() => void updateWhatsAppSetting('whatsappPedidoProntoEnabled')}
          labelAtivo="Desativar aviso de pedido pronto pelo WhatsApp"
          labelInativo="Ativar aviso de pedido pronto pelo WhatsApp"
        />
      </div>
      {data?.configuration?.whatsappPedidoProntoEnabled && (
        <div className="flex min-h-20 items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">Enviar aviso pela cozinha</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">Ligado: o botão aparece na cozinha. Desligado: aparece na comanda.</p>
          </div>
          <ToggleAtivo
            ativo={data.configuration.whatsappPedidoProntoNaCozinha ?? false}
            loading={isLoading || saving !== null}
            onToggle={() => void updateWhatsAppSetting('whatsappPedidoProntoNaCozinha')}
            labelAtivo="Desativar envio pela cozinha e usar a comanda"
            labelInativo="Ativar envio pela cozinha"
          />
        </div>
      )}
    </div>}
    {error && <div className="alert-error text-sm" role="alert" aria-live="assertive">{error}</div>}
  </section>;
}
