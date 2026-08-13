import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
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
import { GradeProdutos } from '../../components/quiosque/GradeProdutos';
import { ResumoCarrinho } from '../../components/quiosque/ResumoCarrinho';
import { parseCurrencyInput } from '../../lib/currency';
import { PAYMENT_LABELS } from '../../types';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import {
  mapSaldosEstoque,
  podeIncrementarLinhaCarrinho,
  produtosOperacionaisUrl,
  totalCarrinho,
  type CaixaResposta,
  type ComandaQuiosque,
  type LinhaCarrinho,
  type ProdutoQuiosque,
  type SaldoEstoque,
} from '../../lib/quiosque';

export function QuiosqueVendaAvulsaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedVenda, setClosedVenda] = useState<ComandaQuiosque | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [erro, setErro] = useState('');

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const temCozinha = contexto.ativo && contexto.temCozinha;
  const pollMs = usePollInterval(30_000);

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['quiosque-produtos-operacionais', pontoAtivo],
    queryFn: () => api.get<ProdutoQuiosque[]>(produtosOperacionaisUrl(pontoAtivo)),
    enabled: Boolean(pontoAtivo),
  });

  const { data: caixaData } = useQuery({
    queryKey: ['quiosque-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });

  const { data: estoqueData } = useQuery({
    queryKey: ['quiosque-estoque', pontoAtivo],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/quiosque/estoque?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo) && controlaEstoque,
    refetchInterval: pollMs,
  });

  const saldos = useMemo(
    () => (estoqueData ? mapSaldosEstoque(estoqueData) : undefined),
    [estoqueData],
  );

  const quantidadesNoCarrinho = useMemo(
    () => new Map(carrinho.map((linha) => [linha.produto.id, linha.quantidade])),
    [carrinho],
  );

  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const total = totalCarrinho(carrinho);

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

  const limpar = () => {
    setCarrinho([]);
    setErro('');
    setShowPayment(false);
  };

  const cobrar = useMutation({
    mutationFn: (
      pagamentos: { forma: ReturnType<typeof toPaymentForma>; valor: number }[],
    ) =>
      api.post<ComandaQuiosque>('/api/quiosque/vendas', {
        pontoVendaId: pontoAtivo,
        itens: carrinho.map((linha) => ({ produtoId: linha.produto.id, quantidade: linha.quantidade })),
        pagamentos,
      }),
    onSuccess: (venda) => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      queryClient.invalidateQueries({ queryKey: ['quiosque-caixa', pontoAtivo] });
      queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', pontoAtivo] });
      limpar();
      setClosedVenda(venda);
      setShowReceipt(true);
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', pontoAtivo] });
      setErro(err instanceof ApiError ? err.message : 'Não foi possível concluir a venda');
    },
  });

  if (isLoading) return <Loading />;

  if (!produtos || produtos.length === 0) {
    return (
      <div className="space-y-4 pb-2">
        <PageHeader title="Venda avulsa" backTo="/quiosque/comandas" backLabel="Comandas" />
        <EmptyState
          icon="🛒"
          title="Nenhum produto no catálogo"
          description="Cadastre produtos no catálogo para começar a vender."
          action={
            <Link to="/quiosque/catalogo" className="touch-btn-orange inline-flex min-h-12 items-center px-6">
              Ir ao catálogo
            </Link>
          }
        />
      </div>
    );
  }

  const openPayment = () => {
    setErro('');
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
  };

  const handleConfirmPayment = () => {
    const pagamentos = paymentForm.map((row) => ({
      forma: toPaymentForma(row),
      valor: parseCurrencyInput(row.valor),
    }));
    cobrar.mutate(pagamentos);
  };

  return (
    <div className={`space-y-4 ${carrinho.length > 0 ? 'page-with-action-bar' : 'pb-2'}`}>
      <PageHeader title="Venda avulsa" backTo="/quiosque/comandas" backLabel="Comandas" />

      <p className="text-sm text-ink-muted leading-relaxed">
        Venda rápida sem abrir comanda. O pagamento é registrado na hora.
      </p>

      {!caixaAberto && pontoAtivo && (
        <div className="alert-error">
          Caixa fechado.{' '}
          <Link to="/quiosque/comandas" className="underline font-semibold">
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

      <GradeProdutos
        produtos={produtos}
        onSelecionar={adicionar}
        saldos={saldos}
        controlaEstoque={controlaEstoque}
        quantidadesNoCarrinho={quantidadesNoCarrinho}
      />

      <button
        type="button"
        className="touch-btn-danger w-full"
        onClick={() => navigate('/quiosque/comandas')}
      >
        Cancelar
      </button>

      {carrinho.length > 0 && (
        <MobileActionBar>
          <div className="max-h-32 overflow-y-auto">
            <ResumoCarrinho
              linhas={carrinho}
              onAlterar={alterarQuantidade}
              saldos={saldos}
              controlaEstoque={controlaEstoque}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <button type="button" className="text-sm text-ink-faint underline" onClick={limpar}>
              Limpar
            </button>
            <span className="text-2xl font-bold">{formatCurrency(total)}</span>
          </div>
          <button
            type="button"
            className="touch-btn-primary w-full"
            disabled={!caixaAberto}
            onClick={openPayment}
          >
            Pagar · {formatCurrency(total)}
          </button>
        </MobileActionBar>
      )}

      <PaymentFormModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Venda avulsa"
        totalLabel="Total da venda"
        total={total}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleConfirmPayment}
        isPending={cobrar.isPending}
        confirmMessage="A venda será registrada e não poderá ser editada."
        headerExtra={erro ? <div className="alert-error">{erro}</div> : undefined}
      />

      <Modal
        open={showReceipt}
        onClose={() => {
          setShowReceipt(false);
          navigate('/quiosque/comandas');
        }}
        title="Venda concluída"
      >
        {closedVenda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">Venda avulsa</p>
            <p className="text-3xl font-bold text-brand-600">{formatCurrency(closedVenda.total)}</p>
            <div className="space-y-1">
              {closedVenda.pagamentos.map((p) => (
                <p key={p.id} className="text-ink-muted">
                  {PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}
                </p>
              ))}
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
