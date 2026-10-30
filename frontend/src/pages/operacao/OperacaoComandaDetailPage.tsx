import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { formatPhone } from '../../lib/phone';
import { digitsOnly } from '../../lib/phone';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { MobileActionBar } from '../../components/MobileActionBar';
import { IconTrash, IconWhatsApp } from '../../components/NavIcons';
import { AdicionarItensOperacaoModal } from '../../components/operacao/AdicionarItensOperacaoModal';
import { CancelarQuantidadeModal } from '../../components/operacao/CancelarQuantidadeModal';
import { PaymentDiscountFields } from '../../components/checkout/PaymentDiscountFields';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../../components/PaymentFormModal';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import { PAYMENT_LABELS } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { connectSocket, getSocket } from '../../lib/socket';
import { useAtendimentoBalcao } from '../../hooks/useAtendimentoBalcao';
import { resumoItensBalcao } from '../../lib/atendimento-balcao';
import { linkWhatsAppNumeroComanda, linkWhatsAppPedidoPronto, linkWhatsAppResumoConta, navegarParaWhatsApp } from '../../lib/whatsapp';
import {
  isChopeOperacao,
  itemConfirmadoNaComanda,
  mapSaldosEstoque,
  pedidoConfirmadoNaComanda,
  pedidoVisivelNaComanda,
  pedidoVaiParaCozinha,
  ordenarPedidosPorSenhaDecrescente,
  podeAlterarQuantidadeItemComanda,
  podeRemoverItemComanda,
  podeIncrementarItemComanda,
  podeIncrementarLinhaCarrinho,
  produtosOperacionaisUrl,
  rotuloComanda,
  rotuloStatusPedido,
  resumirItensComanda,
  temPedidoCozinhaPendente,
  totalItensComanda,
  totalPendenteComanda,
  type CaixaResposta,
  type ComandaOperacao,
  type ProdutoOperacao,
  type LinhaCarrinho,
  type SaldoEstoque,
} from '../../lib/operacao';

function fingerprintItensLancamento(itens: LinhaCarrinho[]): string {
  return JSON.stringify(itens.map((linha) => ({
    produtoId: linha.produto.id,
    quantidade: linha.quantidade,
    tapId: linha.tapId ?? null,
    volumeMl: linha.volumeMl ?? null,
    paraViagem: linha.paraViagem ?? false,
    observacao: linha.observacao ?? null,
    opcionais: (linha.opcionais ?? []).map(({ opcionalId, quantidade }) => ({ opcionalId, quantidade })),
  })));
}

