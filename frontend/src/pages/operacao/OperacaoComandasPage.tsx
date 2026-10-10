import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { ComandasBuscaInput } from '../../components/ComandasBuscaInput';
import { MobileActionBar } from '../../components/MobileActionBar';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../../components/PaymentFormModal';
import { parseCurrencyInput } from '../../lib/currency';
import { textoCorrespondeBuscaComanda } from '../../lib/comandas-busca';
import { PainelCaixaOperacao } from '../../components/operacao/PainelCaixaOperacao';
import { IconWhatsApp } from '../../components/NavIcons';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useAuth } from '../../contexts/AuthContext';
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';
import { connectSocket, getSocket } from '../../lib/socket';
import {
  comandasFechadasNoTurno,
  diaOperacionalQuery,
  mesasOperacionais,
  ordenarComandasParaOperacao,
  RESUMO_TURNO_VAZIO,
  rotuloComanda,
  type CaixaResposta,
  type ComandaOperacao,
  type FecharGrupoOperacaoResponse,
} from '../../lib/operacao';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'green' }) {
  return (
    <div className="metric-card">
      <p className={`metric-value w-full ${accent === 'green' ? 'metric-value-success' : ''}`}>{value}</p>
      <p className="text-xs sm:text-sm text-ink-muted leading-tight w-full">{label}</p>
    </div>
  );
}

