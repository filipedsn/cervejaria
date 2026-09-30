import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import type { Comanda, EventoCardapio, TapComChope } from '../types';
import {
  descontoComandaCervejaria,
  isBebidaChope,
  isVendaUnitaria,
  PAYMENT_LABELS,
  subtotalComandaCervejaria,
} from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { MobileActionBar } from '../components/MobileActionBar';
import { Modal } from '../components/Modal';
import { AdicionarItemComandaModal } from '../components/AdicionarItemComandaModal';
import { CheckoutItemsCard } from '../components/checkout/CheckoutItemsCard';
import { PaymentDiscountFields } from '../components/checkout/PaymentDiscountFields';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../components/PaymentFormModal';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../lib/currency';
import { invalidateOnboardingReadiness } from '../lib/onboarding';
import { getSocket } from '../lib/socket';

type CartLine = {
  key: string;
  produtoId: string;
  produtoNome: string;
  volumeMl: number;
  quantidade: number;
  tapId?: string;
  precoUnit: number;
};

let cartKeySeq = 0;

function nextCartKey() {
  cartKeySeq += 1;
  return `cart-${cartKeySeq}`;
}

export function VendaAvulsaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento } = useEvento();
  const { podeDarDescontoOperacao } = useAuth();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedComanda, setClosedComanda] = useState<Comanda | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
  const [descontoInput, setDescontoInput] = useState('');
  const [error, setError] = useState('');

  const eventoId = evento?.id;

  const { data: taps, isLoading: loadingTaps } = useQuery({
    queryKey: ['evento-taps', eventoId],
    queryFn: () => api.get<TapComChope[]>(`/api/eventos/${eventoId}/taps`),
    enabled: !!eventoId,
  });

  const { data: cardapio, isLoading: loadingCardapio } = useQuery({
    queryKey: ['evento-cardapio', eventoId],
    queryFn: () => api.get<EventoCardapio>(`/api/eventos/${eventoId}/cardapio`),
    enabled: !!eventoId,
  });

  useEffect(() => {
    if (!eventoId) return;
    const socket = getSocket();
    const refreshMenu = (event: { eventoId: string }) => {
      if (event.eventoId === eventoId) {
        queryClient.invalidateQueries({ queryKey: ['evento-cardapio', eventoId] });
      }
    };
    socket.on('evento-cardapio:updated', refreshMenu);
    return () => {
      socket.off('evento-cardapio:updated', refreshMenu);
    };
  }, [eventoId, queryClient]);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.precoUnit * line.quantidade, 0),
    [cart],
  );
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

  const tapsComChope = taps?.filter((t) => t.ativo && t.chopeAtual && isBebidaChope(t.chopeAtual)) ?? [];
  const bebidasEmbalagem =
    cardapio?.produtos.filter((p) => isVendaUnitaria(p) && p.tipo === 'BEBIDA') ?? [];
  const comidas = cardapio?.produtos.filter((p) => p.tipo === 'COMIDA') ?? [];

  const vendaMutation = useMutation({
    mutationFn: ({
      pagamentos,
      desconto,
    }: {
      pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[];
      desconto: number;
    }) =>
      api.post<Comanda>('/api/vendas-avulsas', {
        eventoId: eventoId!,
        itens: cart.map((line) => ({
          produtoId: line.produtoId,
          volumeMl: line.volumeMl,
          quantidade: line.quantidade,
          ...(line.tapId ? { tapId: line.tapId } : {}),
        })),
        pagamentos,
        desconto,
      }),
    onSuccess: (data) => {
      setClosedComanda(data);
      setShowPayment(false);
      setShowReceipt(true);
      setCart([]);
      if (evento) {
        queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
      }
      invalidateOnboardingReadiness(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao registrar venda avulsa'),
  });

  const handleAddToCart = (data: {
    produtoId: string;
    volumeMl: number;
    quantidade: number;
    tapId?: string;
  }) => {
    let produtoNome = '';
    let precoUnit = 0;

    if (data.tapId) {
      const tap = tapsComChope.find((t) => t.id === data.tapId);
      const chope = tap?.chopeAtual;
      if (!chope) return;
      produtoNome = chope.nome;
      const preco = chope.precos.find((p) => p.volumeMl === data.volumeMl);
      if (!preco) return;
      precoUnit = parseFloat(String(preco.preco));
    } else {
      const produto = [...bebidasEmbalagem, ...comidas].find((p) => p.id === data.produtoId);
      if (!produto) return;
      produtoNome = produto.nome;
      const preco = produto.precos.find((p) => p.volumeMl === data.volumeMl);
      if (!preco) return;
      precoUnit = parseFloat(String(preco.preco));
    }

    setCart((prev) => [
      ...prev,
      {
        key: nextCartKey(),
        produtoId: data.produtoId,
        produtoNome,
        volumeMl: data.volumeMl,
        quantidade: data.quantidade,
        tapId: data.tapId,
        precoUnit,
      },
    ]);
    setShowAddItem(false);
    setError('');
  };

  const openPayment = () => {
    if (cart.length === 0) return;
    setDescontoInput(formatCurrencyInputFromNumber(0));
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
    setError('');
  };

  const handleConfirmPayment = () => {
    if (descontoValor > total) {
      setError('O desconto não pode ser maior que o subtotal da venda');
      return;
    }
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    vendaMutation.mutate({ pagamentos, desconto: descontoValor });
  };

  const paymentHeaderExtra = (
    <div className="space-y-3">
      {error && showPayment && <div className="alert-error text-sm">{error}</div>}
      {podeDarDescontoOperacao && (
        <PaymentDiscountFields
          inputId="desconto-venda-avulsa"
          subtotal={total}
          discountValue={descontoValor}
          discountInput={descontoInput}
          onDiscountChange={setDescontoInput}
          total={totalComDesconto}
          disabled={vendaMutation.isPending}
        />
      )}
    </div>
  );

  if (!evento || evento.status !== 'ABERTO') {
    return (
      <div className="space-y-4">
        <PageHeader title="Venda avulsa" />
        <p className="empty-state-text">Abra um evento para registrar vendas avulsas.</p>
      </div>
    );
  }

  if (loadingTaps || loadingCardapio) return <Loading />;

  return (
    <div className={`space-y-4 ${cart.length > 0 ? 'page-with-action-bar' : 'pb-2'}`}>
      <PageHeader title="Venda avulsa" />

      <p className="text-sm text-ink-muted leading-relaxed">
        Venda rápida sem abrir comanda. Não entra no ranking nem na fidelização.
      </p>

      {error && !showPayment && <div className="alert-error">{error}</div>}

      <CheckoutItemsCard
        empty={cart.length === 0}
        total={total}
        onAdd={() => setShowAddItem(true)}
      >
            {cart.map((line) => (
              <div
                key={line.key}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{line.produtoNome}</p>
                  <p className="text-sm text-ink-muted">
                    {line.tapId
                      ? `${line.volumeMl}ml × ${line.quantidade}`
                      : line.quantidade > 1
                        ? `${line.quantidade} unidades`
                        : '1 unidade'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-brand-600 tabular-nums">
                    {formatCurrency(line.precoUnit * line.quantidade)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remover item"
                    className="min-h-10 min-w-10 rounded-lg text-ink-muted active:bg-surface"
                    onClick={() => setCart((prev) => prev.filter((x) => x.key !== line.key))}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
      </CheckoutItemsCard>

      <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/comandas')}>
        Cancelar
      </button>

      {cart.length > 0 && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" onClick={openPayment} data-audit="venda-avulsa-pagar">
            Pagar · {formatCurrency(total)}
          </button>
        </MobileActionBar>
      )}

      <AdicionarItemComandaModal
        open={showAddItem}
        onClose={() => setShowAddItem(false)}
        tapsComChope={tapsComChope}
        bebidas={bebidasEmbalagem}
        comidas={comidas}
        eventoAberto
        comandaTotal={total}
        onAdd={handleAddToCart}
        isPending={false}
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
        isPending={vendaMutation.isPending}
        confirmMessage="A venda será registrada e não poderá ser editada."
        headerExtra={paymentHeaderExtra}
      />

      <Modal
        open={showReceipt}
        onClose={() => {
          setShowReceipt(false);
          navigate('/comandas');
        }}
        title="Venda concluída"
      >
        {closedComanda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">Venda avulsa</p>
            <p className="text-3xl font-bold text-brand-600">{formatCurrency(closedComanda.total)}</p>
            {descontoComandaCervejaria(closedComanda) > 0 && (
              <div className="rounded-xl border border-line bg-surface-lighter p-3 space-y-1 text-sm text-left">
                <div className="flex justify-between text-ink-muted">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotalComandaCervejaria(closedComanda, true))}</span>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <span>Desconto</span>
                  <span>− {formatCurrency(descontoComandaCervejaria(closedComanda))}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(closedComanda.total)}</span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              {closedComanda.pagamentos.length === 0 ? (
                <p className="font-semibold text-success">Cortesia — sem pagamento</p>
              ) : (
                closedComanda.pagamentos.map((p) => (
                  <p key={p.id} className="text-ink-muted">
                    {PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}
                  </p>
                ))
              )}
            </div>
            <button
              type="button"
              className="touch-btn-primary w-full"
              onClick={() => {
                setShowReceipt(false);
                navigate('/comandas');
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