export function OperacaoComandaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cervejaria, podeDarDescontoOperacao, canPermission } = useAuth();
  const { contexto, isResolved: contextoResolvido, isError: contextoErro } = useOperacaoContexto();
  const { getPendente, marcarAtendido } = useAtendimentoBalcao();
  const atendimentoPendente = id ? getPendente(id) : null;
  const avisoWhatsAppStorageKey = `quiver:aviso-whatsapp:comanda:${id}`;
  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [visaoItens, setVisaoItens] = useState<'RESUMO' | 'PEDIDOS'>('PEDIDOS');
  const [closedComanda, setClosedComanda] = useState<ComandaOperacao | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [descontoInput, setDescontoInput] = useState('');
  const [erro, setErro] = useState('');
  const [itensAdicionadosMessage, setItensAdicionadosMessage] = useState('');
  const [itemParaCancelar, setItemParaCancelar] = useState<{ id: string; nome: string; quantidade: number; precoUnit: number; entregue: boolean; controlaEstoque: boolean; idempotencyKey: string } | null>(null);
  const [pedidoWhatsAppAbertoId, setPedidoWhatsAppAbertoId] = useState<string | null>(() =>
    window.sessionStorage.getItem(avisoWhatsAppStorageKey),
  );
  const removalRequests = useRef(new Set<string>());
  const launchRequestKeys = useRef(new Map<string, string>());
  const poll30 = usePollInterval(30_000);
  const poll15 = usePollInterval(15_000);

  useEffect(() => {
    if (!itensAdicionadosMessage) return;
    const timeoutId = window.setTimeout(() => setItensAdicionadosMessage(''), 5_000);
    return () => window.clearTimeout(timeoutId);
  }, [itensAdicionadosMessage]);

  const { data: comanda, isLoading } = useQuery({
    queryKey: ['operacao-comanda', id],
    queryFn: () => api.get<ComandaOperacao>(`/api/operacao/comandas/${id}`),
  });

  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', comanda?.pontoVendaId],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${comanda!.pontoVendaId}`),
    enabled: Boolean(comanda?.pontoVendaId),
    refetchInterval: poll30,
  });
  const caixaData = caixaQuery.data;
  const { data: produtos } = useQuery({
    queryKey: ['operacao-produtos-operacionais', comanda?.pontoVendaId, caixaData?.sessao?.id],
    queryFn: () =>
      api.get<ProdutoOperacao[]>(produtosOperacionaisUrl(comanda!.pontoVendaId)),
    enabled: Boolean(comanda?.pontoVendaId && caixaData?.sessao?.id),
  });


  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const podeReceber = canPermission('payment.receive');
  const podeOperarComanda = canPermission('command.operate');
  const podeCancelarComanda = canPermission('command.cancel');
  const podeCancelarItem = canPermission('command.item.cancel');
  const podeCancelarItemEntregue = podeCancelarItem && canPermission('command.item.cancel.delivered');
  const podeFecharComanda = canPermission('command.close');

  const { data: estoqueData } = useQuery({
    queryKey: ['operacao-estoque', comanda?.pontoVendaId],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/operacao/estoque?pontoVendaId=${comanda!.pontoVendaId}`),
    enabled: Boolean(comanda?.pontoVendaId) && controlaEstoque && (showAddItem || comanda?.status === 'ABERTA'),
    refetchInterval: showAddItem ? poll15 : false,
  });

  const saldos = useMemo(
    () => (estoqueData ? mapSaldosEstoque(estoqueData) : undefined),
    [estoqueData],
  );

  const produtoPorId = useMemo(
    () => new Map((produtos ?? []).map((produto) => [produto.id, produto])),
    [produtos],
  );

  const resumoItens = useMemo(
    () => (comanda && contextoResolvido && !contextoErro
      ? resumirItensComanda(comanda, contexto.kitchenItemsChargeAtLaunch)
      : []),
    [comanda, contexto.kitchenItemsChargeAtLaunch, contextoResolvido, contextoErro],
  );
  const resumoConfiguracaoCarregada = contextoResolvido && !contextoErro;

  const enviarResumoContaWhatsApp = () => {
    if (!comanda?.cliente?.telefone || !resumoConfiguracaoCarregada) return;
    const url = linkWhatsAppResumoConta({
      telefone: comanda.cliente.telefone,
      clienteNome: comanda.cliente.nome,
      nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
      identificacaoComanda: rotuloComanda(comanda),
      itens: resumoItens.map((item) => ({
        nome: item.nome,
        quantidade: item.quantidade,
        total: formatCurrency(item.total),
      })),
      subtotal: formatCurrency(comanda.subtotal),
      desconto: comanda.desconto > 0 ? formatCurrency(comanda.desconto) : null,
      total: formatCurrency(comanda.total),
      valorEmPreparo: comanda.valorEmAberto > 0 ? formatCurrency(comanda.valorEmAberto) : null,
    });
    if (url) navegarParaWhatsApp(url);
  };

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

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['operacao-comanda', id] });
    queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
  };

  const resolverSolicitacao = useMutation({
    mutationFn: () => api.delete(`/api/operacao/comandas/${id}/solicitacao-pagamento`, {}),
    onSuccess: invalidar,
  });

  useEffect(() => {
    if (!cervejaria) return;

    connectSocket(cervejaria.id);
    const socket = getSocket();

    const onComandaAtualizada = (payload: { comandaId?: string }) => {
      if (payload?.comandaId === id) invalidar();
    };
    const onPedidoAtualizado = (payload: { comanda?: { id?: string } }) => {
      if (payload?.comanda?.id === id) invalidar();
    };
    const onSocketConnected = () => invalidar();

    const onAtendimento = (payload: { comandaId?: string }) => {
      if (payload?.comandaId === id) invalidar();
    };

    socket.on('operacao:comanda-atualizada', onComandaAtualizada);
    socket.on('operacao:pedido-atualizado', onPedidoAtualizado);
    socket.on('operacao:atendimento-pedido', onAtendimento);
    socket.on('connect', onSocketConnected);

    return () => {
      socket.off('operacao:comanda-atualizada', onComandaAtualizada);
      socket.off('operacao:pedido-atualizado', onPedidoAtualizado);
      socket.off('operacao:atendimento-pedido', onAtendimento);
      socket.off('connect', onSocketConnected);
    };
  }, [cervejaria?.id, id, queryClient]);

  useEffect(() => {
    if (!showPayment || !comanda) return;
    const total = Math.max(0, comanda.subtotal - parseCurrencyInput(descontoInput));
    setPaymentForm((prev) => {
      if (total <= 0.01) return prev.length === 0 ? prev : [];
      if (prev.length === 0) return createDefaultPaymentForm(total);
      if (prev.length !== 1) return prev;
      const atual = parseCurrencyInput(prev[0].valor);
      if (Math.abs(atual - total) < 0.01) return prev;
      return [{ ...prev[0], valor: formatCurrencyInputFromNumber(total) }];
    });
  }, [descontoInput, showPayment, comanda?.subtotal]);

  const adicionar = (produto: ProdutoOperacao, configuracao?: { quantidade?: number; tapId?: string; volumeMl?: number; precoUnit?: number; paraViagem?: boolean; observacao?: string; opcionais?: LinhaCarrinho['opcionais'] }) => {
    setCarrinho((atual) => {
      const existente = atual.find((linha) => linha.produto.id === produto.id && linha.tapId === configuracao?.tapId && linha.volumeMl === configuracao?.volumeMl && linha.paraViagem === configuracao?.paraViagem && linha.observacao === configuracao?.observacao && JSON.stringify(linha.opcionais ?? []) === JSON.stringify(configuracao?.opcionais ?? []));
      const quantidadeAtual = existente?.quantidade ?? 0;
      const litrosJaNoCarrinho = atual.filter((linha) => linha.produto.id === produto.id && isChopeOperacao(linha.produto)).reduce((total, linha) => total + ((linha.volumeMl ?? 0) * linha.quantidade) / 1000, 0);
      const consumoChope = isChopeOperacao(produto) && configuracao?.volumeMl
        ? { volumeMl: configuracao.volumeMl, quantidadeAdicionar: configuracao.quantidade ?? 1, litrosJaNoCarrinho }
        : undefined;
      if (!podeIncrementarLinhaCarrinho(produto, quantidadeAtual, saldos, controlaEstoque, consumoChope)) {
        return atual;
      }
      if (!existente) return [...atual, { produto, quantidade: configuracao?.quantidade ?? 1, tapId: configuracao?.tapId, volumeMl: configuracao?.volumeMl, precoUnit: configuracao?.precoUnit, paraViagem: configuracao?.paraViagem, observacao: configuracao?.observacao, opcionais: configuracao?.opcionais }];
      return atual.map((linha) =>
        linha.produto.id === produto.id && linha.tapId === configuracao?.tapId && linha.volumeMl === configuracao?.volumeMl && linha.paraViagem === configuracao?.paraViagem && linha.observacao === configuracao?.observacao && JSON.stringify(linha.opcionais ?? []) === JSON.stringify(configuracao?.opcionais ?? []) ? { ...linha, quantidade: linha.quantidade + (configuracao?.quantidade ?? 1) } : linha,
      );
    });
  };

  const alterarQuantidade = (produtoId: string, delta: number, tapId?: string, volumeMl?: number) => {
    setCarrinho((atual) =>
      atual
        .map((linha) => {
          if (linha.produto.id !== produtoId || linha.tapId !== tapId || linha.volumeMl !== volumeMl) return linha;
          const novaQuantidade = linha.quantidade + delta;
          if (
            delta > 0 &&
            !podeIncrementarLinhaCarrinho(
              linha.produto,
              linha.quantidade,
              saldos,
              controlaEstoque,
              isChopeOperacao(linha.produto) && volumeMl
                ? { volumeMl, litrosJaNoCarrinho: atual.filter((item) => item.produto.id === produtoId && isChopeOperacao(item.produto)).reduce((total, item) => total + ((item.volumeMl ?? 0) * item.quantidade) / 1000, 0) }
                : undefined,
            )
          ) {
            return linha;
          }
          return { ...linha, quantidade: novaQuantidade };
        })
        .filter((linha) => linha.quantidade > 0),
    );
  };

  const lancarItens = useMutation({
    mutationFn: ({ itens, idempotencyKey }: { itens: LinhaCarrinho[]; idempotencyKey: string; limparCarrinho: boolean }) =>
      api.post<ComandaOperacao>(`/api/operacao/comandas/${id}/pedidos`, {
        idempotencyKey,
        itens: itens.map((linha) => ({
          produtoId: linha.produto.id,
          quantidade: linha.quantidade,
          tapId: linha.tapId,
          volumeMl: linha.volumeMl,
          paraViagem: linha.paraViagem ?? false,
          observacao: linha.observacao,
          opcionais: linha.opcionais?.map(({ opcionalId, quantidade }) => ({ opcionalId, quantidade })),
        })),
      }),
    onSuccess: (_resultado, variaveis) => {
      const fingerprint = fingerprintItensLancamento(variaveis.itens);
      launchRequestKeys.current.delete(fingerprint);
      window.sessionStorage.removeItem(`quiver:comanda-launch:${id}:${fingerprint}`);
      invalidar();
      if (comanda?.pontoVendaId) {
        queryClient.invalidateQueries({ queryKey: ['operacao-estoque', comanda.pontoVendaId] });
      }
      if (variaveis.limparCarrinho) setCarrinho([]);
      setErro('');
      setItensAdicionadosMessage('Itens lançados. Selecione os próximos itens.');
    },
    onError: (err, variaveis) => {
      if (err instanceof ApiError && err.status < 500) {
        const fingerprint = fingerprintItensLancamento(variaveis.itens);
        launchRequestKeys.current.delete(fingerprint);
        window.sessionStorage.removeItem(`quiver:comanda-launch:${id}:${fingerprint}`);
      }
      setItensAdicionadosMessage('');
      if (comanda?.pontoVendaId) {
        queryClient.invalidateQueries({ queryKey: ['operacao-estoque', comanda.pontoVendaId] });
      }
      setErro(err instanceof ApiError ? err.message : 'Não foi possível lançar os itens');
    },
  });

  const lancarItensComChave = (itens: LinhaCarrinho[], limparCarrinho = false) => {
    const fingerprint = fingerprintItensLancamento(itens);
    const storageKey = `quiver:comanda-launch:${id}:${fingerprint}`;
    const idempotencyKey = launchRequestKeys.current.get(fingerprint) ?? window.sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    launchRequestKeys.current.set(fingerprint, idempotencyKey);
    window.sessionStorage.setItem(storageKey, idempotencyKey);
    lancarItens.mutate({ itens, idempotencyKey, limparCarrinho });
  };

  const fecharAdicionarItens = () => {
    if (lancarItens.isPending) return;
    setCarrinho([]);
    setShowAddItem(false);
    setErro('');
    setItensAdicionadosMessage('');
  };

  const invalidarEstoque = () => {
    if (comanda?.pontoVendaId) {
      queryClient.invalidateQueries({ queryKey: ['operacao-estoque', comanda.pontoVendaId] });
    }
  };

  const marcarClienteAvisado = useMutation({
    mutationFn: (pedidoId: string) =>
      api.patch<{ clienteAvisadoEm: string }>(
        `/api/operacao/comandas/${id}/pedidos/${pedidoId}/cliente-avisado`,
        {},
      ),
    onSuccess: () => {
      window.sessionStorage.removeItem(avisoWhatsAppStorageKey);
      setPedidoWhatsAppAbertoId(null);
      invalidar();
    },
    onError: (cause) => setErro(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar o aviso.'),
  });

  const removerItem = useMutation({
    mutationFn: (params: { itemId: string; quantidade?: number; delivered?: { motivo: string; tratamentoEstoque: 'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO'; quantidadeEsperada: number; idempotencyKey: string } }) =>
      api.delete<ComandaOperacao>(`/api/operacao/comandas/${id}/itens/${params.itemId}`, params.delivered
        ? { quantidade: params.quantidade, ...params.delivered }
        : params.quantidade ? { quantidade: params.quantidade } : undefined),
    onSuccess: (atualizada) => {
      queryClient.setQueryData(['operacao-comanda', id], atualizada);
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      invalidarEstoque();
      setItemParaCancelar(null);
      setErro('');
    },
    onError: (err) => {
      invalidarEstoque();
      setErro(err instanceof ApiError ? err.message : 'Não foi possível remover o item');
    },
  });

  const enviarRemocaoItem = (params: { itemId: string; quantidade?: number; delivered?: { motivo: string; tratamentoEstoque: 'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO'; quantidadeEsperada: number; idempotencyKey: string } }) => {
    if (removalRequests.current.has(params.itemId)) return;
    removalRequests.current.add(params.itemId);
    removerItem.mutate(params, {
      onSettled: (_data, error) => {
        if (error) {
          removalRequests.current.delete(params.itemId);
          return;
        }
        window.setTimeout(() => removalRequests.current.delete(params.itemId), 400);
      },
    });
  };

  const alterarQuantidadeItem = useMutation({
    mutationFn: ({ itemId, quantidade }: { itemId: string; quantidade: number }) =>
      api.patch<ComandaOperacao>(`/api/operacao/comandas/${id}/itens/${itemId}`, { quantidade }),
    onSuccess: (atualizada) => {
      queryClient.setQueryData(['operacao-comanda', id], atualizada);
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      invalidarEstoque();
      setErro('');
    },
    onError: (err) => {
      invalidarEstoque();
      setErro(err instanceof ApiError ? err.message : 'Não foi possível alterar o item');
    },
  });

  const itemEmEdicao = removerItem.isPending || alterarQuantidadeItem.isPending;

  const fechar = useMutation({
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
        await api.patch<ComandaOperacao>(`/api/operacao/comandas/${id}/desconto`, { desconto });
      }
      return api.post<ComandaOperacao>(`/api/operacao/comandas/${id}/pagamentos`, { pagamentos, deixarPendente });
    },
    onSuccess: (data) => {
      setShowPayment(false);
      setClosedComanda(data);
      setShowReceipt(true);
      invalidar();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível fechar a comanda'),
  });

  const cancelar = useMutation({
    mutationFn: () => api.post<ComandaOperacao>(`/api/operacao/comandas/${id}/cancelar`),
    onSuccess: () => {
      invalidar();
      navigate('/operacao/comandas');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível encerrar a comanda'),
  });

  const abrirNova = useMutation({
    mutationFn: () => {
      if (!comanda || comanda.tipo === 'AVULSA') throw new Error('Comanda inválida');
      return api.post<ComandaOperacao>('/api/operacao/comandas', {
        pontoVendaId: comanda.pontoVendaId,
        tipo: comanda.tipo,
        identificador: comanda.identificador,
        itens: [],
      });
    },
    onSuccess: (nova) => {
      invalidar();
      navigate(`/operacao/comandas/${nova.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/operacao/comandas/${err.body.comandaId}`);
        return;
      }
      setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir nova comanda');
    },
  });

  const openPayment = () => {
    if (!comanda) return;
    setDescontoInput(formatCurrencyInputFromNumber(comanda.desconto ?? 0));
    const total = comanda.total;
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
    setErro('');
  };

  const handleClose = (deixarPendente = false) => {
    if (!comanda) return;
    const desconto = parseCurrencyInput(descontoInput);
    const podeAplicarDesconto = canPermission('discount.apply') && podeDarDescontoOperacao;
    if (podeAplicarDesconto && desconto > comanda.subtotal) {
      setErro('O desconto não pode ser maior que o subtotal da comanda');
      return;
    }
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    fechar.mutate({
      pagamentos: deixarPendente ? [] : pagamentos,
      desconto,
      descontoAnterior: comanda.desconto ?? 0,
      aplicarDesconto: podeAplicarDesconto,
      deixarPendente,
    });
  };

  if (isLoading) return <Loading />;
  if (!comanda) return <p className="text-ink-faint text-center py-10">Comanda não encontrada.</p>;

  const aberta = comanda.status === 'ABERTA';
  const cancelada = comanda.status === 'CANCELADA';
  const temItens = totalItensComanda(comanda) > 0;
  const cozinhaPendente = temPedidoCozinhaPendente(comanda);
  const configuracaoFechamentoCarregada = contextoResolvido && !contextoErro;
  const permitirFecharComCozinhaPendente =
    configuracaoFechamentoCarregada &&
    contexto.allowCloseComandaWithPendingKitchenOrders &&
    contexto.kitchenItemsChargeAtLaunch;
  const podeFechar = aberta && temItens && (!cozinhaPendente || permitirFecharComCozinhaPendente);
  const hasActionBar = aberta || !aberta;
  const podeAplicarDesconto = canPermission('discount.apply') && podeDarDescontoOperacao;
  const descontoValor = parseCurrencyInput(descontoInput);
  const totalComDesconto = Math.max(0, comanda.subtotal - descontoValor);
  const totalAPagar = Math.max(0, totalComDesconto);
  const totalParcialComanda = comanda.total;
  const totalPendente = totalPendenteComanda(comanda, contexto.kitchenItemsChargeAtLaunch);
  const clienteElegivelParaPendente = Boolean(
    comanda.cliente?.id && comanda.cliente.telefone && digitsOnly(comanda.cliente.telefone).length >= 10,
  );

  const paymentHeaderExtra = (
    <div className="space-y-3">
      {erro && showPayment && <div className="alert-error text-sm">{erro}</div>}
      {podeAplicarDesconto && (
        <PaymentDiscountFields
          inputId="desconto-fechar"
          subtotal={comanda.subtotal}
          discountValue={descontoValor}
          discountInput={descontoInput}
          onDiscountChange={setDescontoInput}
          total={totalComDesconto}
          disabled={fechar.isPending}
        />
      )}
      {!clienteElegivelParaPendente && (
        <p className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">
          Para deixar esta conta pendente, associe antes um cliente cadastrado com telefone válido.
        </p>
      )}
    </div>
  );

  return (
    <div className={`space-y-4 ${hasActionBar ? 'page-with-action-bar' : 'pb-2'}`}>
      {caixaQuery.isError && <div role="alert" className="alert-error">Nao foi possivel consultar o caixa. A tela nao pode confirmar se ha um turno ativo.</div>}
      <div className="card">
        <div className="flex items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Enviar número sequencial da comanda pelo WhatsApp"
              title={comanda.cliente?.telefone ? 'Enviar número da comanda pelo WhatsApp' : 'Cadastre um telefone para o cliente'}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!comanda.cliente?.telefone || comanda.numero == null}
              onClick={enviarNumeroComandaWhatsApp}
            >
              <IconWhatsApp className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate leading-tight">{rotuloComanda(comanda)}</h2>
              {comanda.cliente?.telefone && <p className="text-sm text-ink-faint mt-1">{formatPhone(comanda.cliente.telefone)}</p>}
            </div>
          </div>
          <p className="ml-auto text-2xl sm:text-3xl font-bold text-brand-600 tabular-nums whitespace-nowrap">{formatCurrency(totalParcialComanda)}</p>
        </div>
        {aberta && atendimentoPendente && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sky-950">
            <div className="min-w-0">
              <strong>Servir pedido do portal</strong>
              <p className="mt-1 text-sm">{resumoItensBalcao(atendimentoPendente.itens)}</p>
            </div>
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm"
              onClick={() => marcarAtendido(id)}
            >
              Atendido
            </button>
          </div>
        )}
        {aberta && comanda.solicitacaoPagamentoEm && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"><strong>Cliente solicitou atendimento para pagamento</strong><button type="button" className="touch-btn-secondary touch-btn-sm" disabled={resolverSolicitacao.isPending} onClick={() => resolverSolicitacao.mutate()}>{resolverSolicitacao.isPending ? 'Resolvendo...' : 'Resolver solicitação'}</button></div>}
        {totalPendente > 0 && <p className="mt-1 text-right text-sm font-semibold text-amber-400">Pendente na cozinha: {formatCurrency(totalPendente)}</p>}
        {!aberta && comanda.desconto > 0 && (
          <div className="mt-3 space-y-1 text-sm border-t border-line pt-3">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrency(comanda.subtotal)}</span>
            </div>
            <div className="flex justify-between text-ink-muted">
              <span>Desconto</span>
              <span className="tabular-nums text-red-600">− {formatCurrency(comanda.desconto)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(comanda.total)}</span>
            </div>
          </div>
        )}
      </div>

      {erro && !showAddItem && !showPayment && <div className="alert-error">{erro}</div>}
      <div className="space-y-2">
        <h3 className="section-label">Consumo da comanda</h3>
        {aberta && podeOperarComanda && (
          <button
            type="button"
            className="touch-btn-primary w-full"
            onClick={() => {
              setErro('');
              setItensAdicionadosMessage('');
              setShowAddItem(true);
            }}
          >
            + Itens
          </button>
        )}

        <nav className="segmented-control" aria-label="Visualização dos itens da comanda">
          <button
            type="button"
            className={`segmented-control-btn ${visaoItens === 'PEDIDOS' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
            aria-pressed={visaoItens === 'PEDIDOS'}
            onClick={() => setVisaoItens('PEDIDOS')}
          >
            Pedidos ({comanda.pedidos.length})
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
            title={comanda.cliente?.telefone ? 'Enviar resumo da conta pelo WhatsApp' : 'Cadastre um telefone para o cliente'}
            className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!comanda.cliente?.telefone || !resumoConfiguracaoCarregada}
            onClick={enviarResumoContaWhatsApp}
          >
            <IconWhatsApp className="h-6 w-6" />
          </button>
        </nav>

        {!resumoConfiguracaoCarregada && visaoItens === 'RESUMO' ? (
          <p role="status" className="rounded-xl border border-line bg-surface p-4 text-center text-sm text-ink-muted">
            {contextoErro
              ? 'Não foi possível carregar a regra de cobrança da cozinha. O resumo está oculto até a configuração ser validada.'
              : 'Carregando a regra de cobrança da cozinha…'}
          </p>
        ) : visaoItens === 'PEDIDOS' ? (
          <>
        {ordenarPedidosPorSenhaDecrescente(comanda.pedidos).filter(pedidoVisivelNaComanda).map((pedido) => {
          const confirmado = pedidoConfirmadoNaComanda(pedido);
          const naCozinha = pedidoVaiParaCozinha(pedido.itens) && pedido.status !== 'CANCELADO';
          const podeAvisarCliente =
            contexto.whatsappPedidoProntoEnabled &&
            !contexto.whatsappPedidoProntoNaCozinha &&
            pedido.status === 'PRONTO' &&
            pedido.itens.some((item) => item.exigePreparo && !item.cancelamentoPendenteEm && !item.canceladoEm) &&
            !pedido.clienteAvisadoEm;
          const abrirWhatsAppPedidoPronto = () => {
            const cliente = comanda.cliente;
            if (!cliente?.telefone) return;
            const url = linkWhatsAppPedidoPronto({
              telefone: cliente.telefone,
              clienteNome: cliente.nome,
              numeroPedido: pedido.numero,
              nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
            });
            if (!url) return;
            window.sessionStorage.setItem(avisoWhatsAppStorageKey, pedido.id);
            setPedidoWhatsAppAbertoId(pedido.id);
            navegarParaWhatsApp(url);
          };
          return (
          <section key={pedido.id} className="card divide-y divide-line px-3 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Senha {pedido.numero}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                {naCozinha && (
                  <span
                    className={`text-xs font-semibold ${
                      confirmado ? 'text-green-600' : 'text-amber-600'
                    }`}
                  >
                    {rotuloStatusPedido(pedido.status)}
                  </span>
                )}
              </div>
            </div>
            {pedido.observacao && <p className="border-t border-line py-1.5 text-xs text-ink-muted">Obs: {pedido.observacao}</p>}
            {pedido.itens.map((item) => {
              const itemEmCancelamento = Boolean(item.cancelamentoPendenteEm || item.canceladoEm);
              const quantidadeEditavel = aberta && !itemEmCancelamento && podeAlterarQuantidadeItemComanda(comanda, pedido, item);
              const entregue = pedido.status === 'ENTREGUE' || (Boolean(item.tapId) && !item.exigePreparo && pedido.status !== 'CANCELADO' && pedido.status !== 'CANCELAMENTO_PENDENTE');
              const removivel = aberta && !itemEmCancelamento && (entregue
                ? podeCancelarItemEntregue
                : podeCancelarItem && podeRemoverItemComanda(comanda, pedido, item));
              const itemConfirmado = itemConfirmadoNaComanda(pedido, item);
              const produto = produtoPorId.get(item.produtoId);
              const podeIncrementar = podeIncrementarItemComanda(produto, saldos, controlaEstoque, item.volumeMl);
              const alterandoEsteItem =
                (removerItem.isPending && removerItem.variables?.itemId === item.id) ||
                (alterarQuantidadeItem.isPending && alterarQuantidadeItem.variables?.itemId === item.id);

              return (
              <div key={item.id} data-comanda-item-id={item.id} className="py-2 first:pt-2 last:pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  {quantidadeEditavel ? (
                    <div className="flex shrink-0 items-center rounded-lg border border-line bg-surface shadow-sm">
                      <button
                        type="button"
                        aria-label={`Remover um ${item.nome}`}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-base font-bold text-ink-muted active:bg-surface-lighter disabled:opacity-40"
                        disabled={itemEmEdicao || !podeCancelarItem}
                        onClick={() => {
                          if (item.quantidade <= 1) enviarRemocaoItem({ itemId: item.id });
                          else alterarQuantidadeItem.mutate({ itemId: item.id, quantidade: item.quantidade - 1 });
                        }}
                      >−</button>
                      <span className="min-w-6 text-center text-sm font-bold tabular-nums">{item.quantidade}</span>
                      <button
                        type="button"
                        aria-label={`Adicionar um ${item.nome}`}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-base font-bold text-ink active:bg-surface-lighter disabled:opacity-40"
                        disabled={itemEmEdicao || !podeIncrementar}
                        onClick={() => alterarQuantidadeItem.mutate({ itemId: item.id, quantidade: item.quantidade + 1 })}
                      >+</button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold text-ink-muted">{item.quantidade} ×</span>
                  )}
                  <div className={`min-w-0 flex-1 text-sm font-semibold ${itemConfirmado ? '' : 'text-ink-faint'}`}>
                    <span className="break-words">{item.nome}</span>
                    {item.cancelamentoPendenteEm && <small className="ml-2 rounded-full border border-orange-500/50 bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-400">Cancelamento solicitado</small>}
                    {item.canceladoEm && <small className="ml-2 rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] font-bold text-ink-faint">Cancelado</small>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!item.canceladoEm && (
                      <span className={`max-w-[7.5rem] text-right text-xs font-semibold tabular-nums sm:max-w-none sm:text-sm ${itemConfirmado ? '' : 'text-ink-faint'}`}>
                        {item.cancelamentoPendenteEm
                          ? `Cancelamento pendente · ${formatCurrency(item.subtotal)}`
                          : itemConfirmado
                            ? formatCurrency(item.subtotal)
                            : `Pendente · ${formatCurrency(item.subtotal)}`}
                      </span>
                    )}
                    {removivel && (
                      <button
                        type="button"
                        aria-label={`Remover ${item.nome}`}
                        onClick={() => {
                          if (entregue) {
                            removerItem.reset();
                            setErro('');
                            setItemParaCancelar({
                              id: item.id,
                              nome: item.nome,
                              quantidade: item.quantidade,
                              precoUnit: item.precoUnit,
                              entregue: true,
                              controlaEstoque: Boolean(controlaEstoque && produto?.controlaEstoque),
                              idempotencyKey: crypto.randomUUID(),
                            });
                          } else if (item.quantidade > 1) {
                            removerItem.reset();
                            setErro('');
                            setItemParaCancelar({ id: item.id, nome: item.nome, quantidade: item.quantidade, precoUnit: item.precoUnit, entregue: false, controlaEstoque: false, idempotencyKey: '' });
                          } else enviarRemocaoItem({ itemId: item.id });
                        }}
                        disabled={itemEmEdicao}
                        className="icon-btn-danger"
                      ><IconTrash /></button>
                    )}
                  </div>
                </div>
                {(item.opcionais?.length || item.observacao || item.paraViagem) ? (
                  <div className="pl-12 pt-1 text-xs leading-snug text-ink-muted">
                    {item.opcionais?.length ? <div>Opcionais: {item.opcionais.map((o) => o.nome).join(', ')}</div> : null}
                    {item.observacao ? <div>Obs: {item.observacao}</div> : null}
                    {item.paraViagem ? <div>Para viagem</div> : null}
                  </div>
                ) : null}
                {item.cancelamentosEntregue?.map((cancelamento) => (
                  <div key={cancelamento.id} className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-ink-muted">
                    Cancelamento de {cancelamento.quantidade} un. · {formatCurrency(cancelamento.valorRetirado)} retirados · {cancelamento.motivo}
                  </div>
                ))}

                {alterandoEsteItem && (
                  <span className="sr-only">Atualizando item</span>
                )}
              </div>
            );
            })}
            {podeAvisarCliente && comanda.cliente?.telefone && (
              <div className="flex justify-end border-t border-line pt-2">
                {pedidoWhatsAppAbertoId === pedido.id ? (
                  <button
                    type="button"
                    className="touch-btn-orange touch-btn-sm"
                    disabled={marcarClienteAvisado.isPending}
                    onClick={() => marcarClienteAvisado.mutate(pedido.id)}
                  >
                    {marcarClienteAvisado.isPending && marcarClienteAvisado.variables === pedido.id
                      ? 'Salvando...'
                      : 'Marcar como avisado'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                    onClick={abrirWhatsAppPedidoPronto}
                  >
                    <IconWhatsApp className="h-5 w-5" /> Pedido pronto
                  </button>
                )}
              </div>
            )}
          </section>
        );
        })}
          </>
        ) : (
          <section className="card space-y-3">
            {resumoItens.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">Ainda não há itens válidos para resumir.</p>
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
                  <div className="flex justify-between text-sm text-ink-muted">
                    <span>Subtotal dos itens</span>
                    <span className="tabular-nums">{formatCurrency(comanda.subtotal)}</span>
                  </div>
                  {comanda.desconto > 0 && (
                    <div className="flex justify-between text-sm text-ink-muted">
                      <span>Desconto</span><span className="tabular-nums">− {formatCurrency(comanda.desconto)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
                    <span>Total da conta</span>
                    <span className="tabular-nums text-brand-600">{formatCurrency(comanda.total)}</span>
                  </div>
                  {comanda.valorEmAberto > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-amber-500">
                      <span>Valor em aberto</span>
                      <span className="tabular-nums">{formatCurrency(comanda.valorEmAberto)}</span>
                    </div>
                  )}
                </div>
              </>
            )}
            <p className="text-xs text-ink-faint">Itens cancelados ou com cancelamento pendente não entram neste resumo.</p>
          </section>
        )}

        {aberta && temItens && cozinhaPendente && !configuracaoFechamentoCarregada && (
          <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {contextoErro ? 'Não foi possível confirmar a configuração de fechamento. Atualize a tela para tentar novamente.' : 'Carregando a regra de fechamento da cozinha…'}
          </p>
        )}
        {aberta && temItens && cozinhaPendente && configuracaoFechamentoCarregada && !permitirFecharComCozinhaPendente && (
          <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            Aguarde a entrega dos itens da cozinha antes de fechar a comanda.
          </p>
        )}
        {aberta && temItens && cozinhaPendente && permitirFecharComCozinhaPendente && (
          <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            Há pedido ainda não entregue na cozinha. O fechamento e o pagamento estão liberados pela configuração.
          </p>
        )}

        {aberta && !temItens && (
          <p className="text-sm text-ink-faint text-center py-2">
            Nenhum item ainda. Adicione itens para registrar consumo.
          </p>
        )}
      </div>

      {!aberta && (
        <div className="rounded-xl bg-surface-lighter border border-line px-4 py-3 text-sm text-ink-muted leading-relaxed">
          {cancelada ? (
            <>Comanda cancelada — encerrada sem consumação.</>
          ) : comanda.pagamentos.length > 0 ? (
            <>
              Pagamento confirmado — comanda registrada, sem edição.
              Para novos pedidos, use <span className="font-semibold text-ink-soft">Nova comanda</span> abaixo.
            </>
          ) : comanda.contaPendente ? (
            <>Conta pendente registrada para {comanda.cliente?.nome}.</>
          ) : comanda.desconto >= comanda.subtotal && comanda.subtotal > 0 ? (
            <>Cortesia confirmada — comanda encerrada sem pagamento.</>
          ) : (
            <>Comanda fechada — somente leitura.</>
          )}
        </div>
      )}

      {!aberta && comanda.pagamentos.length > 0 && (
        <div className="card space-y-2">
          <h3 className="text-sm font-medium text-ink-muted">Pagamentos confirmados</h3>
          {comanda.pagamentos.map((pagamento) => (
            <div key={pagamento.id} className="flex justify-between">
              <span>{PAYMENT_LABELS[pagamento.forma]}</span>
              <span className="font-bold tabular-nums">{formatCurrency(pagamento.valor)}</span>
            </div>
          ))}
        </div>
      )}

      {comanda.contaPendente && (
        <div className="card space-y-2 border-orange/30">
          <h3 className="text-sm font-semibold text-orange-dark">Conta pendente</h3>
          <div className="flex justify-between text-sm"><span>Recebido</span><strong>{formatCurrency(comanda.contaPendente.recebido)}</strong></div>
          <div className="flex justify-between text-sm"><span>Saldo</span><strong>{formatCurrency(comanda.contaPendente.saldo)}</strong></div>
        </div>
      )}

      {podeFechar && (
        <MobileActionBar className="sm:grid sm:grid-cols-2 sm:items-stretch sm:gap-2 sm:space-y-0">
          <button type="button" className="touch-btn-orange w-full sm:h-12" onClick={openPayment} disabled={!podeFecharComanda || !podeReceber || (cozinhaPendente && !configuracaoFechamentoCarregada)} data-audit="operacao-comanda-fechar">
            Fechar Comanda · {formatCurrency(totalParcialComanda)}
          </button>
          <button type="button" className="touch-btn-orange w-full sm:h-12" onClick={() => navigate('/operacao/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {aberta && temItens && cozinhaPendente && !permitirFecharComCozinhaPendente && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" disabled>
            Aguardando entrega da cozinha
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/operacao/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {aberta && !temItens && (
        <MobileActionBar>
          <p className="text-xs text-center text-ink-faint px-2">
            Sem consumação — use Encerrar comanda para cancelar.
          </p>
          {podeCancelarComanda && (
            <button
              type="button"
              className="touch-btn-orange w-full"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
              data-audit="operacao-comanda-cancelar"
            >
              {cancelar.isPending ? 'Encerrando...' : 'Encerrar comanda'}
            </button>
          )}
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/operacao/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {!aberta && comanda.tipo !== 'AVULSA' && (
        <MobileActionBar>
          <button
            type="button"
            className="touch-btn-primary w-full"
            onClick={() => abrirNova.mutate()}
            disabled={abrirNova.isPending || !caixaAberto || caixaQuery.isError}
          >
            {abrirNova.isPending
              ? 'Abrindo...'
              : caixaQuery.isError
                ? 'Nao foi possivel consultar o caixa'
                : !caixaAberto
                ? 'Caixa fechado — abra para nova comanda'
                : `Nova comanda · ${rotuloComanda(comanda)}`}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={() => navigate('/operacao/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      <AdicionarItensOperacaoModal
        open={showAddItem}
        onClose={fecharAdicionarItens}
        pontoVendaId={comanda?.pontoVendaId ?? ''}
        sessaoCaixaId={caixaData?.sessao?.id}
        tapsEnabled={contexto.tapsEnabled}
        produtos={produtos ?? []}
        linhas={carrinho}
        onSelecionar={adicionar}
        onAlterar={alterarQuantidade}
        onConfirm={() => lancarItensComChave(carrinho, true)}
        onLaunchTapItem={(produto, configuracao) => lancarItensComChave([{
          produto,
          quantidade: configuracao.quantidade ?? 1,
          tapId: configuracao.tapId,
          volumeMl: configuracao.volumeMl,
          precoUnit: configuracao.precoUnit,
        }])}
        totalComandaAtual={comanda?.subtotal ?? 0}
        isPending={lancarItens.isPending}
        error={showAddItem ? erro : undefined}
        successMessage={showAddItem ? itensAdicionadosMessage : undefined}
        saldos={saldos}
        controlaEstoque={controlaEstoque}
        confirmLabel="Lançar na comanda"
      />

      <PaymentFormModal
        open={showPayment && podeFecharComanda && podeReceber}
        onClose={() => {
          setShowPayment(false);
          setErro('');
        }}
        title="Fechar Comanda"
        totalLabel="Total a pagar"
        total={totalAPagar}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={() => handleClose()}
        isPending={fechar.isPending}
        headerExtra={paymentHeaderExtra}
        deferLabel="Deixar pendente"
        secondaryAction={comanda ? (
          <button
            type="button"
            className="touch-btn-secondary w-full min-h-14"
            disabled={fechar.isPending}
            onClick={() => navigate(`/operacao/comandas?pontoVendaId=${encodeURIComponent(comanda.pontoVendaId)}&selecionar=${encodeURIComponent(comanda.id)}`)}
          >
            Selecionar comandas
          </button>
        ) : undefined}
        deferDisabled={!clienteElegivelParaPendente || totalAPagar <= 0}
        deferConfirmation={(
          <div className="space-y-3 rounded-xl border border-orange/30 bg-surface-lighter p-4">
            <p className="font-semibold">A comanda será encerrada sem receber agora.</p>
            <p className="text-sm text-ink-muted">O valor de {formatCurrency(totalAPagar)} ficará vinculado a {comanda.cliente?.nome} pelo telefone {formatPhone(comanda.cliente?.telefone ?? '')} e não entrará nos recebimentos deste caixa.</p>
          </div>
        )}
        onConfirmDefer={() => handleClose(true)}
      />

      <Modal
        open={showReceipt}
        onClose={() => {
          setShowReceipt(false);
          navigate('/operacao/comandas');
        }}
        title="Comanda Fechada"
      >
        {closedComanda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">{rotuloComanda(closedComanda)}</p>
            <p className="text-3xl font-bold text-brand-600 tabular-nums">{formatCurrency(closedComanda.total)}</p>
            <div className="space-y-1">
              {closedComanda.contaPendente ? (
                <div className="space-y-1">
                  <p className="font-semibold text-orange-dark">Conta pendente registrada</p>
                  <p className="text-sm text-ink-muted">Cliente: {closedComanda.cliente?.nome} · saldo {formatCurrency(closedComanda.contaPendente.saldo)}</p>
                </div>
              ) : closedComanda.pagamentos.length === 0 ? (
                <p className="font-semibold text-success">Cortesia — sem pagamento</p>
              ) : (
                closedComanda.pagamentos.map((pagamento) => (
                  <p key={pagamento.id} className="text-ink-muted">
                    {PAYMENT_LABELS[pagamento.forma]}: {formatCurrency(pagamento.valor)}
                  </p>
                ))
              )}
            </div>
            <button
              className="touch-btn-primary w-full"
              onClick={() => {
                setShowReceipt(false);
                navigate('/operacao/comandas');
              }}
            >
              OK
            </button>
          </div>
        )}
      </Modal>
      {itemParaCancelar?.entregue ? <CancelarItemEntregueModal
        item={itemParaCancelar}
        disabled={removerItem.isPending}
        erro={removerItem.error instanceof ApiError ? removerItem.error.message : null}
        onClose={() => setItemParaCancelar(null)}
        onConfirmar={({ quantidade, motivo, tratamentoEstoque }) => {
          if (!itemParaCancelar) return;
          enviarRemocaoItem({ itemId: itemParaCancelar.id, quantidade, delivered: {
            motivo, tratamentoEstoque, quantidadeEsperada: itemParaCancelar.quantidade,
            idempotencyKey: itemParaCancelar.idempotencyKey,
          } });
        }}
      /> : <CancelarQuantidadeModal
        open={itemParaCancelar !== null}
        nomeItem={itemParaCancelar?.nome ?? ''}
        quantidadeDisponivel={itemParaCancelar?.quantidade ?? 0}
        disabled={removerItem.isPending}
        erro={removerItem.error instanceof ApiError ? removerItem.error.message : null}
        onClose={() => setItemParaCancelar(null)}
        onConfirmar={(quantidade) => {
          if (!itemParaCancelar) return;
          enviarRemocaoItem({ itemId: itemParaCancelar.id, quantidade });
        }}
      />}
    </div>
  );
}

function CancelarItemEntregueModal({ item, disabled, erro, onClose, onConfirmar }: {
  item: { id: string; nome: string; quantidade: number; precoUnit: number; controlaEstoque: boolean };
  disabled: boolean;
  erro: string | null;
  onClose: () => void;
  onConfirmar: (input: { quantidade: number; motivo: string; tratamentoEstoque: 'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO' }) => void;
}) {
  const [quantidade, setQuantidade] = useState(String(item.quantidade));
  const [motivo, setMotivo] = useState('');
  const [tratamentoEstoque, setTratamentoEstoque] = useState<'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO'>('PREPARADO_ENTREGUE_OU_PERDIDO');
  const quantidadeValida = /^\d+$/.test(quantidade) && Number(quantidade) >= 1 && Number(quantidade) <= item.quantidade;
  const valorRetirado = quantidadeValida ? Number(quantidade) * item.precoUnit : 0;

  return <Modal open onClose={disabled ? () => {} : onClose} title="Cancelar item já entregue" compact>
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-lighter p-3">
        <p className="text-sm font-semibold">{item.nome}</p>
        <label className="mt-3 block text-sm font-medium" htmlFor="cancel-delivered-quantity">Quantidade a cancelar</label>
        <input id="cancel-delivered-quantity" type="number" min={1} max={item.quantidade} step={1} value={quantidade}
          onChange={(event) => setQuantidade(event.target.value)} className="field mt-1 min-h-12 w-full" />
        <p className="mt-2 text-sm">Valor que sai da cobrança: <strong>{formatCurrency(valorRetirado)}</strong></p>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Tratamento do estoque</legend>
        <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input type="radio" name="tratamento-estoque-entregue" checked={tratamentoEstoque === 'ERRO_LANCAMENTO'} disabled={disabled}
            onChange={() => setTratamentoEstoque('ERRO_LANCAMENTO')} className="mt-1 h-5 w-5 shrink-0" />
          <span className="text-sm"><strong>Erro de lançamento.</strong> A quantidade não foi consumida. O sistema reverte somente uma baixa de estoque existente e compatível com este pedido.</span>
        </label>
        <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input type="radio" name="tratamento-estoque-entregue" checked={tratamentoEstoque === 'PREPARADO_ENTREGUE_OU_PERDIDO'} disabled={disabled}
            onChange={() => setTratamentoEstoque('PREPARADO_ENTREGUE_OU_PERDIDO')} className="mt-1 h-5 w-5 shrink-0" />
          <span className="text-sm"><strong>Preparado, entregue ou perdido.</strong> O item sai da cobrança e o estoque não retorna.</span>
        </label>
        {!item.controlaEstoque && <p className="text-xs text-ink-muted">Este produto não tem controle de estoque ativo; nenhum movimento será criado.</p>}
      </fieldset>
      <label className="block text-sm font-semibold" htmlFor="cancel-delivered-reason">Motivo obrigatório</label>
      <textarea id="cancel-delivered-reason" value={motivo} maxLength={500} rows={3} disabled={disabled}
        onChange={(event) => setMotivo(event.target.value)} placeholder="Descreva por que o item deve sair da cobrança"
        className="field min-h-24 w-full resize-y" />
      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
    </div>
    <div className="mt-4 flex gap-2">
      <button type="button" className="touch-btn-orange min-h-12 flex-1" disabled={disabled} onClick={onClose}>Voltar</button>
      <button type="button" className="touch-btn-primary min-h-12 flex-1" disabled={disabled || !quantidadeValida || motivo.trim().length < 3}
        onClick={() => onConfirmar({ quantidade: Number(quantidade), motivo: motivo.trim(), tratamentoEstoque })}>
        {disabled ? 'Cancelando...' : 'Confirmar cancelamento'}
      </button>
    </div>
  </Modal>;
}