export function OperacaoComandasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cervejaria, canPermission } = useAuth();
  const podeAbrirComanda = canPermission('command.operate');
  const exibirKpis = cervejaria?.exibirKpisComanda ?? true;
  const colunaUnica = cervejaria?.comandasColunaUnica ?? true;
  const { contexto } = useOperacaoContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];
  const [searchParams, setSearchParams] = useSearchParams();
  const pontoVendaSelecionadoId = searchParams.get('pontoVendaId') ?? '';
  const [comandaTab, setComandaTab] = useState<'ABERTA' | 'FECHADA'>('ABERTA');
  const [buscaComanda, setBuscaComanda] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGroupPayment, setShowGroupPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [groupError, setGroupError] = useState('');
  const fecharGrupoEmAndamento = useRef(false);
  const avisoWhatsAppStorageKey = 'quiver:aviso-whatsapp:comandas';
  const [avisoWhatsAppAbertoId, setAvisoWhatsAppAbertoId] = useState<string | null>(() =>
    window.sessionStorage.getItem(avisoWhatsAppStorageKey),
  );
  const [avisoError, setAvisoError] = useState('');
  const isAbertas = comandaTab === 'ABERTA';

  const pontoAtivo = pontosVenda.some((ponto) => ponto.id === pontoVendaSelecionadoId)
    ? pontoVendaSelecionadoId
    : pontosVenda[0]?.id || '';
  const dia = diaOperacionalQuery();
  const pontoQuery = pontoAtivo ? `&pontoVendaId=${pontoAtivo}` : '';
  const pollMs = usePollInterval(30_000);

  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });
  const caixaData = caixaQuery.data;
  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const turnoAbertoEm = caixaAberto ? caixaData!.sessao!.abertoEm : null;

  const { data: abertas, isLoading: loadingAbertas } = useQuery({
    queryKey: ['operacao-comandas', 'ABERTA', pontoAtivo],
    queryFn: () => api.get<ComandaOperacao[]>(`/api/operacao/comandas?status=ABERTA${pontoQuery}`),
    refetchInterval: pollMs,
    enabled: Boolean(pontoAtivo) && caixaAberto,
  });

  const { data: fechadasHoje, isLoading: loadingFechadas } = useQuery({
    queryKey: ['operacao-comandas', 'FECHADA', pontoAtivo, dia],
    queryFn: () =>
      api.get<ComandaOperacao[]>(`/api/operacao/comandas?status=FECHADA&dia=${dia}${pontoQuery}`),
    refetchInterval: pollMs,
    enabled: Boolean(pontoAtivo) && caixaAberto,
  });

  useEffect(() => {
    if (!cervejaria?.id) return;
    connectSocket(cervejaria.id);
    const socket = getSocket();
    const atualizarComandas = () => {
      void queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
    };
    socket.on('operacao:comanda-atualizada', atualizarComandas);
    socket.on('operacao:pedido-atualizado', atualizarComandas);
    return () => {
      socket.off('operacao:comanda-atualizada', atualizarComandas);
      socket.off('operacao:pedido-atualizado', atualizarComandas);
    };
  }, [cervejaria?.id, queryClient]);

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

  const marcarClienteAvisado = useMutation({
    mutationFn: ({ comandaId, pedidoId }: { comandaId: string; pedidoId: string }) =>
      api.patch<{ clienteAvisadoEm: string }>(
        `/api/operacao/comandas/${comandaId}/pedidos/${pedidoId}/cliente-avisado`,
        {},
      ),
    onSuccess: () => {
      window.sessionStorage.removeItem(avisoWhatsAppStorageKey);
      setAvisoWhatsAppAbertoId(null);
      setAvisoError('');
      void queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
    },
    onError: (cause) => {
      setAvisoError(cause instanceof ApiError ? cause.message : 'NÃ£o foi possÃ­vel atualizar o aviso.');
    },
  });

  const totalGrupo = useMemo(
    () => selectedComandas.reduce((sum, c) => sum + c.total, 0),
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
      api.post<FecharGrupoOperacaoResponse>('/api/operacao/comandas/fechar-grupo', {
        comandaIds: selectedIds,
        pagamentos,
      }),
    onSuccess: () => {
      setShowGroupPayment(false);
      exitSelectMode();
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
    },
    onError: (err) => {
      setGroupError(err instanceof ApiError ? err.message : 'Erro ao fechar comandas');
    },
  });

  const abrirMesaLivreMutation = useMutation({
    mutationFn: (numeroMesa: number) =>
      api.post<ComandaOperacao>('/api/operacao/comandas', {
        pontoVendaId: pontoAtivo,
        tipo: 'MESA',
        identificador: String(numeroMesa),
        itens: [],
      }),
    onSuccess: (comanda) => {
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      navigate(`/operacao/comandas/${comanda.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/operacao/comandas/${err.body.comandaId}`);
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
    if (fecharGrupoEmAndamento.current) return;
    fecharGrupoEmAndamento.current = true;
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    fecharGrupoMutation.mutate(pagamentos, {
      onSettled: () => {
        fecharGrupoEmAndamento.current = false;
      },
    });
  };

  useEffect(() => {
    if (comandaTab !== 'ABERTA') exitSelectMode();
  }, [comandaTab]);

  useEffect(() => {
    const mandanteId = searchParams.get('selecionar');
    if (!mandanteId || !isAbertas || !abertasTurno.some((c) => c.id === mandanteId)) return;
    setSelectMode(true);
    setSelectedIds([mandanteId]);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('selecionar');
    setSearchParams(nextParams, { replace: true });
  }, [abertasTurno, isAbertas, searchParams, setSearchParams]);

  if (loadingAbertas && caixaAberto) return <Loading />;
  if (loadingFechadas && caixaAberto) return <Loading />;

  const showPayBar = selectMode && selectedIds.length >= 2 && totalGrupo > 0;

  return (
    <div className={`space-y-4 ${showPayBar ? 'page-with-action-bar' : 'pb-2'}`}>
      {pontosVenda.length > 1 && (
        <div>
          <label className="label">Ponto de venda</label>
          <select
            className="input"
            value={pontoAtivo}
            onChange={(e) => {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set('pontoVendaId', e.target.value);
              setSearchParams(nextParams, { replace: true });
            }}
          >
            {pontosVenda.map((ponto) => (
              <option key={ponto.id} value={ponto.id}>
                {ponto.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {pontoAtivo && (
        <PainelCaixaOperacao
          pontoVendaId={pontoAtivo}
          compacto
          comandasAbertas={abertasTurno.length}
        />
      )}

      {!selectMode && (
        <section className="space-y-2.5" aria-label="Ações rápidas">
          <header><h2 className="text-xl font-bold">Ações rápidas</h2><p className="text-sm text-ink-muted">Acesso rápido às principais funcionalidades do seu dia a dia.</p></header>
          <div className="grid grid-cols-2 gap-2">
            {podeAbrirComanda && <Link to="/operacao/comandas/nova" className={`group flex min-h-16 min-w-0 w-full items-center justify-center gap-1.5 rounded-2xl border border-sky-300/40 bg-gradient-to-br from-sky-500 to-blue-700 px-1.5 py-2 text-left text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3 ${!caixaAberto ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={!caixaAberto} tabIndex={caixaAberto ? undefined : -1}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/15 text-xl font-light leading-none sm:h-10 sm:w-10 sm:rounded-xl sm:text-3xl">+</span>
              <span className="min-w-0"><strong className="block whitespace-nowrap text-[clamp(0.68rem,3.6vw,1rem)] font-bold leading-tight">Nova comanda</strong></span>
              <span className="shrink-0 text-base text-white/90 transition-transform group-hover:translate-x-1 sm:text-xl" aria-hidden="true">›</span>
            </Link>}
            {podeAbrirComanda && <Link to="/operacao/comandas/venda-avulsa" data-onboarding-target="operacao-start-sale" className={`group flex min-h-16 min-w-0 w-full items-center justify-center gap-1.5 rounded-2xl border border-orange-300/50 bg-gradient-to-br from-orange-500 to-orange-700 px-1.5 py-2 text-left text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110 sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3 ${!caixaAberto ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={!caixaAberto} tabIndex={caixaAberto ? undefined : -1}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/15 sm:h-10 sm:w-10 sm:rounded-xl"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-current sm:h-6 sm:w-6" aria-hidden="true"><path d="M13.2 1.8 4.9 13a1 1 0 0 0 .8 1.6h5l-.8 7.6 9.2-12a1 1 0 0 0-.8-1.6h-5.1l1-6a1 1 0 0 0-1.8-.8Z" /></svg></span>
              <span className="min-w-0"><strong className="block whitespace-nowrap text-[clamp(0.68rem,3.6vw,1rem)] font-bold leading-tight">Venda avulsa</strong></span>
              <span className="shrink-0 text-base text-white/90 transition-transform group-hover:translate-x-1 sm:text-xl" aria-hidden="true">›</span>
            </Link>}
          </div>
        </section>
      )}

      {groupError && !showGroupPayment && <div className="alert-error">{groupError}</div>}
      {avisoError && <div className="alert-error" role="alert">{avisoError}</div>}

      {caixaAberto && exibirKpis && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comandas abertas" value={String(resumo.comandasAbertas)} />
          <StatCard label="Comandas fechadas" value={String(resumo.comandasFechadas)} accent="green" />
          <StatCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
          <StatCard label="Receita avulsa" value={formatCurrency(resumo.receitaAvulsa)} accent="green" />
          <StatCard label="Valor em aberto" value={formatCurrency(resumo.valorAberto)} />
          <StatCard label="Vendas encerradas" value={formatCurrency(resumo.valorFechado)} accent="green" />
        </div>
      )}

      {false && resumo.comandasAbertas >= 2 && (
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

      <section className="space-y-3 rounded-2xl border border-brand-600/20 bg-gradient-to-br from-surface via-surface to-brand-900/10 p-3 shadow-sm sm:space-y-4 sm:p-5">
        <header>
          <h2 className="text-xl font-bold">Comandas</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Gerencie as comandas abertas e fechadas.</p>
        </header>

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
            const valor = comanda?.total ?? 0;
            const titulo = comanda ? rotuloComanda(comanda) : `Mesa ${mesa!.numero}`;
            const pedidosProntosParaAvisar = comanda && isAbertas && !selectMode &&
              contexto.whatsappPedidoProntoEnabled &&
              !contexto.whatsappPedidoProntoNaCozinha &&
              Boolean(comanda.cliente?.telefone)
              ? comanda.pedidos.filter((pedido) =>
                  pedido.status === 'PRONTO' &&
                  !pedido.clienteAvisadoEm &&
                  pedido.itens.some((item) =>
                    item.exigePreparo && !item.cancelamentoPendenteEm && !item.canceladoEm,
                  ),
              )
              : [];
            const botoesAvisoCliente = pedidosProntosParaAvisar.map((pedido) => {
              const jaAbriuWhatsApp = avisoWhatsAppAbertoId === pedido.id;
              const aguardandoSalvar = marcarClienteAvisado.isPending &&
                marcarClienteAvisado.variables?.pedidoId === pedido.id;
              return (
                <button
                  key={pedido.id}
                  type="button"
                  disabled={marcarClienteAvisado.isPending}
                  aria-label={jaAbriuWhatsApp
                    ? `Confirmar envio da mensagem da senha ${pedido.numero}`
                    : `Avisar cliente pelo WhatsApp, senha ${pedido.numero}`}
                  title={jaAbriuWhatsApp ? 'Confirmar envio' : `Avisar cliente · senha ${pedido.numero}`}
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border p-0 text-white transition-colors disabled:opacity-50 ${
                    jaAbriuWhatsApp
                      ? 'border-brand-500/40 bg-brand-600 hover:bg-brand-500'
                      : 'border-emerald-500/40 bg-emerald-600 hover:bg-emerald-500'
                  }`}
                  onClick={() => {
                    if (jaAbriuWhatsApp) {
                      marcarClienteAvisado.mutate({ comandaId: comanda!.id, pedidoId: pedido.id });
                      return;
                    }
                    const url = linkWhatsAppPedidoPronto({
                      telefone: comanda!.cliente?.telefone,
                      clienteNome: comanda!.cliente?.nome ?? titulo,
                      numeroPedido: pedido.numero,
                      nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
                    });
                    if (!url) return;
                    setAvisoError('');
                    window.sessionStorage.setItem(avisoWhatsAppStorageKey, pedido.id);
                    setAvisoWhatsAppAbertoId(pedido.id);
                    navegarParaWhatsApp(url);
                  }}
                >
                  {jaAbriuWhatsApp ? (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  ) : <IconWhatsApp className="h-6 w-6" />}
                  <span className="sr-only">{aguardandoSalvar ? 'Confirmando envio...' : jaAbriuWhatsApp ? 'Confirmar envio' : `Avisar cliente, senha ${pedido.numero}`}</span>
                </button>
              );
            });
            const abrirComanda = () => {
              if (livre) {
                if (caixaAberto) abrirMesaLivreMutation.mutate(mesa!.numero);
                return;
              }
              if (selectMode && comanda) {
                toggleSelection(comanda.id);
                return;
              }
              navigate(`/operacao/comandas/${comanda!.id}`);
            };
            return (
              <div
                key={comanda?.id ?? `mesa-livre-${mesa!.numero}`}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  abrirComanda();
                }}
                className={`card-touch @container w-full !min-h-16 !p-2.5 ${livre ? 'border-dashed border-green-300 bg-green-50/30' : ''} ${mesaOcupada ? 'operacao-mesa-ocupada' : ''} ${
                  selectMode
                    ? isSelected
                      ? 'border-brand-500 bg-brand-50/40'
                      : 'hover:border-brand-400/30'
                    : 'hover:border-brand-400/30'
                }`}
              >
                <div className={`flex min-h-11 min-w-0 items-center gap-2 ${colunaUnica ? '' : 'comanda-card-duas-colunas'}`}>
                  {selectMode && !livre && (
                    <span
                      className={`comanda-card-select flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                        isSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface'
                      }`}
                      aria-hidden
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={abrirComanda}
                    disabled={livre && (!caixaAberto || abrirMesaLivreMutation.isPending)}
                    className="comanda-card-main flex min-w-0 flex-1 items-center overflow-hidden rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <h3 className={`flex min-w-0 flex-1 items-center whitespace-nowrap font-bold leading-tight ${colunaUnica ? 'text-[clamp(0.75rem,5cqi,1rem)]' : 'text-[clamp(0.875rem,5.5cqi,1.05rem)]'}`}>
                      {comanda?.numero != null && <span className="mr-1 shrink-0 text-orange-dark">{comanda.numero} —</span>}
                      <span className="min-w-0 truncate">{titulo}</span>
                    </h3>
                  </button>
                  <div className="comanda-card-notify flex shrink-0 items-center gap-1.5">
                    {botoesAvisoCliente}
                  </div>
                  <button
                    type="button"
                    onClick={abrirComanda}
                    disabled={livre && (!caixaAberto || abrirMesaLivreMutation.isPending)}
                    className="comanda-card-amount shrink-0 rounded-lg text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <span className="whitespace-nowrap font-bold tabular-nums text-brand-600 text-[clamp(0.75rem,4cqi,1.25rem)]">
                      {formatCurrency(valor)}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {caixaQuery.isError && <div role="alert" className="alert-error">Nao foi possivel consultar o caixa. Tente novamente; isso nao confirma que o turno foi fechado.</div>}
        {comandasFiltradas.length === 0 && !caixaQuery.isError && (
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
                  <Link to="/operacao/comandas/nova" className="touch-btn-primary touch-btn-sm inline-block">
                    Nova comanda
                  </Link>
                ) : (
                    <Link to="/operacao/comandas" className="touch-btn-primary touch-btn-sm inline-block">
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
