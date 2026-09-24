import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { ComandasBuscaInput } from '../../components/ComandasBuscaInput';
import { StatusBadge, comandaStatusVariant } from '../../components/StatusBadge';
import { MobileActionBar } from '../../components/MobileActionBar';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../../components/PaymentFormModal';
import { parseCurrencyInput } from '../../lib/currency';
import { textoCorrespondeBuscaComanda } from '../../lib/comandas-busca';
import { PainelCaixaQuiosque } from '../../components/quiosque/PainelCaixaQuiosque';
import { PdvPortalQrButton } from '../../components/PdvPortalQrButton';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useAuth } from '../../contexts/AuthContext';
import {
  comandasFechadasNoTurno,
  diaOperacionalQuery,
  mesasOperacionais,
  ordenarComandasParaOperacao,
  RESUMO_TURNO_VAZIO,
  rotuloComanda,
  totalItensComanda,
  type CaixaResposta,
  type ComandaQuiosque,
  type FecharGrupoQuiosqueResponse,
} from '../../lib/quiosque';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'green' }) {
  return (
    <div className="metric-card">
      <p className={`metric-value w-full ${accent === 'green' ? 'metric-value-success' : ''}`}>{value}</p>
      <p className="text-xs sm:text-sm text-ink-muted leading-tight w-full">{label}</p>
    </div>
  );
}

