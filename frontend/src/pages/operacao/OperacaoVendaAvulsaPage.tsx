import { useEffect, useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { invalidateOnboardingReadiness } from '../../lib/onboarding';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { MobileActionBar } from '../../components/MobileActionBar';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../../components/PaymentFormModal';
import { AdicionarItensOperacaoModal } from '../../components/operacao/AdicionarItensOperacaoModal';
import { SelecionarClienteOperacao } from '../../components/operacao/SelecionarClienteOperacao';
import { CheckoutItemsCard } from '../../components/checkout/CheckoutItemsCard';
import { PaymentDiscountFields } from '../../components/checkout/PaymentDiscountFields';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import { PAYMENT_LABELS } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import type { Cliente } from '../../types';
import {
  mapSaldosEstoque,
  normalizeCategoriaProduto,
  podeIncrementarLinhaCarrinho,
  produtosOperacionaisUrl,
  totalCarrinho,
  type CaixaResposta,
  type ComandaOperacao,
  type LinhaCarrinho,
  type ProdutoOperacao,
  type SaldoEstoque,
} from '../../lib/operacao';

function precoLinha(produto: ProdutoOperacao): number {
  return produto.precoEfetivo ?? (parseFloat(produto.precoUnit) || 0);
}

export function OperacaoVendaAvulsaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { contexto } = useOperacaoContexto();
  const { podeDarDescontoOperacao } = useAuth();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [itensModal, setItensModal] = useState<LinhaCarrinho[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedVenda, setClosedVenda] = useState<ComandaOperacao | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [descontoInput, setDescontoInput] = useState('');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [erro, setErro] = useState('');

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const temCozinha = contexto.ativo && contexto.temCozinha;
  const pollMs = usePollInterval(30_000);

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['operacao-produtos-operacionais', pontoAtivo],
    queryFn: () => api.get<ProdutoOperacao[]>(produtosOperacionaisUrl(pontoAtivo)),
    enabled: Boolean(pontoAtivo),
  });

  const { data: caixaData } = useQuery({
    queryKey: ['operacao-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });

  const { data: estoqueData } = useQuery({
    queryKey: ['operacao-estoque', pontoAtivo],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/operacao/estoque?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo) && controlaEstoque,
    refetchInterval: pollMs,
  });

  const saldos = useMemo(
    () => (estoqueData ? mapSaldosEstoque(estoqueData) : undefined),
    [estoqueData],
  );

  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const total = totalCarrinho(carrinho);
  const descontoValor = podeDarDescontoOperacao ? parseCurrencyInput(descontoInput) : 0;
  const totalComDesconto = Math.max(0, total - descontoValor);

  useEffect(() => {
    if (!showPayment) return;
    setPaymentForm((prev) => {
      if (totalComDesconto <= 0.01) return prev.length === 0 ? prev : [];
      if (prev.length === 0) return createDefaultPaymentForm(totalComDesconto);
      if (prev.length !== 1) return prev;
      const atual = parseCurrencyInput(prev[0].valor);
      if (Math.abs(atual - totalComDesconto) < 0.01) return prev;
      return [{ ...prev[0], valor: formatCurrencyInputFromNumber(totalComDesconto) }];
    });
  }, [descontoInput, showPayment, totalComDesconto]);

  const adicionarNoModal = (produto: ProdutoOperacao, configuracao?: { quantidade?: number; paraViagem?: boolean; observacao?: string; opcionais?: LinhaCarrinho['opcionais'] }) => {
    setItensModal((atual) => {
      const existente = atual.find((linha) => linha.produto.id === produto.id && linha.paraViagem === configuracao?.paraViagem && linha.observacao === configuracao?.observacao && JSON.stringify(linha.opcionais ?? []) === JSON.stringify(configuracao?.opcionais ?? []));
      const quantidadeCarrinho =
        carrinho.find((linha) => linha.produto.id === produto.id)?.quantidade ?? 0;
      const quantidadeAtual = quantidadeCarrinho + (existente?.quantidade ?? 0);
      if (!podeIncrementarLinhaCarrinho(produto, quantidadeAtual, saldos, controlaEstoque)) {
        return atual;
      }
      if (!existente) return [...atual, { produto, quantidade: configuracao?.quantidade ?? 1, paraViagem: configuracao?.paraViagem, observacao: configuracao?.observacao, opcionais: configuracao?.opcionais }];
      return atual.map((linha) =>
        linha.produto.id === produto.id && linha.paraViagem === configuracao?.paraViagem && linha.observacao === configuracao?.observacao && JSON.stringify(linha.opcionais ?? []) === JSON.stringify(configuracao?.opcionais ?? []) ? { ...linha, quantidade: linha.quantidade + (configuracao?.quantidade ?? 1) } : linha,
      );
    });
    setErro('');
  };

  const alterarQuantidadeModal = (produtoId: string, delta: number) => {
    setItensModal((atual) =>
      atual
        .map((linha) => {
          if (linha.produto.id !== produtoId) return linha;
          const quantidadeCarrinho =
            carrinho.find((item) => item.produto.id === produtoId)?.quantidade ?? 0;
          if (
            delta > 0 &&
            !podeIncrementarLinhaCarrinho(
              linha.produto,
              quantidadeCarrinho + linha.quantidade,
              saldos,
              controlaEstoque,
            )
          ) {
            return linha;
          }
          return { ...linha, quantidade: linha.quantidade + delta };
        })
        .filter((linha) => linha.quantidade > 0),
    );
  };

  const confirmarItensModal = () => {
    setCarrinho((atual) => {
      const next = [...atual];
      for (const linha of itensModal) {
        const index = next.findIndex((item) => item.produto.id === linha.produto.id && item.paraViagem === linha.paraViagem && item.observacao === linha.observacao && JSON.stringify(item.opcionais ?? []) === JSON.stringify(linha.opcionais ?? []));
        if (index < 0) next.push(linha);
        else next[index] = { ...next[index], quantidade: next[index].quantidade + linha.quantidade };
      }
      return next;
    });
    setItensModal([]);
    setShowAddItem(false);
  };

  const removerLinha = (produtoId: string) => {
    setCarrinho((atual) => atual.filter((linha) => linha.produto.id !== produtoId));
  };

  const cobrar = useMutation({
    mutationFn: ({
      pagamentos,
      desconto,
    }: {
      pagamentos: { forma: ReturnType<typeof toPaymentForma>; valor: number }[];
      desconto: number;
    }) =>
      api.post<ComandaOperacao>('/api/operacao/vendas', {
        pontoVendaId: pontoAtivo,
        ...(cliente ? { clienteId: cliente.id } : {}),
        itens: carrinho.map((linha) => ({ produtoId: linha.produto.id, quantidade: linha.quantidade, paraViagem: linha.paraViagem ?? false, observacao: linha.observacao, opcionais: linha.opcionais?.map(({ opcionalId, quantidade }) => ({ opcionalId, quantidade })) })),
        pagamentos,
        desconto,
      }),
    onSuccess: (venda) => {
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      queryClient.invalidateQueries({ queryKey: ['operacao-caixa', pontoAtivo] });
      queryClient.invalidateQueries({ queryKey: ['operacao-estoque', pontoAtivo] });
      invalidateOnboardingReadiness(queryClient);
      setCarrinho([]);
      setShowPayment(false);
      setClosedVenda(venda);
      setShowReceipt(true);
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ['operacao-estoque', pontoAtivo] });
      setErro(err instanceof ApiError ? err.message : 'Não foi possível concluir a venda');
    },
  });

  if (isLoading) return <Loading />;

  if (!produtos || produtos.length === 0) {
    return (
      <div className="space-y-4 pb-2">
        <PageHeader title="Venda avulsa" backTo="/operacao/comandas" backLabel="Comandas" />
        <EmptyState
          icon="🛒"
          title="Nenhum produto no catálogo"
          description="Cadastre produtos no catálogo para começar a vender."
          action={
            <Link to="/operacao/catalogo" className="touch-btn-primary inline-flex min-h-12 items-center px-6">
              Ir ao catálogo
            </Link>
          }
        />
      </div>
    );
  }

  const openPayment = () => {
    if (carrinho.length === 0) return;
    setDescontoInput(formatCurrencyInputFromNumber(0));
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
    setErro('');
  };

  const handleConfirmPayment = () => {
    if (descontoValor > total) {
      setErro('O desconto não pode ser maior que o subtotal da venda');
      return;
    }
    const pagamentos = paymentForm.map((row) => ({
      forma: toPaymentForma(row),
      valor: parseCurrencyInput(row.valor),
    }));
    cobrar.mutate({ pagamentos, desconto: descontoValor });
  };

  const paymentHeaderExtra = (
    <div className="space-y-3">
      {erro && showPayment && <div className="alert-error text-sm">{erro}</div>}
      {podeDarDescontoOperacao && (
        <PaymentDiscountFields
          inputId="desconto-venda-avulsa-operacao"
          subtotal={total}
          discountValue={descontoValor}
          discountInput={descontoInput}
          onDiscountChange={setDescontoInput}
          total={totalComDesconto}
          disabled={cobrar.isPending}
        />
      )}
    </div>
  );

  return (
    <div className={`space-y-4 ${carrinho.length > 0 ? 'page-with-action-bar' : 'pb-2'}`}>
      <PageHeader title="Venda avulsa" backTo="/operacao/comandas" backLabel="Comandas" />

      <p className="text-sm text-ink-muted leading-relaxed">
        Venda rápida sem abrir comanda. Não entra no ranking nem na fidelização.
      </p>

      <SelecionarClienteOperacao value={cliente} onChange={setCliente} />

      {!caixaAberto && pontoAtivo && (
        <div className="alert-error">
          Caixa fechado.{' '}
          <Link to="/operacao/comandas" className="underline font-semibold">
            Abra o caixa em Comandas
          </Link>{' '}
          para registrar vendas.
        </div>
      )}

      {erro && !showPayment && <div className="alert-error">{erro}</div>}

      {pontosVenda.length > 1 && (
        <div>
          <label className="label">Ponto de venda</label>
          <select
            className="input"
            value={pontoAtivo}
            onChange={(e) => setPontoVendaId(e.target.value)}
          >
            {pontosVenda.map((ponto) => (
              <option key={ponto.id} value={ponto.id}>
                {ponto.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      <CheckoutItemsCard
        empty={carrinho.length === 0}
        total={total}
        onAdd={() => {
          setItensModal([]);
          setShowAddItem(true);
        }}
      >
            {carrinho.map((linha) => {
              const precoUnit = precoLinha(linha.produto);
              return (
                <div
                  key={linha.produto.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{linha.produto.nome}</p>
                    <p className="text-sm text-ink-muted">
                      {normalizeCategoriaProduto(linha.produto.categoria)} · {linha.quantidade}x{' '}
                      {formatCurrency(precoUnit)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-brand-600 tabular-nums">
                      {formatCurrency(precoUnit * linha.quantidade)}
                    </span>
                    <button
                      type="button"
                      aria-label="Remover item"
                      className="min-h-10 min-w-10 rounded-lg text-ink-muted active:bg-surface"
                      onClick={() => removerLinha(linha.produto.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
      </CheckoutItemsCard>

      <button
        type="button"
        className="touch-btn-secondary w-full"
        onClick={() => navigate('/operacao/comandas')}
      >
        Cancelar
      </button>

      {carrinho.length > 0 && (
        <MobileActionBar>
          <button
            type="button"
            className="touch-btn-primary w-full"
            disabled={!caixaAberto}
            onClick={openPayment}
            data-audit="venda-avulsa-pagar"
          >
            Pagar · {formatCurrency(total)}
          </button>
        </MobileActionBar>
      )}

      <AdicionarItensOperacaoModal
        open={showAddItem}
        onClose={() => {
          setItensModal([]);
          setShowAddItem(false);
        }}
        produtos={produtos}
        linhas={itensModal}
        onSelecionar={adicionarNoModal}
        onAlterar={alterarQuantidadeModal}
        onConfirm={confirmarItensModal}
        isPending={false}
        saldos={saldos}
        controlaEstoque={controlaEstoque}
        confirmLabel="Adicionar à venda"
      />

      <PaymentFormModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Venda avulsa"
        totalLabel="Total da venda"
        total={totalComDesconto}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleConfirmPayment}
        isPending={cobrar.isPending}
        confirmMessage="A venda será registrada e não poderá ser editada."
        headerExtra={paymentHeaderExtra}
      />

      <Modal
        open={showReceipt}
        onClose={() => {
          setShowReceipt(false);
          navigate('/operacao/comandas');
        }}
        title="Venda concluída"
      >
        {closedVenda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">Venda avulsa</p>
            <p className="text-3xl font-bold text-brand-600">{formatCurrency(closedVenda.total)}</p>
            {closedVenda.desconto > 0 && (
              <div className="rounded-xl border border-line bg-surface-lighter p-3 space-y-1 text-sm text-left">
                <div className="flex justify-between text-ink-muted">
                  <span>Subtotal</span>
                  <span>{formatCurrency(closedVenda.subtotal)}</span>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <span>Desconto</span>
                  <span>− {formatCurrency(closedVenda.desconto)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(closedVenda.total)}</span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              {closedVenda.pagamentos.length === 0 ? (
                <p className="font-semibold text-success">Cortesia — sem pagamento</p>
              ) : (
                closedVenda.pagamentos.map((p) => (
                  <p key={p.id} className="text-ink-muted">
                    {PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}
                  </p>
                ))
              )}
            </div>
            {temCozinha &&
            closedVenda.pedidos.some((pedido) => pedido.itens.some((item) => item.exigePreparo)) ? (
              <p className="text-sm text-ink-faint">
                Senha {closedVenda.pedidos[0]?.numero} enviada para a cozinha.
              </p>
            ) : null}
            <button
              type="button"
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
    </div>
  );
}
