import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { MobileActionBar } from '../../components/MobileActionBar';
import { StatusBadge, comandaStatusVariant } from '../../components/StatusBadge';
import { IconTrash } from '../../components/NavIcons';
import { AdicionarItensQuiosqueModal } from '../../components/quiosque/AdicionarItensQuiosqueModal';
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
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { connectSocket, getSocket } from '../../lib/socket';
import {
  mapSaldosEstoque,
  pedidoConfirmadoNaComanda,
  pedidoVaiParaCozinha,
  podeEditarItemComanda,
  podeIncrementarItemComanda,
  podeIncrementarLinhaCarrinho,
  produtosOperacionaisUrl,
  rotuloComanda,
  rotuloInternoComanda,
  rotuloStatusPedido,
  temPedidoCozinhaPendente,
  totalItensComanda,
  type CaixaResposta,
  type ComandaQuiosque,
  type ProdutoQuiosque,
  type LinhaCarrinho,
  type SaldoEstoque,
} from '../../lib/quiosque';

export function QuiosqueComandaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDono, cervejaria, podeDarDescontoQuiosque } = useAuth();
  const { contexto } = useQuiosqueContexto();
  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedComanda, setClosedComanda] = useState<ComandaQuiosque | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [descontoInput, setDescontoInput] = useState('');
  const [erro, setErro] = useState('');
  const [itensAdicionadosMessage, setItensAdicionadosMessage] = useState('');
  const poll30 = usePollInterval(30_000);
  const poll15 = usePollInterval(15_000);

  useEffect(() => {
    if (!itensAdicionadosMessage) return;
    const timeoutId = window.setTimeout(() => setItensAdicionadosMessage(''), 5_000);
    return () => window.clearTimeout(timeoutId);
  }, [itensAdicionadosMessage]);

  const { data: comanda, isLoading } = useQuery({
    queryKey: ['quiosque-comanda', id],
    queryFn: () => api.get<ComandaQuiosque>(`/api/quiosque/comandas/${id}`),
  });

  const { data: produtos } = useQuery({
    queryKey: ['quiosque-produtos-operacionais', comanda?.pontoVendaId],
    queryFn: () =>
      api.get<ProdutoQuiosque[]>(produtosOperacionaisUrl(comanda!.pontoVendaId)),
    enabled: Boolean(comanda?.pontoVendaId),
  });

  const { data: caixaData } = useQuery({
    queryKey: ['quiosque-caixa', comanda?.pontoVendaId],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${comanda!.pontoVendaId}`),
    enabled: Boolean(comanda?.pontoVendaId),
    refetchInterval: poll30,
  });
  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';

  const { data: estoqueData } = useQuery({
    queryKey: ['quiosque-estoque', comanda?.pontoVendaId],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/quiosque/estoque?pontoVendaId=${comanda!.pontoVendaId}`),
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

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['quiosque-comanda', id] });
    queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
  };

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

    socket.on('quiosque:comanda-atualizada', onComandaAtualizada);
    socket.on('quiosque:pedido-atualizado', onPedidoAtualizado);

    return () => {
      socket.off('quiosque:comanda-atualizada', onComandaAtualizada);
      socket.off('quiosque:pedido-atualizado', onPedidoAtualizado);
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

  const adicionar = (produto: ProdutoQuiosque) => {
    setCarrinho((atual) => {
      const existente = atual.find((linha) => linha.produto.id === produto.id);
      const quantidadeAtual = existente?.quantidade ?? 0;
      if (!podeIncrementarLinhaCarrinho(produto, quantidadeAtual, saldos, controlaEstoque)) {
        return atual;
      }
      if (!existente) return [...atual, { produto, quantidade: 1 }];
      return atual.map((linha) =>
        linha.produto.id === produto.id ? { ...linha, quantidade: linha.quantidade + 1 } : linha,
      );
    });
  };

  const alterarQuantidade = (produtoId: string, delta: number) => {
    setCarrinho((atual) =>
      atual
        .map((linha) => {
          if (linha.produto.id !== produtoId) return linha;
          const novaQuantidade = linha.quantidade + delta;
          if (
            delta > 0 &&
            !podeIncrementarLinhaCarrinho(linha.produto, linha.quantidade, saldos, controlaEstoque)
          ) {
            return linha;
          }
          return { ...linha, quantidade: novaQuantidade };
        })
        .filter((linha) => linha.quantidade > 0),
    );
  };

  const lancarItens = useMutation({
    mutationFn: () =>
      api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/pedidos`, {
        itens: carrinho.map((linha) => ({
          produtoId: linha.produto.id,
          quantidade: linha.quantidade,
        })),
      }),
    onSuccess: () => {
      invalidar();
      if (comanda?.pontoVendaId) {
        queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', comanda.pontoVendaId] });
      }
      setCarrinho([]);
      setErro('');
      setItensAdicionadosMessage('Itens lançados. Selecione os próximos itens.');
    },
    onError: (err) => {
      setItensAdicionadosMessage('');
      if (comanda?.pontoVendaId) {
        queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', comanda.pontoVendaId] });
      }
      setErro(err instanceof ApiError ? err.message : 'Não foi possível lançar os itens');
    },
  });

  const fecharAdicionarItens = () => {
    if (lancarItens.isPending) return;
    setCarrinho([]);
    setShowAddItem(false);
    setErro('');
    setItensAdicionadosMessage('');
  };

  const invalidarEstoque = () => {
    if (comanda?.pontoVendaId) {
      queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', comanda.pontoVendaId] });
    }
  };

  const removerItem = useMutation({
    mutationFn: (itemId: string) =>
      api.delete<ComandaQuiosque>(`/api/quiosque/comandas/${id}/itens/${itemId}`),
    onSuccess: (atualizada) => {
      queryClient.setQueryData(['quiosque-comanda', id], atualizada);
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      invalidarEstoque();
      setErro('');
    },
    onError: (err) => {
      invalidarEstoque();
      setErro(err instanceof ApiError ? err.message : 'Não foi possível remover o item');
    },
  });

  const alterarQuantidadeItem = useMutation({
    mutationFn: ({ itemId, quantidade }: { itemId: string; quantidade: number }) =>
      api.patch<ComandaQuiosque>(`/api/quiosque/comandas/${id}/itens/${itemId}`, { quantidade }),
    onSuccess: (atualizada) => {
      queryClient.setQueryData(['quiosque-comanda', id], atualizada);
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
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
    }: {
      pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[];
      desconto: number;
      descontoAnterior: number;
      aplicarDesconto: boolean;
    }) => {
      if (aplicarDesconto && desconto !== descontoAnterior) {
        await api.patch<ComandaQuiosque>(`/api/quiosque/comandas/${id}/desconto`, { desconto });
      }
      return api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/pagamentos`, { pagamentos });
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
    mutationFn: () => api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/cancelar`),
    onSuccess: () => {
      invalidar();
      navigate('/quiosque/comandas');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível encerrar a comanda'),
  });

  const abrirNova = useMutation({
    mutationFn: () => {
      if (!comanda || comanda.tipo === 'AVULSA') throw new Error('Comanda inválida');
      return api.post<ComandaQuiosque>('/api/quiosque/comandas', {
        pontoVendaId: comanda.pontoVendaId,
        tipo: comanda.tipo,
        identificador: comanda.identificador,
        itens: [],
      });
    },
    onSuccess: (nova) => {
      invalidar();
      navigate(`/quiosque/comandas/${nova.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/quiosque/comandas/${err.body.comandaId}`);
        return;
      }
      setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir nova comanda');
    },
  });

  const openPayment = () => {
    if (!comanda) return;
    setDescontoInput(formatCurrencyInputFromNumber(comanda.desconto ?? 0));
    const total = Math.max(0, comanda.subtotal - (comanda.desconto ?? 0));
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
    setErro('');
  };

  const handleClose = () => {
    if (!comanda) return;
    const desconto = parseCurrencyInput(descontoInput);
    const podeAplicarDesconto = podeDarDescontoQuiosque;
    if (podeAplicarDesconto && desconto > comanda.subtotal) {
      setErro('O desconto não pode ser maior que o subtotal da comanda');
      return;
    }
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    fechar.mutate({
      pagamentos,
      desconto,
      descontoAnterior: comanda.desconto ?? 0,
      aplicarDesconto: podeAplicarDesconto,
    });
  };

  if (isLoading) return <Loading />;
  if (!comanda) return <p className="text-ink-faint text-center py-10">Comanda não encontrada.</p>;

  const aberta = comanda.status === 'ABERTA';
  const cancelada = comanda.status === 'CANCELADA';
  const temItens = totalItensComanda(comanda) > 0;
  const cozinhaPendente = temPedidoCozinhaPendente(comanda);
  const podeFechar = aberta && temItens && !cozinhaPendente;
  const hasActionBar = aberta || !aberta;
  const podeAplicarDesconto = podeDarDescontoQuiosque;
  const descontoValor = parseCurrencyInput(descontoInput);
  const totalComDesconto = Math.max(0, comanda.subtotal - descontoValor);
  const totalAPagar = Math.max(0, totalComDesconto);

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
    </div>
  );

  return (
    <div className={`space-y-4 ${hasActionBar ? 'page-with-action-bar' : 'pb-2'}`}>
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold min-w-0 truncate leading-tight">{rotuloComanda(comanda)}</h2>
          <StatusBadge variant={comandaStatusVariant(comanda.status)} />
        </div>
        {rotuloInternoComanda(comanda) && (
          <p className="mt-1 text-xs font-medium text-ink-faint">{rotuloInternoComanda(comanda)}</p>
        )}
        <p className="text-2xl sm:text-3xl font-bold text-brand-600 mt-2 tabular-nums">
          {formatCurrency(comanda.total)}
        </p>
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
        <h3 className="section-label">Itens</h3>
        {aberta && (
          <button
            type="button"
            className="touch-btn-orange w-full"
            onClick={() => {
              setErro('');
              setItensAdicionadosMessage('');
              setShowAddItem(true);
            }}
          >
            + Itens
          </button>
        )}

        {comanda.pedidos.map((pedido) => {
          const confirmado = pedidoConfirmadoNaComanda(pedido);
          const naCozinha = pedidoVaiParaCozinha(pedido.itens) && pedido.status !== 'CANCELADO';
          return (
          <section key={pedido.id} className="card space-y-2 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Senha {pedido.numero}
              </span>
              <div className="flex items-center gap-2">
                {naCozinha && (
                  <span
                    className={`text-xs font-semibold ${
                      confirmado ? 'text-green-600' : 'text-amber-600'
                    }`}
                  >
                    {rotuloStatusPedido(pedido.status)}
                  </span>
                )}
                {pedido.observacao && <span className="text-xs text-ink-faint">{pedido.observacao}</span>}
              </div>
            </div>
            {pedido.itens.map((item) => {
              const editavel = aberta && podeEditarItemComanda(comanda, pedido);
              const produto = produtoPorId.get(item.produtoId);
              const podeIncrementar = podeIncrementarItemComanda(produto, saldos, controlaEstoque);
              const alterandoEsteItem =
                (removerItem.isPending && removerItem.variables === item.id) ||
                (alterarQuantidadeItem.isPending && alterarQuantidadeItem.variables?.itemId === item.id);

              return (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className={`min-w-0 flex-1 truncate ${confirmado ? '' : 'text-ink-faint'}`}>
                  {editavel ? item.nome : `${item.quantidade}× ${item.nome}`}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {editavel ? (
                    <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-sm">
                      <button
                        type="button"
                        aria-label={`Remover um ${item.nome}`}
                        className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-base font-bold text-ink-muted transition-transform active:scale-95 active:bg-surface-lighter disabled:opacity-40"
                        disabled={itemEmEdicao}
                        onClick={() => {
                          if (item.quantidade <= 1) {
                            removerItem.mutate(item.id);
                            return;
                          }
                          alterarQuantidadeItem.mutate({
                            itemId: item.id,
                            quantidade: item.quantidade - 1,
                          });
                        }}
                      >
                        −
                      </button>
                      <span className="min-w-[1.75rem] text-center text-sm font-bold tabular-nums">
                        {item.quantidade}
                      </span>
                      <button
                        type="button"
                        aria-label={`Adicionar um ${item.nome}`}
                        className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-base font-bold text-ink transition-transform active:scale-95 active:bg-surface-lighter disabled:opacity-40"
                        disabled={itemEmEdicao || !podeIncrementar}
                        onClick={() =>
                          alterarQuantidadeItem.mutate({
                            itemId: item.id,
                            quantidade: item.quantidade + 1,
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                  <span className={`w-20 text-right font-semibold tabular-nums ${confirmado ? '' : 'text-ink-faint'}`}>
                    {confirmado ? formatCurrency(item.subtotal) : '—'}
                  </span>
                  {editavel && (
                    <button
                      type="button"
                      aria-label={`Remover ${item.nome}`}
                      onClick={() => removerItem.mutate(item.id)}
                      disabled={itemEmEdicao}
                      className="icon-btn-danger"
                    >
                      <IconTrash />
                    </button>
                  )}
                </div>
                {alterandoEsteItem && (
                  <span className="sr-only">Atualizando item</span>
                )}
              </div>
            );
            })}
          </section>
        );
        })}

        {aberta && temItens && cozinhaPendente && (
          <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            Aguarde a entrega dos itens da cozinha antes de fechar a comanda.
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

      {podeFechar && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" onClick={openPayment} data-audit="quiosque-comanda-fechar">
            Fechar Comanda · {formatCurrency(comanda.total)}
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/quiosque/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {aberta && temItens && cozinhaPendente && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" disabled>
            Aguardando entrega da cozinha
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/quiosque/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {aberta && !temItens && (
        <MobileActionBar>
          <p className="text-xs text-center text-ink-faint px-2">
            Sem consumação — use Encerrar comanda para cancelar.
          </p>
          {isDono && (
            <button
              type="button"
              className="touch-btn-danger w-full"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
              data-audit="quiosque-comanda-cancelar"
            >
              {cancelar.isPending ? 'Encerrando...' : 'Encerrar comanda'}
            </button>
          )}
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/quiosque/comandas')}>
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
            disabled={abrirNova.isPending || !caixaAberto}
          >
            {abrirNova.isPending
              ? 'Abrindo...'
              : !caixaAberto
                ? 'Caixa fechado — abra para nova comanda'
                : `Nova comanda · ${rotuloComanda(comanda)}`}
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/quiosque/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      <AdicionarItensQuiosqueModal
        open={showAddItem}
        onClose={fecharAdicionarItens}
        produtos={produtos ?? []}
        linhas={carrinho}
        onSelecionar={adicionar}
        onAlterar={alterarQuantidade}
        onConfirm={() => lancarItens.mutate()}
        isPending={lancarItens.isPending}
        error={showAddItem ? erro : undefined}
        successMessage={showAddItem ? itensAdicionadosMessage : undefined}
        saldos={saldos}
        controlaEstoque={controlaEstoque}
        confirmLabel="Lançar na comanda"
      />

      <PaymentFormModal
        open={showPayment}
        onClose={() => {
          setShowPayment(false);
          setErro('');
        }}
        title="Fechar Comanda"
        totalLabel="Total a pagar"
        total={totalAPagar}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleClose}
        isPending={fechar.isPending}
        headerExtra={paymentHeaderExtra}
      />

      <Modal
        open={showReceipt}
        onClose={() => {
          setShowReceipt(false);
          navigate('/quiosque/comandas');
        }}
        title="Comanda Fechada"
      >
        {closedComanda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">{rotuloComanda(closedComanda)}</p>
            <p className="text-3xl font-bold text-brand-600 tabular-nums">{formatCurrency(closedComanda.total)}</p>
            <div className="space-y-1">
              {closedComanda.pagamentos.length === 0 ? (
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
                navigate('/quiosque/comandas');
              }}
            >
              OK
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
