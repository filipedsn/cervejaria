import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { MobileActionBar } from '../../components/MobileActionBar';
import { StatusBadge, comandaStatusVariant } from '../../components/StatusBadge';
import { CurrencyInput } from '../../components/CurrencyInput';
import { GradeProdutos } from '../../components/quiosque/GradeProdutos';
import { ResumoCarrinho } from '../../components/quiosque/ResumoCarrinho';
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
  podeIncrementarLinhaCarrinho,
  produtosOperacionaisUrl,
  rotuloComanda,
  rotuloStatusPedido,
  temPedidoCozinhaPendente,
  totalCarrinho,
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
  const poll30 = usePollInterval(30_000);
  const poll15 = usePollInterval(15_000);

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
    enabled: Boolean(comanda?.pontoVendaId) && controlaEstoque && showAddItem,
    refetchInterval: showAddItem ? poll15 : false,
  });

  const saldos = useMemo(
    () => (estoqueData ? mapSaldosEstoque(estoqueData) : undefined),
    [estoqueData],
  );

  const quantidadesNoCarrinho = useMemo(
    () => new Map(carrinho.map((linha) => [linha.produto.id, linha.quantidade])),
    [carrinho],
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
    if (comanda) {
      setDescontoInput(formatCurrencyInputFromNumber(comanda.desconto ?? 0));
    }
  }, [comanda?.id, comanda?.desconto]);

  const salvarDesconto = useMutation({
    mutationFn: (desconto: number) =>
      api.patch<ComandaQuiosque>(`/api/quiosque/comandas/${id}/desconto`, { desconto }),
    onSuccess: () => {
      invalidar();
      setErro('');
    },
    onError: (err) => {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível aplicar o desconto');
      if (comanda) setDescontoInput(formatCurrencyInputFromNumber(comanda.desconto ?? 0));
    },
  });

  const aplicarDesconto = () => {
    if (!comanda) return;
    const valor = parseCurrencyInput(descontoInput);
    if (valor === (comanda.desconto ?? 0)) return;
    salvarDesconto.mutate(valor);
  };

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
      setShowAddItem(false);
      setErro('');
    },
    onError: (err) => {
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
  };

  const addItemFooter = (
    <>
      {carrinho.length > 0 && (
        <div className="space-y-3">
          <div className="max-h-32 overflow-y-auto -mx-1 px-1">
            <ResumoCarrinho
              linhas={carrinho}
              onAlterar={alterarQuantidade}
              saldos={saldos}
              controlaEstoque={controlaEstoque}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-faint">Nesta rodada</span>
            <span className="text-xl font-bold tabular-nums">{formatCurrency(totalCarrinho(carrinho))}</span>
          </div>
        </div>
      )}
      <button
        type="button"
        className="touch-btn-primary w-full"
        disabled={carrinho.length === 0 || lancarItens.isPending}
        onClick={() => lancarItens.mutate()}
        data-audit="quiosque-comanda-lancar-itens"
      >
        {lancarItens.isPending ? 'Lançando...' : 'Lançar na comanda'}
      </button>
      <button
        type="button"
        className="touch-btn-secondary w-full"
        onClick={fecharAdicionarItens}
        disabled={lancarItens.isPending}
      >
        Cancelar
      </button>
    </>
  );

  const fechar = useMutation({
    mutationFn: (pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[]) =>
      api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/pagamentos`, { pagamentos }),
    onSuccess: (data) => {
      setShowPayment(false);
      if (data.status === 'FECHADA') {
        setClosedComanda(data);
        setShowReceipt(true);
      }
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
    setPaymentForm(createDefaultPaymentForm(comanda.saldo));
    setShowPayment(true);
    setErro('');
  };

  const handleClose = () => {
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    fechar.mutate(pagamentos);
  };

  if (isLoading) return <Loading />;
  if (!comanda) return <p className="text-ink-faint text-center py-10">Comanda não encontrada.</p>;

  const aberta = comanda.status === 'ABERTA';
  const cancelada = comanda.status === 'CANCELADA';
  const temItens = totalItensComanda(comanda) > 0;
  const hasActionBar = aberta || !aberta;
  const mostraDesconto = aberta && comanda.tipo !== 'AVULSA' && podeDarDescontoQuiosque;

  return (
    <div className={`space-y-4 ${hasActionBar ? 'page-with-action-bar' : 'pb-2'}`}>
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold min-w-0 truncate leading-tight">{rotuloComanda(comanda)}</h2>
          <StatusBadge variant={comandaStatusVariant(comanda.status)} />
        </div>
        <p className="text-2xl sm:text-3xl font-bold text-brand-600 mt-2 tabular-nums">
          {formatCurrency(aberta ? comanda.saldo : comanda.total)}
        </p>
        {(aberta && (comanda.subtotal > 0 || comanda.desconto > 0)) || (!aberta && comanda.desconto > 0) ? (
          <div className="mt-3 space-y-1 text-sm border-t border-line pt-3">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrency(comanda.subtotal)}</span>
            </div>
            {mostraDesconto ? (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="desconto-comanda" className="text-ink-muted shrink-0">
                  Desconto
                </label>
                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                  <CurrencyInput
                    id="desconto-comanda"
                    className="input w-28 text-right tabular-nums py-2"
                    value={descontoInput}
                    onChange={setDescontoInput}
                    onBlur={aplicarDesconto}
                    disabled={salvarDesconto.isPending}
                  />
                </div>
              </div>
            ) : comanda.desconto > 0 ? (
              <div className="flex justify-between text-ink-muted">
                <span>Desconto</span>
                <span className="tabular-nums text-red-600">− {formatCurrency(comanda.desconto)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(comanda.total)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {erro && !showAddItem && <div className="alert-error">{erro}</div>}

      <div className="space-y-2">
        <h3 className="section-label">Itens</h3>
        {aberta && (
          <button type="button" className="touch-btn-orange w-full" onClick={() => { setErro(''); setShowAddItem(true); }}>
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
            {pedido.itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className={`min-w-0 flex-1 truncate ${confirmado ? '' : 'text-ink-faint'}`}>
                  {item.quantidade}× {item.nome}
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${confirmado ? '' : 'text-ink-faint'}`}>
                  {confirmado ? formatCurrency(item.subtotal) : '—'}
                </span>
              </div>
            ))}
          </section>
        );
        })}

        {aberta && temItens && temPedidoCozinhaPendente(comanda) && comanda.saldo === 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            Itens na cozinha ainda não entram no total. Marque como entregue na cozinha para cobrar.
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

      {aberta && comanda.saldo > 0 && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" onClick={openPayment} data-audit="quiosque-comanda-fechar">
            Fechar Comanda · {formatCurrency(comanda.saldo)}
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/quiosque/comandas')}>
            Voltar às comandas
          </button>
        </MobileActionBar>
      )}

      {aberta && comanda.saldo === 0 && temItens && (
        <MobileActionBar>
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

      <Modal
        open={showAddItem}
        onClose={fecharAdicionarItens}
        title="Adicionar itens"
        footer={addItemFooter}
      >
        <div className="space-y-4">
          {erro && showAddItem && <div className="alert-error text-sm">{erro}</div>}
          {produtos && (
            <GradeProdutos
              produtos={produtos}
              onSelecionar={adicionar}
              saldos={saldos}
              controlaEstoque={controlaEstoque}
              quantidadesNoCarrinho={quantidadesNoCarrinho}
            />
          )}
        </div>
      </Modal>

      <PaymentFormModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Fechar Comanda"
        totalLabel="Total da comanda"
        total={comanda.saldo}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleClose}
        isPending={fechar.isPending}
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
              {closedComanda.pagamentos.map((pagamento) => (
                <p key={pagamento.id} className="text-ink-muted">
                  {PAYMENT_LABELS[pagamento.forma]}: {formatCurrency(pagamento.valor)}
                </p>
              ))}
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
