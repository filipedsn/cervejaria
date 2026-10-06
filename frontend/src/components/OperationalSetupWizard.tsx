import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type OperationMode = 'CAIXA' | 'EVENTO';
type OperationalSetupResponse = {
  configuration: {
    configurationSource?: 'LEGACY' | 'CANONICAL_PDV';
    setupCompletedAt?: string | null;
    plannedOperationsEnabled?: boolean | null;
    tapsEnabled?: boolean | null;
    inventoryEnabled?: boolean | null;
    kitchenEnabled?: boolean | null;
  } | null;
};

export function OperationalSetupWizard() {
  const { isDono, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<OperationMode | null>(null);
  const [taps, setTaps] = useState(false);
  const [inventory, setInventory] = useState(false);
  const [kitchen, setKitchen] = useState(false);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['operational-configuration'],
    queryFn: () => api.get<OperationalSetupResponse>('/api/cervejaria/configuracao-operacional'),
    enabled: isDono && !isAdmin,
  });

  useEffect(() => {
    const config = data?.configuration;
    if (!config || config.setupCompletedAt != null) return;
    setMode(config.configurationSource === 'CANONICAL_PDV'
      ? 'CAIXA'
      : config.plannedOperationsEnabled == null ? null : config.plannedOperationsEnabled ? 'EVENTO' : 'CAIXA');
    setTaps(config.tapsEnabled ?? false);
    setInventory(config.inventoryEnabled ?? false);
    setKitchen(config.kitchenEnabled ?? false);
  }, [data]);

  const setup = useMutation({
    mutationFn: () => {
      if (!mode) throw new Error('Escolha como o estabelecimento vai operar.');
      return api.patch('/api/cervejaria/configuracao-operacional', {
        operationMode: mode,
        tapsEnabled: taps,
        inventoryEnabled: inventory,
        kitchenEnabled: kitchen,
        ...(inventory ? { confirmacaoEstoque: true } : {}),
        completeInitialSetup: true,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operational-configuration'] }),
        queryClient.invalidateQueries({ queryKey: ['operacao-contexto'] }),
        queryClient.invalidateQueries({ queryKey: ['onboarding-readiness'] }),
      ]);
      setError('');
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Não foi possível salvar a configuração.'),
  });

  const open = Boolean(data?.configuration && data.configuration.setupCompletedAt == null);
  const canonicalPdv = data?.configuration?.configurationSource === 'CANONICAL_PDV';

  return (
    <Modal
      open={open}
      onClose={() => undefined}
      closeOnBackdrop={false}
      hideHeaderClose
      title="Configuração inicial"
      footer={step === 1 ? (
        <button
          type="button"
          className="touch-btn-primary w-full"
          disabled={!mode}
          onClick={() => { setError(''); setStep(2); }}
        >
          Continuar
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="touch-btn-secondary w-full" disabled={setup.isPending} onClick={() => { setError(''); setStep(1); }}>
            Voltar
          </button>
          <button type="button" className="touch-btn-primary w-full" disabled={setup.isPending || !mode} onClick={() => setup.mutate()}>
            {setup.isPending ? 'Salvando...' : 'Concluir'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-brand-700">Etapa {step} de 2</p>
          <div className="flex gap-1" aria-hidden="true">
            <span className={`h-1.5 w-8 rounded-full ${step === 1 ? 'bg-brand-500' : 'bg-line'}`} />
            <span className={`h-1.5 w-8 rounded-full ${step === 2 ? 'bg-brand-500' : 'bg-line'}`} />
          </div>
        </div>

        {step === 1 ? (
          <section className="space-y-3" aria-labelledby="operational-setup-mode">
            <div>
              <h3 id="operational-setup-mode" className="text-lg font-bold">Como você vai operar?</h3>
              <p className="mt-1 text-sm text-ink-muted">Isso define o fluxo principal. Chope, estoque e cozinha podem ser usados nos dois modos.</p>
            </div>
            <button type="button" className={`card w-full border-2 text-left transition-colors ${mode === 'CAIXA' ? 'border-brand-400 bg-brand-500/15 ring-2 ring-brand-400/50' : 'border-line'}`} aria-pressed={mode === 'CAIXA'} data-selected={mode === 'CAIXA'} onClick={() => setMode('CAIXA')}>
              {mode === 'CAIXA' && <span className="mb-2 inline-flex rounded-full bg-brand-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-brand-300">✓ Selecionado</span>}
              <span className="block font-semibold">Por caixa</span>
              <span className="mt-1 block text-sm text-ink-muted">Abra um caixa por turno para registrar comandas e vendas do balcão.</span>
            </button>
            {!canonicalPdv && <button type="button" className={`card w-full border-2 text-left transition-colors ${mode === 'EVENTO' ? 'border-brand-400 bg-brand-500/15 ring-2 ring-brand-400/50' : 'border-line'}`} aria-pressed={mode === 'EVENTO'} data-selected={mode === 'EVENTO'} onClick={() => setMode('EVENTO')}>
              {mode === 'EVENTO' && <span className="mb-2 inline-flex rounded-full bg-brand-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-brand-300">✓ Selecionado</span>}
              <span className="block font-semibold">Por operações ou eventos</span>
              <span className="mt-1 block text-sm text-ink-muted">Crie uma operação para cada evento ou atendimento, iniciando agora ou agendando.</span>
            </button>}
          </section>
        ) : (
          <section className="space-y-3" aria-labelledby="operational-setup-features">
            <div>
              <h3 id="operational-setup-features" className="text-lg font-bold">Quais recursos quer ativar?</h3>
              <p className="mt-1 text-sm text-ink-muted">São opcionais e podem ser alterados depois em Configurações → Operação.</p>
            </div>
            <label className="card flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-400" checked={taps} onChange={(event) => setTaps(event.target.checked)} />
              <span><span className="block font-semibold">Chope nas torneiras</span><span className="mt-1 block text-xs text-ink-faint">Ativa o uso de chope em taps; trailer e torneiras são cadastrados separadamente.</span></span>
            </label>
            <label className="card flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-400" checked={inventory} onChange={(event) => setInventory(event.target.checked)} />
              <span><span className="block font-semibold">Controle de estoque</span><span className="mt-1 block text-xs text-ink-faint">Controla o saldo e as movimentações dos produtos.</span></span>
            </label>
            <label className="card flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-400" checked={kitchen} onChange={(event) => setKitchen(event.target.checked)} />
              <span><span className="block font-semibold">Cozinha e preparo</span><span className="mt-1 block text-xs text-ink-faint">Envia à fila da cozinha os itens marcados para preparo.</span></span>
            </label>
            <p className="text-xs text-ink-faint">Esta escolha ativa recursos no sistema, mas não cria produtos, pontos de venda, trailers ou torneiras.</p>
          </section>
        )}

        {error && <div className="alert-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
