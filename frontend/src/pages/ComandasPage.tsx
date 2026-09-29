import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, ApiError } from '../lib/api';
import type { Comanda, EventoDashboard, FecharGrupoResponse } from '../types';
import { rotuloComandaCervejaria } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { EncerrarEventoButton } from '../components/EncerrarEventoButton';
import { EmptyState } from '../components/EmptyState';
import { ComandasBuscaInput } from '../components/ComandasBuscaInput';
import { StatusBadge } from '../components/StatusBadge';
import { FilaPedidosPanel } from '../components/FilaPedidosPanel';
import { MobileActionBar } from '../components/MobileActionBar';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../components/PaymentFormModal';
import { parseCurrencyInput } from '../lib/currency';
import { textoCorrespondeBuscaComanda } from '../lib/comandas-busca';
import { useAuth } from '../contexts/AuthContext';
import { EventoCaixaPanel } from '../components/EventoCaixaPanel';

type EstadoCaixaEvento = { aberto: boolean };

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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { cervejaria } = useAuth();
  const exibirKpis = cervejaria?.exibirKpisComanda ?? true;
  const colunaUnica = cervejaria?.comandasColunaUnica ?? true;
  const { evento, trailer } = useEvento();
  const [comandaTab, setComandaTab] = useState<'ABERTA' | 'FECHADA'>('ABERTA');
  const [buscaComanda, setBuscaComanda] = useState('');
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
    const invalidateCash = () => queryClient.invalidateQueries({ queryKey: ['evento-caixa', evento.id] });
    socket.on('evento-caixa:updated', invalidateCash);

    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:updated', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
      socket.off('evento-caixa:updated', invalidateCash);
    };
  }, [evento?.id, queryClient]);

  useEffect(() => {
    if (comandaTab !== 'ABERTA') exitSelectMode();
  }, [comandaTab]);

  const comandasFiltradas = useMemo(() => {
    if (!comandas) return [];
    return comandas.filter((c) =>
      textoCorrespondeBuscaComanda(
        buscaComanda,
        c.tipo === 'AVULSA' ? 'Venda avulsa' : rotuloComandaCervejaria(c, c.cliente),
        c.numero,
        c.cliente.nome,
        c.cliente.telefone,
      ),
    );
  }, [comandas, buscaComanda]);

  const isAbertas = comandaTab === 'ABERTA';
  const eventoAberto = evento?.status === 'ABERTO';
  const { data: estadoCaixaEvento } = useQuery({
    queryKey: ['evento-caixa', evento?.id],
    queryFn: () => api.get<EstadoCaixaEvento>(`/api/eventos/${evento!.id}/caixa`),
    enabled: Boolean(evento?.id),
    refetchInterval: 30_000,
  });
  const caixaEventoAberto = estadoCaixaEvento?.aberto === true;
  const vendaLiberada = eventoAberto && caixaEventoAberto;

  useEffect(() => {
    const mandanteId = searchParams.get('selecionar');
    if (!mandanteId || !eventoAberto || !isAbertas || !comandas?.some((c) => c.id === mandanteId)) return;
    setSelectMode(true);
    setSelectedIds([mandanteId]);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('selecionar');
    setSearchParams(nextParams, { replace: true });
  }, [comandas, eventoAberto, isAbertas, searchParams, setSearchParams]);

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
  const showPayBar = selectMode && selectedIds.length >= 2 && totalGrupo > 0;

  return (
    <div className={`space-y-4 ${eventoAberto ? 'page-with-action-bar' : 'pb-2'}`}>
      <EventoCaixaPanel eventoId={evento.id} eventoAberto={eventoAberto} comandasAbertas={resumo?.comandasAbertas ?? 0} />
      <FilaPedidosPanel />

      {!selectMode && eventoAberto && !caixaEventoAberto && (
        <div className="rounded-xl border border-orange/30 bg-orange/10 p-3 text-sm text-orange-dark" role="status">Abra o caixa do evento para iniciar comandas e vendas.</div>
      )}

      {!selectMode && eventoAberto && (
        <section className="space-y-2.5" aria-label="Ações rápidas">
          <header><h2 className="text-xl font-bold">Ações rápidas</h2><p className="text-sm text-ink-muted">Acesso rápido às principais funcionalidades do seu dia a dia.</p></header>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/comandas/nova" className={`group flex min-h-16 min-w-0 w-full items-center justify-center gap-1.5 rounded-2xl border border-sky-300/40 bg-gradient-to-br from-sky-500 to-blue-700 px-1.5 py-2 text-left text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3 ${!vendaLiberada ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={!vendaLiberada} tabIndex={vendaLiberada ? undefined : -1}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/15 text-xl font-light leading-none sm:h-10 sm:w-10 sm:rounded-xl sm:text-3xl">+</span>
              <span className="min-w-0"><strong className="block whitespace-nowrap text-[clamp(0.68rem,3.6vw,1rem)] font-bold leading-tight">Nova comanda</strong></span>
              <span className="shrink-0 text-base text-white/90 transition-transform group-hover:translate-x-1 sm:text-xl" aria-hidden="true">›</span>
            </Link>
            <Link to="/comandas/venda-avulsa" className={`group flex min-h-16 min-w-0 w-full items-center justify-center gap-1.5 rounded-2xl border border-orange-300/50 bg-gradient-to-br from-orange-500 to-orange-700 px-1.5 py-2 text-left text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110 sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3 ${!vendaLiberada ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={!vendaLiberada} tabIndex={vendaLiberada ? undefined : -1}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/15 sm:h-10 sm:w-10 sm:rounded-xl"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-current sm:h-6 sm:w-6" aria-hidden="true"><path d="M13.2 1.8 4.9 13a1 1 0 0 0 .8 1.6h5l-.8 7.6 9.2-12a1 1 0 0 0-.8-1.6h-5.1l1-6a1 1 0 0 0-1.8-.8Z" /></svg></span>
              <span className="min-w-0"><strong className="block whitespace-nowrap text-[clamp(0.68rem,3.6vw,1rem)] font-bold leading-tight">Venda avulsa</strong></span>
              <span className="shrink-0 text-base text-white/90 transition-transform group-hover:translate-x-1 sm:text-xl" aria-hidden="true">›</span>
            </Link>
          </div>
        </section>
      )}

      {groupSuccess && <div className="alert-success">{groupSuccess}</div>}
      {groupError && !showGroupPayment && <div className="alert-error">{groupError}</div>}

      {resumo && exibirKpis && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comandas abertas" value={String(resumo.comandasAbertas)} />
          <StatCard label="Comandas fechadas" value={String(resumo.comandasFechadas)} accent="green" />
          <StatCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
          <StatCard label="Receita avulsa" value={formatCurrency(resumo.receitaAvulsa)} accent="green" />
          <StatCard label="Valor em aberto" value={formatCurrency(resumo.valorAberto)} />
          <StatCard label="Valor fechado" value={formatCurrency(resumo.valorFechado)} accent="green" />
          <StatCard label={`Contas pendentes (${resumo.contasPendentes ?? 0})`} value={formatCurrency(resumo.valorPendente ?? 0)} accent={resumo.contasPendentes ? undefined : 'green'} />
        </div>
      )}

      {false && (resumo?.comandasAbertas ?? comandas?.length ?? 0) >= 2 && (
        selectMode ? (
          <button
            type="button"
            onClick={exitSelectMode}
            className="touch-btn-secondary flex w-full items-center gap-3 min-h-[3.75rem] rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl leading-none">
              ×
            </span>
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="text-base font-bold leading-tight">Cancelar seleção</span>
              <span className="text-sm font-normal text-ink-muted leading-snug">
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

      <section className="space-y-3 rounded-2xl border border-brand-600/20 bg-gradient-to-br from-surface via-surface to-brand-900/10 p-3 shadow-sm sm:p-5">
        <header><h2 className="text-xl font-bold">Comandas</h2><p className="text-sm text-ink-muted">Gerencie as comandas abertas e fechadas deste evento.</p></header>

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

        <ComandasBuscaInput
          value={buscaComanda}
          onChange={setBuscaComanda}
          placeholder="Buscar nº, nome ou telefone..."
        />

        <div className={`grid gap-3 ${colunaUnica ? '' : 'grid-cols-2'}`}>
          {comandasFiltradas.map((c) => {
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
                className={`card-touch w-full ${colunaUnica ? 'min-h-[4.5rem]' : 'min-h-[5.5rem]'} ${
                  selectMode
                    ? isSelected
                      ? 'border-brand-500 bg-brand-50/40'
                      : 'hover:border-brand-400/30'
                    : 'hover:border-brand-400/30'
                }`}
              >
                <div className={colunaUnica ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1.5'}>
                  {colunaUnica ? (
                    <>
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
                              {isAvulsa ? 'Venda avulsa' : rotuloComandaCervejaria(c, c.cliente)}
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
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          {selectMode && (
                            <span
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                                isSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface'
                              }`}
                              aria-hidden
                            >
                              {isSelected ? '✓' : ''}
                            </span>
                          )}
                          <div className="min-w-0 text-left">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="text-base font-bold truncate">
                                {isAvulsa ? 'Venda avulsa' : rotuloComandaCervejaria(c, c.cliente)}
                              </h3>
                              {!isAbertas && (
                                isAvulsa ? (
                                  <StatusBadge variant="venda-avulsa" />
                                ) : (
                                  <StatusBadge variant="comanda-fechada" />
                                )
                              )}
                            </div>
                          </div>
                        </div>
                        <p className="shrink-0 text-base font-bold text-brand-600 tabular-nums">
                          {formatCurrency(c.total)}
                        </p>
                      </div>
                      <p className="text-xs text-ink-faint">{c.itens.length} item(ns)</p>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {comandasFiltradas.length === 0 && (
          <EmptyState
            icon={buscaComanda.trim() ? '🔍' : isAbertas ? '📋' : '✅'}
            title={
              buscaComanda.trim()
                ? 'Nenhuma comanda encontrada'
                : isAbertas
                  ? 'Nenhuma comanda aberta ainda'
                  : 'Nenhuma comanda fechada ainda'
            }
            description={
              buscaComanda.trim()
                ? 'Tente outro nome ou número.'
                : isAbertas
                  ? 'Use o botão acima para abrir a primeira'
                  : undefined
            }
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
          <EncerrarEventoButton eventoId={evento.id} />
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
                  <span className="font-medium truncate">{rotuloComandaCervejaria(c, c.cliente)}</span>
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