export function QuiosqueComandasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cervejaria } = useAuth();
  const exibirKpis = cervejaria?.exibirKpisComanda ?? true;
  const colunaUnica = cervejaria?.comandasColunaUnica ?? true;
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];
  const [pontoVendaId, setPontoVendaId] = useState('');
  const [comandaTab, setComandaTab] = useState<'ABERTA' | 'FECHADA'>('ABERTA');
  const [buscaComanda, setBuscaComanda] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGroupPayment, setShowGroupPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [groupError, setGroupError] = useState('');
  const [groupSuccess, setGroupSuccess] = useState('');
  const isAbertas = comandaTab === 'ABERTA';

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const dia = diaOperacionalQuery();
  const pontoQuery = pontoAtivo ? `&pontoVendaId=${pontoAtivo}` : '';
  const pollMs = usePollInterval(30_000);

  const { data: caixaData } = useQuery({
    queryKey: ['quiosque-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });
  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const turnoAbertoEm = caixaAberto ? caixaData!.sessao!.abertoEm : null;

  const { data: abertas, isLoading: loadingAbertas } = useQuery({
    queryKey: ['quiosque-comandas', 'ABERTA', pontoAtivo],
    queryFn: () => api.get<ComandaQuiosque[]>(`/api/quiosque/comandas?status=ABERTA${pontoQuery}`),
    refetchInterval: pollMs,
    enabled: Boolean(pontoAtivo) && caixaAberto,
  });

  const { data: fechadasHoje, isLoading: loadingFechadas } = useQuery({
    queryKey: ['quiosque-comandas', 'FECHADA', pontoAtivo, dia],
    queryFn: () =>
      api.get<ComandaQuiosque[]>(`/api/quiosque/comandas?status=FECHADA&dia=${dia}${pontoQuery}`),
    refetchInterval: pollMs,
    enabled: Boolean(pontoAtivo) && caixaAberto,
  });

  const abertasTurno = caixaAberto ? (abertas ?? []) : [];
  const fechadasTurno = turnoAbertoEm ? comandasFechadasNoTurno(fechadasHoje ?? [], turnoAbertoEm) : [];

  const comandas = ordenarComandasParaOperacao(
    comandaTab === 'ABERTA' ? abertasTurno : fechadasTurno.filter((c) => c.tipo !== 'AVULSA'),
  );

  const quantidadeMesas = contexto.ativo ? (contexto.quantidadeMesas ?? 0) : 0;
  const mesas = useMemo(
    () => (quantidadeMesas <= 0 ? null : mesasOperacionais(quantidadeMesas, abertasTurno)),
    [quantidadeMesas, abertasTurno],
  );

  const itensLista = useMemo(
    () =>
      (isAbertas && mesas
        ? mesas.map((mesa) => ({ mesa, comanda: mesa.comanda }))
        : comandas.map((comanda) => ({ mesa: null, comanda }))),
    [comandas, isAbertas, mesas],
  );

  const comandasFiltradas = useMemo(
    () =>
      itensLista.filter(({ mesa, comanda }) =>
        textoCorrespondeBuscaComanda(
          buscaComanda,
          comanda ? rotuloComanda(comanda) : `Mesa ${mesa!.numero}`,
          comanda?.numero,
          comanda?.identificador ?? String(mesa?.numero ?? ''),
        ),
      ),
    [itensLista, buscaComanda],
  );

  const resumo = useMemo(() => {
    if (!caixaAberto) return { ...RESUMO_TURNO_VAZIO };

    const contas = fechadasTurno.filter((c) => c.tipo !== 'AVULSA');
    const avulsas = fechadasTurno.filter((c) => c.tipo === 'AVULSA');
    return {
      comandasAbertas: abertasTurno.length,
      comandasFechadas: contas.length,
      vendasAvulsas: avulsas.length,
      receitaAvulsa: avulsas.reduce((soma, c) => soma + c.total, 0),
      valorAberto: abertasTurno.reduce((soma, c) => soma + c.total, 0),
      valorFechado: contas.reduce((soma, c) => soma + c.total, 0),
    };
  }, [caixaAberto, abertasTurno, fechadasTurno]);

  const selectedComandas = useMemo(
    () => abertasTurno.filter((c) => selectedIds.includes(c.id)),
    [abertasTurno, selectedIds],
  );

  const totalGrupo = useMemo(
    () => selectedComandas.filter((c) => c.total > 0).reduce((sum, c) => sum + c.total, 0),
    [selectedComandas],
  );

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
    setShowGroupPayment(false);
    setGroupError('');
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const fecharGrupoMutation = useMutation({
    mutationFn: (pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[]) =>
      api.post<FecharGrupoQuiosqueResponse>('/api/quiosque/comandas/fechar-grupo', {
        comandaIds: selectedIds,
        pagamentos,
      }),
    onSuccess: (data) => {
      const parts: string[] = [];
      if (data.comandas.length > 0) parts.push(`${data.comandas.length} comanda(s) fechada(s)`);
      if (data.canceladas.length > 0) parts.push(`${data.canceladas.length} cancelada(s)`);
      setGroupSuccess(parts.join(' · ') || 'Operação concluída');
      setShowGroupPayment(false);
      exitSelectMode();
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
    },
    onError: (err) => {
      setGroupError(err instanceof ApiError ? err.message : 'Erro ao fechar comandas');
    },
  });

  const abrirMesaLivreMutation = useMutation({
    mutationFn: (numeroMesa: number) =>
      api.post<ComandaQuiosque>('/api/quiosque/comandas', {
        pontoVendaId: pontoAtivo,
        tipo: 'MESA',
        identificador: String(numeroMesa),
        itens: [],
      }),
    onSuccess: (comanda) => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      navigate(`/quiosque/comandas/${comanda.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/quiosque/comandas/${err.body.comandaId}`);
        return;
      }
      setGroupError(err instanceof ApiError ? err.message : 'Não foi possível abrir a mesa');
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
    if (comandaTab !== 'ABERTA') exitSelectMode();
  }, [comandaTab]);

  if (loadingAbertas && caixaAberto) return <Loading />;
  if (loadingFechadas && caixaAberto) return <Loading />;

  const canSelect = isAbertas;
  const showPayBar = selectMode && selectedIds.length >= 2 && totalGrupo > 0;

  return (
    <div className={`space-y-4 ${showPayBar ? 'page-with-action-bar' : 'pb-2'}`}>
      {pontosVenda.length > 1 && (
        <div>
          <label className="label">Ponto de venda</label>
          <select className="input" value={pontoAtivo} onChange={(e) => setPontoVendaId(e.target.value)}>
            {pontosVenda.map((ponto) => (
              <option key={ponto.id} value={ponto.id}>
                {ponto.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {pontoAtivo && (
        <>
          <PainelCaixaQuiosque
            pontoVendaId={pontoAtivo}
            compacto
            comandasAbertas={abertasTurno.length}
          />
          <PdvPortalQrButton pontoVendaId={pontoAtivo} />
        </>
      )}

      {!selectMode && (
        <div className="grid grid-cols-2 gap-2">
          <Link
            to="/quiosque/comandas/nova"
            className={`touch-btn-primary min-h-[3.75rem] flex items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold ${
              !caixaAberto ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-disabled={!caixaAberto}
            tabIndex={caixaAberto ? undefined : -1}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl leading-none font-normal">
              +
            </span>
            Comanda
          </Link>
          <Link
            to="/quiosque/comandas/venda-avulsa"
            data-onboarding-target="quiosque-start-sale"
            className={`touch-btn-secondary min-h-[3.75rem] flex items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold ${
              !caixaAberto ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-disabled={!caixaAberto}
            tabIndex={caixaAberto ? undefined : -1}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center text-xl leading-none text-orange"
              aria-hidden
            >
              ⚡
            </span>
            Venda avulsa
          </Link>
        </div>
      )}

      {groupSuccess && <div className="alert-success">{groupSuccess}</div>}
      {groupError && !showGroupPayment && <div className="alert-error">{groupError}</div>}

      {caixaAberto && exibirKpis && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comandas abertas" value={String(resumo.comandasAbertas)} />
          <StatCard label="Comandas fechadas" value={String(resumo.comandasFechadas)} accent="green" />
          <StatCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
          <StatCard label="Receita avulsa" value={formatCurrency(resumo.receitaAvulsa)} accent="green" />
          <StatCard label="Valor em aberto" value={formatCurrency(resumo.valorAberto)} />
          <StatCard label="Valor fechado" value={formatCurrency(resumo.valorFechado)} accent="green" />
        </div>
      )}

      {canSelect && resumo.comandasAbertas >= 2 && (
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
            Abertas ({resumo.comandasAbertas})
          </button>
          <button
            type="button"
            onClick={() => setComandaTab('FECHADA')}
            className={`segmented-control-btn ${
              !isAbertas ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Fechadas ({resumo.comandasFechadas})
          </button>
        </div>

        <ComandasBuscaInput
          value={buscaComanda}
          onChange={setBuscaComanda}
          placeholder="Buscar nº, mesa, ficha ou apelido..."
        />

        <div className={`grid gap-3 ${colunaUnica ? '' : 'grid-cols-2'}`}>
          {comandasFiltradas.map(({ mesa, comanda }) => {
            const livre = !comanda;
            const mesaOcupada = mesa != null && comanda != null;
            const isSelected = comanda ? selectedIds.includes(comanda.id) : false;
            const itens = comanda ? totalItensComanda(comanda) : 0;
            const valor = comanda?.total ?? 0;
            const titulo = comanda ? rotuloComanda(comanda) : `Mesa ${mesa!.numero}`;
            return (
              <button
                key={comanda?.id ?? `mesa-livre-${mesa!.numero}`}
                type="button"
                onClick={() => {
                  if (livre) {
                    if (caixaAberto) abrirMesaLivreMutation.mutate(mesa!.numero);
                    return;
                  }
                  if (selectMode && comanda) {
                    toggleSelection(comanda.id);
                    return;
                  }
                  navigate(`/quiosque/comandas/${comanda!.id}`);
                }}
                disabled={livre && (!caixaAberto || abrirMesaLivreMutation.isPending)}
                className={`card-touch w-full ${colunaUnica ? 'min-h-[4.5rem]' : 'min-h-[5.5rem]'} ${livre ? 'border-dashed border-green-300 bg-green-50/30' : ''} ${mesaOcupada ? 'quiosque-mesa-ocupada' : ''} ${
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
                        {selectMode && !livre && (
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
                            <h3 className="text-lg font-bold break-words">{titulo}</h3>
                            {mesaOcupada && <span className="badge-brand">Ocupada</span>}
                            {comanda && !isAbertas && <StatusBadge variant={comandaStatusVariant(comanda.status)} />}
                          </div>
                          <p className="text-sm text-ink-faint">
                            {livre ? 'Livre · toque para abrir' : `${comanda.pedidos.length} ${comanda.pedidos.length === 1 ? 'rodada' : 'rodadas'}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-bold text-brand-600 tabular-nums">{formatCurrency(valor)}</p>
                        <p className="text-xs text-ink-faint">{itens} item(ns)</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                        {selectMode && !livre && (
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
                              <h3 className="text-base font-bold break-words">{titulo}</h3>
                              {mesaOcupada && <span className="badge-brand">Ocupada</span>}
                              {comanda && !isAbertas && <StatusBadge variant={comandaStatusVariant(comanda.status)} />}
                            </div>
                          </div>
                        </div>
                        <p className="shrink-0 text-base font-bold text-brand-600 tabular-nums">
                          {formatCurrency(valor)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-ink-faint">
                        <span>
                          {livre ? 'Livre · toque para abrir' : `${comanda.pedidos.length} ${comanda.pedidos.length === 1 ? 'rodada' : 'rodadas'}`}
                        </span>
                        <span>{itens} item(ns)</span>
                      </div>
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
                  ? 'Nenhuma comanda aberta neste turno'
                  : caixaAberto
                    ? 'Nenhuma comanda fechada neste turno'
                    : 'Turno encerrado'
            }
            description={
              buscaComanda.trim()
                ? 'Tente outro nome ou número.'
                : isAbertas
                  ? caixaAberto
                    ? 'Use o botão Comanda acima para abrir uma nova conta.'
                    : 'Abra o caixa para iniciar um novo turno.'
                  : caixaAberto
                    ? undefined
                    : 'Abra o caixa para começar a operar de novo.'
            }
            action={
              !buscaComanda.trim() && isAbertas ? (
                caixaAberto ? (
                  <Link to="/quiosque/comandas/nova" className="touch-btn-primary touch-btn-sm inline-block">
                    Nova comanda
                  </Link>
                ) : (
                    <Link to={`/quiosque/caixa?pontoVendaId=${encodeURIComponent(pontoAtivo)}`} className="touch-btn-primary touch-btn-sm inline-block">
                    Abrir caixa
                  </Link>
                )
              ) : undefined
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

      <PaymentFormModal
        open={showGroupPayment}
        onClose={() => setShowGroupPayment(false)}
        title="Pagar comandas juntas"
        totalLabel="Total selecionado"
        total={totalGrupo}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleGroupClose}
        isPending={fecharGrupoMutation.isPending}
      />
    </div>
  );
}
