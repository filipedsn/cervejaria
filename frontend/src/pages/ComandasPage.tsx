import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, ApiError } from '../lib/api';
import type { Comanda, EventoDashboard, FecharGrupoResponse } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { EncerrarEventoButton } from '../components/EncerrarEventoButton';
import { ExcluirEventoButton } from '../components/ExcluirEventoButton';
import { VerRankingButton } from '../components/VerRankingButton';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { EventoTapMontagemPanel } from '../components/EventoTapMontagemPanel';
import { FilaPedidosPanel } from '../components/FilaPedidosPanel';
import { MobileActionBar } from '../components/MobileActionBar';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../components/PaymentFormModal';
import { parseCurrencyInput } from '../lib/currency';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'green' }) {
  return (
    <div className="metric-card">
      <p
        className={`metric-value w-full ${accent === 'green' ? 'metric-value-success' : ''}`}
      >
        {value}
      </p>
      <p className="text-xs sm:text-sm text-ink-muted leading-tight w-full">{label}</p>
    </div>
  );
}

export function ComandasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento, trailer } = useEvento();
  const [comandaTab, setComandaTab] = useState<'ABERTA' | 'FECHADA'>('ABERTA');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGroupPayment, setShowGroupPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [groupError, setGroupError] = useState('');
  const [groupSuccess, setGroupSuccess] = useState('');

  const { data: dashboard, isLoading: loadingDashboard } = useQuery({
    queryKey: ['dashboard', evento?.id],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${evento!.id}/dashboard`),
    enabled: !!evento,
  });

  const { data: comandas, isLoading: loadingComandas } = useQuery({
    queryKey: ['comandas', evento?.id, comandaTab],
    queryFn: () => api.get<Comanda[]>(`/api/comandas/evento/${evento!.id}?status=${comandaTab}`),
    enabled: !!evento,
  });

  const selectedComandas = useMemo(
    () => (comandas ?? []).filter((c) => selectedIds.includes(c.id)),
    [comandas, selectedIds],
  );

  const totalGrupo = useMemo(
    () =>
      selectedComandas
        .filter((c) => c.itens.length > 0)
        .reduce((sum, c) => sum + parseFloat(c.total), 0),
    [selectedComandas],
  );

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
    setShowGroupPayment(false);
    setGroupError('');
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const fecharGrupoMutation = useMutation({
    mutationFn: (pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[]) =>
      api.post<FecharGrupoResponse>('/api/pagamentos/fechar-grupo', {
        comandaIds: selectedIds,
        pagamentos,
      }),
    onSuccess: (data) => {
      const fechadas = data.comandas.length;
      const canceladas = data.canceladas.length;
      const parts: string[] = [];
      if (fechadas > 0) parts.push(`${fechadas} comanda(s) fechada(s)`);
      if (canceladas > 0) parts.push(`${canceladas} cancelada(s)`);
      setGroupSuccess(parts.join(' · ') || 'Operação concluída');
      setShowGroupPayment(false);
      exitSelectMode();
      if (evento) {
        queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
      }
    },
    onError: (err) => {
      setGroupError(err instanceof ApiError ? err.message : 'Erro ao fechar comandas');
    },
  });

  const openGroupPayment = () => {
    setPaymentForm(createDefaultPaymentForm(totalGrupo));
    setGroupError('');
    setShowGroupPayment(true);
  };

  const handleGroupClose = () => {
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    fecharGrupoMutation.mutate(pagamentos);
  };

  useEffect(() => {
    if (!evento) return;
    const socket = getSocket();

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
    };

    socket.on('comanda:created', invalidate);
    socket.on('comanda:updated', invalidate);
    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);

    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:updated', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
    };
  }, [evento?.id, queryClient]);

  useEffect(() => {
    if (comandaTab !== 'ABERTA') exitSelectMode();
  }, [comandaTab]);

  if (!evento) {
    return (
      <div className="empty-state py-12 space-y-3">
        <p className="empty-state-text">
          {trailer
            ? `Nenhum evento aberto em ${trailer.nome}. Vá em Eventos para iniciar ou retomar.`
            : 'Use a barra acima para escolher ou criar um evento'}
        </p>
        <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block">
          Ir para Eventos
        </Link>
      </div>
    );
  }

  if (loadingDashboard || loadingComandas) return <Loading />;

  const resumo = dashboard?.resumo;
  const isAbertas = comandaTab === 'ABERTA';
  const eventoAberto = evento.status === 'ABERTO';
  const canSelect = isAbertas && eventoAberto;
  const showPayBar = selectMode && selectedIds.length >= 2 && totalGrupo > 0;

  return (
    <div className={`space-y-4 ${eventoAberto ? 'page-with-action-bar' : 'pb-2'}`}>
      <EventoTapMontagemPanel
        eventoId={evento.id}
        eventoAberto={eventoAberto}
        sectionId="evento-taps"
      />

      {!selectMode && eventoAberto && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/comandas/nova" className="touch-btn-hero">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/20 text-2xl leading-none font-normal">
              +
            </span>
            Nova Comanda
          </Link>
          <Link to="/comandas/venda-avulsa" className="touch-btn-secondary min-h-[3.75rem] flex items-center justify-center gap-2 rounded-2xl font-bold text-base px-4">
            <span className="text-xl leading-none" aria-hidden>
              ⚡
            </span>
            Venda avulsa
          </Link>
        </div>
      )}

      {!selectMode && !eventoAberto && (
        <Link to="/comandas/nova" className="touch-btn-hero">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/20 text-2xl leading-none font-normal">
            +
          </span>
          Nova Comanda
        </Link>
      )}

      {groupSuccess && <div className="alert-success">{groupSuccess}</div>}
      {groupError && !showGroupPayment && <div className="alert-error">{groupError}</div>}

      {resumo && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comandas abertas" value={String(resumo.comandasAbertas)} />
          <StatCard label="Comandas fechadas" value={String(resumo.comandasFechadas)} accent="green" />
          <StatCard label="Valor em aberto" value={formatCurrency(resumo.valorAberto)} />
          <StatCard label="Valor fechado" value={formatCurrency(resumo.valorFechado)} accent="green" />
        </div>
      )}

      <VerRankingButton eventoId={evento.id} />

      <FilaPedidosPanel />

      {canSelect && (resumo?.comandasAbertas ?? comandas?.length ?? 0) >= 2 && (
        selectMode ? (
          <button
            type="button"
            onClick={exitSelectMode}
            className="flex w-full items-center gap-3 min-h-[3.75rem] rounded-2xl bg-ink-soft text-white px-4 py-3 shadow-lg shadow-black/15 ring-2 ring-line active:scale-[0.98] transition-transform"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl leading-none">
              ×
            </span>
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="text-base font-bold leading-tight">Cancelar seleção</span>
              <span className="text-sm font-normal text-white/85 leading-snug">
                {selectedIds.length > 0
                  ? `${selectedIds.length} comanda(s) marcada(s) · toque para voltar ao normal`
                  : 'Toque nas comandas abaixo para marcar · mínimo 2 para pagar juntas'}
              </span>
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelectMode(true);
              setGroupSuccess('');
              setGroupError('');
            }}
            className="flex w-full items-center gap-3 min-h-[3.75rem] rounded-2xl bg-brand-600 text-white px-4 py-3 shadow-lg shadow-brand-600/25 ring-2 ring-brand-200/50 active:scale-[0.98] transition-transform"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl leading-none">
              ✓
            </span>
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="text-base font-bold leading-tight">Selecionar comandas</span>
              <span className="text-sm font-normal text-white/85 leading-snug">
                Pague 2 ou mais comandas juntas em um único pagamento
              </span>
            </span>
          </button>
        )
      )}

      <section className="space-y-3">
        <h2 className="section-label mb-0">Comandas</h2>

        <div className="segmented-control w-full">
          <button
            type="button"
            onClick={() => setComandaTab('ABERTA')}
            className={`segmented-control-btn ${
              isAbertas ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Abertas{resumo ? ` (${resumo.comandasAbertas})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setComandaTab('FECHADA')}
            className={`segmented-control-btn ${
              !isAbertas ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Fechadas{resumo ? ` (${resumo.comandasFechadas})` : ''}
          </button>
        </div>

        <div className="grid gap-3">
          {comandas?.map((c) => {
            const isSelected = selectedIds.includes(c.id);
            const isAvulsa = c.tipo === 'AVULSA';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (selectMode) {
                    toggleSelection(c.id);
                    return;
                  }
                  navigate(`/comandas/${c.id}`);
                }}
                className={`card-touch min-h-[4.5rem] w-full ${
                  selectMode
                    ? isSelected
                      ? 'border-brand-500 bg-brand-50/40'
                      : 'hover:border-brand-400/30'
                    : 'hover:border-brand-400/30'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {selectMode && (
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                          isSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface'
                        }`}
                        aria-hidden
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                    )}
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold truncate">
                          {isAvulsa ? 'Venda avulsa' : c.cliente.nome}
                        </h3>
                        {!isAbertas && (
                          isAvulsa ? (
                            <StatusBadge variant="venda-avulsa" />
                          ) : (
                            <StatusBadge variant="comanda-fechada" />
                          )
                        )}
                      </div>
                      {!isAvulsa && c.cliente.telefone && (
                        <p className="text-sm text-ink-faint">{c.cliente.telefone}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold text-brand-600 tabular-nums">{formatCurrency(c.total)}</p>
                    <p className="text-xs text-ink-faint">{c.itens.length} item(ns)</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {comandas?.length === 0 && (
          <EmptyState
            icon={isAbertas ? '📋' : '✅'}
            title={isAbertas ? 'Nenhuma comanda aberta ainda' : 'Nenhuma comanda fechada ainda'}
            description={isAbertas ? 'Use o botão acima para abrir a primeira' : undefined}
          />
        )}
      </section>

      {showPayBar && (
        <MobileActionBar>
          <button
            type="button"
            className="touch-btn-primary w-full"
            onClick={openGroupPayment}
            disabled={fecharGrupoMutation.isPending}
          >
            Pagar juntas ({selectedIds.length}) · {formatCurrency(totalGrupo)}
          </button>
        </MobileActionBar>
      )}

      {eventoAberto && !selectMode && (
        <MobileActionBar>
          <div className="grid gap-2 w-full">
            {resumo && resumo.comandasAbertas + resumo.comandasFechadas === 0 && (
              <ExcluirEventoButton
                eventoId={evento.id}
                eventoNome={evento.nome}
                eventoAberto
                navigateAfterDelete="/eventos"
              />
            )}
            <EncerrarEventoButton eventoId={evento.id} />
          </div>
        </MobileActionBar>
      )}

      <PaymentFormModal
        open={showGroupPayment}
        onClose={() => setShowGroupPayment(false)}
        title="Pagar comandas juntas"
        totalLabel="Total do grupo"
        total={totalGrupo}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleGroupClose}
        isPending={fecharGrupoMutation.isPending}
        confirmMessage="As comandas selecionadas serão fechadas e não poderão ser editadas."
        headerExtra={
          <div className="rounded-xl border border-line bg-surface-lighter divide-y divide-line">
            {selectedComandas
              .filter((c) => c.itens.length > 0)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium truncate">{c.cliente.nome}</span>
                  <span className="font-semibold tabular-nums text-brand-600 shrink-0">
                    {formatCurrency(c.total)}
                  </span>
                </div>
              ))}
          </div>
        }
      />

      {groupError && showGroupPayment && <div className="alert-error">{groupError}</div>}
    </div>
  );
}
