import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import type { Comanda, EventoCardapio, TapComChope } from '../types';
import { formatItemDetail, isBebidaChope, isVendaUnitaria, PAYMENT_LABELS } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { MobileActionBar } from '../components/MobileActionBar';
import { Modal } from '../components/Modal';
import { AdicionarItemComandaModal } from '../components/AdicionarItemComandaModal';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../components/PaymentFormModal';
import { parseCurrencyInput } from '../lib/currency';

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

  const [cart, setCart] = useState<CartLine[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedComanda, setClosedComanda] = useState<Comanda | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([{ forma: 'PIX', valor: '' }]);
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

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.precoUnit * line.quantidade, 0),
    [cart],
  );

  const tapsComChope = taps?.filter((t) => t.ativo && t.chopeAtual && isBebidaChope(t.chopeAtual)) ?? [];
  const bebidasEmbalagem =
    cardapio?.produtos.filter((p) => isVendaUnitaria(p) && p.tipo === 'BEBIDA') ?? [];
  const comidas = cardapio?.produtos.filter((p) => p.tipo === 'COMIDA') ?? [];

  const vendaMutation = useMutation({
    mutationFn: (pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[]) =>
      api.post<Comanda>('/api/vendas-avulsas', {
        eventoId: eventoId!,
        itens: cart.map((line) => ({
          produtoId: line.produtoId,
          volumeMl: line.volumeMl,
          quantidade: line.quantidade,
          ...(line.tapId ? { tapId: line.tapId } : {}),
        })),
        pagamentos,
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
    setPaymentForm(createDefaultPaymentForm(total));
    setShowPayment(true);
    setError('');
  };

  const handleConfirmPayment = () => {
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    vendaMutation.mutate(pagamentos);
  };

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

      <div className="card space-y-3">
        <h2 className="section-label mb-0">Itens</h2>

        <button type="button" className="touch-btn-orange w-full" onClick={() => setShowAddItem(true)}>
          + Item
        </button>

        {cart.length === 0 ? (
          <p className="text-sm text-ink-faint text-center py-2">Adicione itens para vender</p>
        ) : (
          <div className="space-y-2">
            {cart.map((line) => (
              <div
                key={line.key}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{line.produtoNome}</p>
                  <p className="text-sm text-ink-muted">
                    {formatItemDetail({
                      volumeMl: line.volumeMl,
                      quantidade: line.quantidade,
                      produto: { tipo: 'BEBIDA', formato: line.tapId ? 'CHOPE' : null },
                    })}
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
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-medium text-ink-muted">Total</span>
          <span className="text-2xl font-bold text-brand-600 tabular-nums">{formatCurrency(total)}</span>
        </div>
      </div>

      <button type="button" className="touch-btn-danger w-full" onClick={() => navigate('/comandas')}>
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
        total={total}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleConfirmPayment}
        isPending={vendaMutation.isPending}
        confirmMessage="A venda será registrada e não poderá ser editada."
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
            <div className="space-y-1">
              {closedComanda.pagamentos.map((p) => (
                <p key={p.id} className="text-ink-muted">
                  {PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}
                </p>
              ))}
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
