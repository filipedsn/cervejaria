import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, ApiError } from '../lib/api';
import type { Comanda, TapComChope, EventoCardapio, Evento } from '../types';
import { PAYMENT_LABELS, formatItemDetail, isBebidaChope, isVendaUnitaria, rotuloComandaCervejaria, descontoComandaCervejaria, subtotalComandaCervejaria } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useAuth } from '../contexts/AuthContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { MobileActionBar } from '../components/MobileActionBar';
import { IconTrash, IconWhatsApp } from '../components/NavIcons';
import { AdicionarItemComandaModal } from '../components/AdicionarItemComandaModal';
import { classificarGrupoProdutoOperacao } from '../lib/operacao';
import { PaymentDiscountFields } from '../components/checkout/PaymentDiscountFields';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../components/PaymentFormModal';
import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../lib/currency';
import { trackUiError } from '../lib/audit-tracker';
import { createCorrelationId } from '../lib/correlation-id';
import { formatPhone } from '../lib/phone';
import { linkWhatsAppNumeroComanda, linkWhatsAppResumoConta, navegarParaWhatsApp } from '../lib/whatsapp';

export function ComandaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento } = useEvento();
  const { cervejaria, podeDarDescontoOperacao } = useAuth();
  const canPermission = useAuth().canPermission;
  const podeOperarComanda = canPermission('command.operate');
  const podeCancelarItem = canPermission('command.item.cancel');

  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedComanda, setClosedComanda] = useState<Comanda | null>(null);
  const [closedAsPending, setClosedAsPending] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([
    { forma: 'PIX', valor: '' },
  ]);
  const [descontoInput, setDescontoInput] = useState('');
  const [error, setError] = useState('');
  const [closeErrorDetails, setCloseErrorDetails] = useState<{ referenceId: string; isApiCorrelation: boolean; status?: number; requestId?: string } | null>(null);
  const [itemAddedMessage, setItemAddedMessage] = useState('');
  const [visaoItens, setVisaoItens] = useState<'PEDIDOS' | 'RESUMO'>('PEDIDOS');

  useEffect(() => {
    if (!itemAddedMessage) return;
    const timeoutId = window.setTimeout(() => setItemAddedMessage(''), 5_000);
    return () => window.clearTimeout(timeoutId);
  }, [itemAddedMessage]);

  const { data: comanda, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['comanda', id],
    queryFn: () => api.get<Comanda>(`/api/comandas/${id}`),
    enabled: !!id,
  });

  const { data: operationalConfiguration } = useQuery({
    queryKey: ['operational-configuration'],
    queryFn: () => api.get<{ configuration: { kitchenItemsChargeAtLaunch?: boolean } | null }>('/api/cervejaria/configuracao-operacional'),
    enabled: Boolean(comanda),
  });
  const kitchenItemsChargeAtLaunch = operationalConfiguration?.configuration?.kitchenItemsChargeAtLaunch ?? false;
  const resumoItens = useMemo(() => {
    const agrupados = new Map<string, { nome: string; quantidade: number; totalCentavos: number }>();
    for (const item of comanda?.itens ?? []) {
      if (item.cancelamentoPendenteEm || item.canceladoEm) continue;
      if (item.exigePreparo && !kitchenItemsChargeAtLaunch && item.pedidoCozinha?.status !== 'ENTREGUE') continue;
      const chave = item.produtoId;
      const existente = agrupados.get(chave) ?? { nome: item.produto.nome, quantidade: 0, totalCentavos: 0 };
      const opcionaisUnitarios = (item.opcionais ?? []).reduce(
        (total, opcional) => total + parseFloat(opcional.precoAdicional) * opcional.quantidade,
        0,
      );
      const valorCentavos = Math.round((parseFloat(item.precoUnit) + opcionaisUnitarios) * item.quantidade * 100);
      existente.quantidade += item.quantidade;
      existente.totalCentavos += Number.isFinite(valorCentavos) ? valorCentavos : 0;
      agrupados.set(chave, existente);
    }
    return [...agrupados.entries()]
      .map(([chave, item]) => ({ chave, nome: item.nome, quantidade: item.quantidade, total: item.totalCentavos / 100, precoMedio: item.quantidade ? item.totalCentavos / item.quantidade / 100 : 0 }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }, [comanda?.itens, kitchenItemsChargeAtLaunch]);

  const needsEventoFetch = !!comanda && evento?.id !== comanda.eventoId;
  const { data: comandaEvento } = useQuery({
    queryKey: ['evento', comanda?.eventoId],
    queryFn: () => api.get<Evento>(`/api/eventos/${comanda!.eventoId}`),
    enabled: !!comanda?.eventoId && needsEventoFetch,
  });

  const eventoForTaps = needsEventoFetch ? comandaEvento : evento;
  const eventoIdForTaps = comanda?.eventoId ?? eventoForTaps?.id;

  const { data: taps } = useQuery({
    queryKey: ['evento-taps', eventoIdForTaps],
    queryFn: () => api.get<TapComChope[]>(`/api/eventos/${eventoIdForTaps}/taps`),
    enabled: !!eventoIdForTaps,
  });

  const { data: cardapio } = useQuery({
    queryKey: ['evento-cardapio', eventoIdForTaps],
    queryFn: () => api.get<EventoCardapio>(`/api/eventos/${eventoIdForTaps}/cardapio`),
    enabled: !!eventoIdForTaps,
  });

  useEffect(() => {
    if (!id || !eventoIdForTaps) return;
    const socket = getSocket();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['comanda', id] });
      queryClient.invalidateQueries({ queryKey: ['evento-taps', eventoIdForTaps] });
      queryClient.invalidateQueries({ queryKey: ['evento-cardapio', eventoIdForTaps] });
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
    };
    socket.on('item:added', handler);
    socket.on('item:removed', handler);
    socket.on('comanda:closed', handler);
    socket.on('comanda:updated', handler);
    socket.on('tap-montagem:updated', handler);
    socket.on('evento-cardapio:updated', handler);
    return () => {
      socket.off('item:added', handler);
      socket.off('item:removed', handler);
      socket.off('comanda:closed', handler);
      socket.off('comanda:updated', handler);
      socket.off('tap-montagem:updated', handler);
      socket.off('evento-cardapio:updated', handler);
    };
  }, [id, eventoIdForTaps, evento?.id, queryClient]);

  useEffect(() => {
    if (!showPayment || !comanda) return;
    const subtotal = subtotalComandaCervejaria(comanda, kitchenItemsChargeAtLaunch);
    const total = Math.max(0, subtotal - parseCurrencyInput(descontoInput));
    setPaymentForm((prev) => {
      if (total <= 0.01) return prev.length === 0 ? prev : [];
      if (prev.length === 0) return createDefaultPaymentForm(total);
      if (prev.length !== 1) return prev;
      const atual = parseCurrencyInput(prev[0].valor);
      if (Math.abs(atual - total) < 0.01) return prev;
      return [{ ...prev[0], valor: formatCurrencyInputFromNumber(total) }];
    });
  }, [descontoInput, showPayment, comanda?.itens, kitchenItemsChargeAtLaunch]);

  const addItemsMutation = useMutation({
    mutationFn: (itens: { produtoId: string; volumeMl: number; quantidade: number; tapId?: string; paraViagem?: boolean; observacao?: string; opcionais?: { opcionalId: string; quantidade: number }[] }[]) =>
      api.post<Comanda>(`/api/comandas/${id}/itens/lancar`, { itens }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['comanda', id], updated);
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      setError('');
      setItemAddedMessage('Itens lanÃ§ados. Selecione os prÃ³ximos itens.');
    },
    onError: (err) => {
      setItemAddedMessage('');
      setError(err instanceof ApiError ? err.message : 'Erro ao adicionar item');
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete<Comanda>(`/api/comandas/${id}/itens/${itemId}`),
    onSuccess: (updated) => {
      queryClient.setQueryData(['comanda', id], updated);
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover item'),
  });

  const closeMutation = useMutation({
    mutationFn: async ({
      pagamentos,
      desconto,
      descontoAnterior,
      aplicarDesconto,
      deixarPendente,
    }: {
      pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[];
      desconto: number;
      descontoAnterior: number;
      aplicarDesconto: boolean;
      deixarPendente: boolean;
    }) => {
      if (aplicarDesconto && desconto !== descontoAnterior) {
        await api.patch<Comanda>(`/api/comandas/${id}/desconto`, { desconto });
      }
      return api.post<Comanda>(`/api/pagamentos/comandas/${id}/fechar`, { pagamentos, deixarPendente });
    },
    onSuccess: (data, variables) => {
      setClosedComanda(data);
      setClosedAsPending(variables.deixarPendente);
      setShowPayment(false);
      setShowReceipt(true);
      queryClient.setQueryData(['comanda', id], data);
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      if (evento) queryClient.invalidateQueries({ queryKey: ['evento-contas-pendentes', evento.id] });
    },
    onError: (err) => {
      const isApiError = err instanceof ApiError;
      const correlationId = isApiError ? err.correlationId : undefined;
      const referenceId = correlationId ?? createCorrelationId();
      const status = isApiError && err.status > 0 ? err.status : undefined;
      const requestId = isApiError ? err.requestId : undefined;
      const message = isApiError ? err.message : 'Erro ao fechar comanda';
      setCloseErrorDetails({ referenceId, isApiCorrelation: Boolean(correlationId), status, requestId });
      setError(message);
      console.error('[comanda.close] Falha ao encerrar comanda', {
        correlationId,
        localReference: correlationId ? undefined : referenceId,
        requestId,
        status,
        errorName: err instanceof Error ? err.name : 'UnknownError',
      });
      trackUiError('Falha ao encerrar comanda');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post<Comanda>(`/api/comandas/${id}/cancelar`),
    onSuccess: () => {
      if (evento) {
        queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
      }
      navigate('/comandas');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao encerrar comanda'),
  });

  const novaComandaMutation = useMutation({
    mutationFn: () => {
      if (!comanda) throw new Error('Comanda nÃ£o carregada');
      return api.post<Comanda>('/api/comandas', {
        eventoId: comanda.eventoId,
        clienteNome: comanda.cliente.nome,
        clienteTelefone: comanda.cliente.telefone,
      });
    },
    onSuccess: (nova) => {
      if (evento) {
        queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
      }
      navigate(`/comandas/${nova.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/comandas/${err.body.comandaId}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Erro ao abrir nova comanda');
    },
  });

  const openPayment = () => {
    if (!comanda) return;
    const subtotal = subtotalComandaCervejaria(comanda, kitchenItemsChargeAtLaunch);
    const desconto = descontoComandaCervejaria(comanda);
    setDescontoInput(formatCurrencyInputFromNumber(desconto));
    setPaymentForm(createDefaultPaymentForm(Math.max(0, subtotal - desconto)));
    setShowPayment(true);
    setError('');
    setCloseErrorDetails(null);
  };

  const handleClose = (deixarPendente: boolean) => {
    if (!comanda) return;
    const desconto = parseCurrencyInput(descontoInput);
    const subtotal = subtotalComandaCervejaria(comanda, kitchenItemsChargeAtLaunch);
    const podeAplicarDesconto = podeDarDescontoOperacao;
    if (podeAplicarDesconto && desconto > subtotal) {
      setError('O desconto nÃ£o pode ser maior que o subtotal da comanda');
      return;
    }
    const pagamentos = deixarPendente ? [] : paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    closeMutation.mutate({
      pagamentos,
      desconto,
      descontoAnterior: descontoComandaCervejaria(comanda),
      aplicarDesconto: podeAplicarDesconto,
      deixarPendente,
    });
  };

  const comandaTotal = comanda ? parseFloat(comanda.total) : 0;

  const enviarNumeroComandaWhatsApp = () => {
    if (!comanda?.cliente?.telefone) return;
    const url = linkWhatsAppNumeroComanda({
      telefone: comanda.cliente.telefone,
      clienteNome: comanda.cliente.nome,
      nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
      numeroComanda: comanda.numero,
    });
    if (url) navegarParaWhatsApp(url);
  };

  const enviarResumoContaWhatsApp = () => {
    if (!comanda?.cliente?.telefone) return;
    const url = linkWhatsAppResumoConta({
      telefone: comanda.cliente.telefone,
      clienteNome: comanda.cliente.nome,
      nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
      identificacaoComanda: rotuloComandaCervejaria(comanda, comanda.cliente),
      itens: resumoItens.map((item) => ({ nome: item.nome, quantidade: item.quantidade, total: formatCurrency(item.total) })),
      subtotal: formatCurrency(comanda ? subtotalComandaCervejaria(comanda, kitchenItemsChargeAtLaunch) : 0),
      desconto: descontoSalvo > 0 ? formatCurrency(descontoSalvo) : null,
      total: formatCurrency(comanda.total),
      valorEmPreparo: valorPendente > 0 ? formatCurrency(valorPendente) : null,
    });
    if (url) navegarParaWhatsApp(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Comanda" />
        <Loading />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Comanda" />
        <div className="alert-error">
          {queryError instanceof ApiError ? queryError.message : 'Erro ao carregar comanda'}
        </div>
      </div>
    );
  }

  if (!comanda) {
    return (
      <div className="space-y-4">
        <PageHeader title="Comanda" />
        <p className="empty-state-text">Comanda nÃ£o encontrada</p>
      </div>
    );
  }

  const isOpen = comanda.status === 'ABERTA';
  const isCancelled = comanda.status === 'CANCELADA';
  const eventoAberto = eventoForTaps?.status === 'ABERTO';
  const tapsComChope = taps?.filter((t) => t.ativo && t.chopeAtual && isBebidaChope(t.chopeAtual)) ?? [];
  const produtosUnitarios = cardapio?.produtos.filter(isVendaUnitaria) ?? [];
  const bebidasEmbalagem = produtosUnitarios.filter((p) => classificarGrupoProdutoOperacao(p) === 'bebidas');
  const comidas = produtosUnitarios.filter((p) => classificarGrupoProdutoOperacao(p) === 'comidas');
  const outrosProdutos = produtosUnitarios.filter((p) => classificarGrupoProdutoOperacao(p) === 'outros');
  const hasActionBar = isOpen || !isOpen;
  const podeAplicarDesconto = podeDarDescontoOperacao;
  const subtotal = subtotalComandaCervejaria(comanda, kitchenItemsChargeAtLaunch);
  const valorPendente = kitchenItemsChargeAtLaunch ? 0 : comanda.itens
    .filter((item) => item.exigePreparo && !item.cancelamentoPendenteEm && !item.canceladoEm && item.pedidoCozinha?.status !== 'ENTREGUE' && item.pedidoCozinha?.status !== 'CANCELADO' && item.pedidoCozinha?.status !== 'CANCELAMENTO_PENDENTE')
    .reduce((total, item) => total + parseFloat(item.precoUnit) * item.quantidade, 0);
  const descontoValor = parseCurrencyInput(descontoInput);
  const totalComDesconto = Math.max(0, subtotal - descontoValor);
  const descontoSalvo = descontoComandaCervejaria(comanda);

  const paymentHeaderExtra = (
    <div className="space-y-3">
      {error && showPayment && (
        <div className="alert-error text-sm" role="alert">
          <div>{error}</div>
          {closeErrorDetails && (
            <div className="mt-1 text-xs opacity-80">
              {closeErrorDetails.isApiCorrelation ? 'CorrelaÃ§Ã£o da requisiÃ§Ã£o: ' : 'ReferÃªncia local (nÃ£o pesquisÃ¡vel no servidor): '}
              {closeErrorDetails.referenceId}
              {closeErrorDetails.status != null && ` Â· HTTP ${closeErrorDetails.status}`}
              {closeErrorDetails.requestId && ` Â· RequisiÃ§Ã£o ${closeErrorDetails.requestId}`}
            </div>
          )}
        </div>
      )}
      {podeAplicarDesconto && (
        <PaymentDiscountFields
          inputId="desconto-fechar"
          subtotal={subtotal}
          discountValue={descontoValor}
          discountInput={descontoInput}
          onDiscountChange={setDescontoInput}
          total={totalComDesconto}
          disabled={closeMutation.isPending}
        />
      )}
    </div>
  );

  return (
    <div className={`space-y-4 ${hasActionBar ? 'page-with-action-bar' : 'pb-2'}`}>

      <div className="card">
        <div className="flex items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Enviar nÃºmero sequencial da comanda pelo WhatsApp"
              title={comanda.cliente.telefone ? 'Enviar nÃºmero da comanda pelo WhatsApp' : 'Cadastre um telefone para o cliente'}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!comanda.cliente.telefone || comanda.numero == null}
              onClick={enviarNumeroComandaWhatsApp}
            >
              <IconWhatsApp className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate leading-tight">{comanda.cliente.nome}</h2>
              {comanda.cliente.telefone && <p className="text-sm text-ink-faint mt-1">{formatPhone(comanda.cliente.telefone)}</p>}
            </div>
          </div>
          <p className="ml-auto text-2xl sm:text-3xl font-bold text-brand-600 tabular-nums whitespace-nowrap">{formatCurrency(comanda.total)}</p>
        </div>
        {valorPendente > 0 && <p className="mt-1 text-right text-sm font-semibold text-amber-400">Pendente na cozinha: {formatCurrency(valorPendente)}</p>}
        {!isOpen && descontoSalvo > 0 && (
          <div className="mt-3 space-y-1 text-sm border-t border-line pt-3">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-ink-muted">
              <span>Desconto</span>
              <span className="tabular-nums text-red-600">âˆ’ {formatCurrency(descontoSalvo)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(comanda.total)}</span>
            </div>
          </div>
        )}
      </div>

      {error && !showAddItem && !showPayment && <div className="alert-error">{error}</div>}

      {/* Consumo da comanda */}
      <div className="space-y-2">
        <h3 className="section-label">Consumo da comanda</h3>
        {isOpen && podeOperarComanda && (
          <button
            type="button"
            className="touch-btn-primary w-full"
            onClick={() => {
              setError('');
              setItemAddedMessage('');
              setShowAddItem(true);
            }}
          >
            + Itens
          </button>
        )}
        <nav className="segmented-control" aria-label="VisualizaÃ§Ã£o dos itens da comanda">
          <button
            type="button"
            className={`segmented-control-btn ${visaoItens === 'PEDIDOS' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
            aria-pressed={visaoItens === 'PEDIDOS'}
            onClick={() => setVisaoItens('PEDIDOS')}
          >
            Pedidos ({comanda.itens.length})
          </button>
          <button
            type="button"
            className={`segmented-control-btn ${visaoItens === 'RESUMO' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
            aria-pressed={visaoItens === 'RESUMO'}
            onClick={() => setVisaoItens('RESUMO')}
          >
            Resumo da conta
          </button>
          <button
            type="button"
            aria-label="Enviar resumo da conta pelo WhatsApp"
            title={comanda.cliente.telefone ? 'Enviar resumo da conta pelo WhatsApp' : 'Cadastre um telefone para o cliente'}
            className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!comanda.cliente.telefone}
            onClick={enviarResumoContaWhatsApp}
          >
            <IconWhatsApp className="h-6 w-6" />
          </button>
        </nav>
        {visaoItens === 'PEDIDOS' ? (
          <>
        {comanda.itens.map((item) => (
          <div key={item.id} className={`card flex items-center justify-between gap-3 py-3 ${item.cancelamentoPendenteEm ? 'border-orange-500/70 bg-orange-950/20' : item.canceladoEm ? 'opacity-60' : ''}`}>
            <div className="min-w-0">
              <p className="font-semibold">{item.produto.nome}</p>
              <p className="text-sm text-ink-muted">{formatItemDetail(item)}</p>
              {item.cancelamentoPendenteEm && <p className="mt-1 text-xs font-semibold text-orange-400">Cancelamento solicitado â€” aguardando confirmaÃ§Ã£o da cozinha</p>}
              {item.canceladoEm && <p className="mt-1 text-xs font-semibold text-ink-muted">Cancelado pela cozinha</p>}
              {item.observacao && <p className="text-xs text-ink-muted">Obs: {item.observacao}</p>}
              {item.opcionais?.length ? <p className="text-xs text-ink-muted">{item.opcionais.map((opcao) => opcao.nome).join(' Â· ')}</p> : null}
              {item.paraViagem && (
                <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  Para viagem
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-bold tabular-nums">{item.cancelamentoPendenteEm || item.canceladoEm ? 'â€”' : formatCurrency(parseFloat(item.precoUnit) * item.quantidade)}</span>
              {isOpen && podeCancelarItem && !item.cancelamentoPendenteEm && !item.canceladoEm && (
                <button
                  type="button"
                  aria-label={`Remover ${item.produto.nome}`}
                  onClick={() => removeItemMutation.mutate(item.id)}
                  disabled={removeItemMutation.isPending}
                  className="icon-btn-danger"
                >
                  <IconTrash />
                </button>
              )}
            </div>
          </div>
        ))}
        {isOpen && comanda.itens.length === 0 && (
          <p className="text-sm text-ink-faint text-center py-2">
            Nenhum item ainda. Adicione itens para registrar consumo.
          </p>
        )}
          </>
        ) : (
          <section className="card space-y-3">
            {resumoItens.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">Ainda nÃ£o hÃ¡ itens vÃ¡lidos para resumir.</p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_5rem_8rem_8rem] gap-3 border-b border-line pb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint sm:grid">
                  <span>Produto</span><span className="text-right">Qtd.</span><span className="text-right">Valor</span><span className="text-right">Total</span>
                </div>
                <ul className="divide-y divide-line">
                  {resumoItens.map((linha) => (
                    <li key={linha.chave} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_8rem] sm:items-center">
                      <span className="min-w-0 font-medium">{linha.nome}</span>
                      <span className="text-right text-sm tabular-nums">{linha.quantidade}x</span>
                      <span className="col-start-1 text-xs text-ink-faint sm:col-auto sm:text-right">Valor {formatCurrency(linha.precoMedio)}</span>
                      <strong className="row-span-2 self-center text-right tabular-nums sm:row-span-1">{formatCurrency(linha.total)}</strong>
                    </li>
                  ))}
                </ul>
                <div className="space-y-2 border-t border-line pt-3">
                  <div className="flex justify-between text-sm text-ink-muted"><span>Subtotal dos itens</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
                  {descontoSalvo > 0 && <div className="flex justify-between text-sm text-ink-muted"><span>Desconto</span><span className="tabular-nums">âˆ’ {formatCurrency(descontoSalvo)}</span></div>}
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(comanda.total)}</span></div>
                </div>
              </>
            )}
            <p className="text-xs text-ink-faint">Itens cancelados ou com cancelamento pendente nÃ£o entram neste resumo. Itens de cozinha entram apÃ³s a entrega.</p>
          </section>
        )}
      </div>

      {!isOpen && (
        <div className="rounded-xl bg-surface-lighter border border-line px-4 py-3 text-sm text-ink-muted leading-relaxed">
          {isCancelled ? (
            <>Comanda cancelada â€” encerrada sem consumaÃ§Ã£o.</>
          ) : comanda.pagamentos.length > 0 ? (
            <>
              Pagamento confirmado â€” comanda registrada, sem ediÃ§Ã£o.
              Para novos pedidos, use <span className="font-semibold text-ink-soft">Nova comanda</span> abaixo.
            </>
          ) : descontoSalvo >= subtotal && subtotal > 0 ? (
            <>Cortesia confirmada â€” comanda encerrada sem pagamento.</>
          ) : (
            <>Comanda fechada â€” somente leitura.</>
          )}
        </div>
      )}

      {/* Pagamentos â€” comanda fechada */}
      {!isOpen && comanda.pagamentos.length > 0 && (
        <div className="card space-y-2">
          <h3 className="text-sm font-medium text-ink-muted">Pagamentos confirmados</h3>
          {comanda.pagamentos.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>{PAYMENT_LABELS[p.forma]}</span>
              <span className="font-bold">{formatCurrency(p.valor)}</span>
            </div>
          ))}
        </div>
      )}

      {/* AÃ§Ãµes fixas â€” comanda aberta */}
      {isOpen && comanda.itens.length > 0 && (
        <MobileActionBar>
          <button type="button" className="touch-btn-orange w-full" onClick={openPayment} data-audit="comanda-fechar">
            Fechar Comanda Â· {formatCurrency(comanda.total)}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {isOpen && comanda.itens.length === 0 && (
        <MobileActionBar>
          <p className="text-xs text-center text-ink-faint px-2">
            Sem consumaÃ§Ã£o â€” use Encerrar comanda para cancelar.
          </p>
          <button
            type="button"
            className="touch-btn-orange w-full"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            data-audit="comanda-cancelar"
          >
            {cancelMutation.isPending ? 'Encerrando...' : 'Encerrar comanda'}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {/* AÃ§Ãµes fixas â€” comanda fechada */}
      {!isOpen && (
        <MobileActionBar>
          {evento?.status === 'ABERTO' && !isCancelled && (
            <button
              type="button"
              className="touch-btn-primary w-full"
              onClick={() => novaComandaMutation.mutate()}
              disabled={novaComandaMutation.isPending}
            >
              {novaComandaMutation.isPending
                ? 'Abrindo...'
                : `Nova comanda Â· ${rotuloComandaCervejaria(comanda, comanda.cliente)}`}
            </button>
          )}
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      <AdicionarItemComandaModal
        open={showAddItem}
        onClose={() => {
          setShowAddItem(false);
          setItemAddedMessage('');
        }}
        tapsComChope={tapsComChope}
        bebidas={bebidasEmbalagem}
        comidas={comidas}
        outros={outrosProdutos}
        eventoAberto={!!eventoAberto}
        comandaTotal={comandaTotal}
        onAdd={() => undefined}
        launchMode
        onLaunch={(itens) => addItemsMutation.mutateAsync(itens).then(() => undefined)}
        isPending={addItemsMutation.isPending}
        error={showAddItem ? error : undefined}
        successMessage={showAddItem ? itemAddedMessage : undefined}
      />

      <PaymentFormModal
        open={showPayment}
        onClose={() => {
          setShowPayment(false);
          setError('');
        }}
        title="Fechar Comanda"
        totalLabel="Total a pagar"
        total={podeAplicarDesconto ? totalComDesconto : comandaTotal}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={() => handleClose(false)}
        isPending={closeMutation.isPending}
        headerExtra={paymentHeaderExtra}
        deferLabel="Deixar pendente"
        secondaryAction={comanda && eventoAberto ? (
          <button
            type="button"
            className="touch-btn-secondary w-full min-h-14"
            disabled={closeMutation.isPending}
            onClick={() => navigate(`/comandas?selecionar=${encodeURIComponent(comanda.id)}`)}
          >
            Selecionar comandas
          </button>
        ) : undefined}
        deferDisabled={!comanda?.cliente.telefone || comanda.cliente.telefone.replace(/\D/g, '').length < 10 || comandaTotal <= 0}
        deferConfirmation={<p className="rounded-xl border border-orange/30 bg-surface-lighter p-4 text-sm">A comanda serÃ¡ encerrada sem recebimento. O saldo ficarÃ¡ vinculado a {comanda?.cliente.nome ?? 'este cliente'} e aparecerÃ¡ nas contas pendentes do evento.</p>}
        onConfirmDefer={() => handleClose(true)}
      />

      {/* Recibo */}
      <Modal open={showReceipt} onClose={() => { setShowReceipt(false); navigate('/comandas'); }} title="Comanda Fechada">
        {closedComanda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">âœ…</div>
            <p className="text-xl font-bold">{rotuloComandaCervejaria(closedComanda, closedComanda.cliente)}</p>
            <p className="text-3xl font-bold text-brand-600">{formatCurrency(closedComanda.total)}</p>
            <div className="space-y-1">
              {closedAsPending ? (
                <p className="font-semibold text-orange-dark">Conta pendente registrada Â· receba pelo painel do evento.</p>
              ) : closedComanda.pagamentos.length === 0 ? (
                <p className="font-semibold text-success">Cortesia â€” sem pagamento</p>
              ) : (
                closedComanda.pagamentos.map((p) => (
                  <p key={p.id} className="text-ink-muted">{PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}</p>
                ))
              )}
            </div>
            <button className="touch-btn-primary w-full" onClick={() => { setShowReceipt(false); navigate('/comandas'); }}>
              OK
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
