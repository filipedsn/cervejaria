import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, ApiError } from '../lib/api';
import type { Comanda, TapComChope, EventoCardapio, Evento } from '../types';
import { PAYMENT_LABELS, formatItemDetail, isBebidaChope, isVendaUnitaria } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import { CurrencyInput } from '../components/CurrencyInput';
import { PageHeader } from '../components/PageHeader';
import { MobileActionBar } from '../components/MobileActionBar';
import { StatusBadge, comandaStatusVariant } from '../components/StatusBadge';
import { IconTrash } from '../components/NavIcons';
import { AdicionarItemComandaModal } from '../components/AdicionarItemComandaModal';
import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../lib/currency';

type PaymentFormRow = {
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO';
  tipoCartao?: 'DEBITO' | 'CREDITO';
  valor: string;
};
const PAYMENT_FORMS: PaymentFormRow['forma'][] = ['PIX', 'DINHEIRO', 'CARTAO'];

function toPaymentForma(row: PaymentFormRow): 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' {
  if (row.forma === 'CARTAO') {
    return row.tipoCartao === 'CREDITO' ? 'CARTAO_CREDITO' : 'CARTAO_DEBITO';
  }
  return row.forma;
}

function isPaymentFormValid(form: PaymentFormRow[]) {
  return form.every((row) => row.forma !== 'CARTAO' || row.tipoCartao != null);
}

function paymentSummary(form: PaymentFormRow[], comandaTotal: number) {
  const informed = form.reduce((s, p) => s + parseCurrencyInput(p.valor), 0);
  const diff = comandaTotal - informed;
  return {
    informed,
    remaining: diff,
    isBalanced: Math.abs(diff) <= 0.01,
  };
}

function FecharComandaModal({
  open,
  onClose,
  comandaTotal,
  paymentForm,
  setPaymentForm,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  comandaTotal: number;
  paymentForm: PaymentFormRow[];
  setPaymentForm: React.Dispatch<React.SetStateAction<PaymentFormRow[]>>;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { informed, remaining, isBalanced } = paymentSummary(paymentForm, comandaTotal);
  const progress = comandaTotal > 0 ? Math.min(100, (informed / comandaTotal) * 100) : 0;

  const updateRow = (index: number, patch: Partial<PaymentFormRow>) => {
    setPaymentForm((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    setPaymentForm((rows) => rows.filter((_, i) => i !== index));
  };

  const fillRemaining = (index: number) => {
    const others = paymentForm.reduce(
      (s, p, j) => (j === index ? s : s + parseCurrencyInput(p.valor)),
      0,
    );
    const rest = Math.max(0, comandaTotal - others);
    updateRow(index, { valor: rest > 0 ? formatCurrencyInputFromNumber(rest) : '' });
  };

  const addSplit = () => {
    const usedForms = new Set(paymentForm.map((p) => p.forma));
    const nextForm = PAYMENT_FORMS.find((f) => !usedForms.has(f)) ?? 'DINHEIRO';
    const rest = Math.max(0, remaining);
    setPaymentForm([
      ...paymentForm,
      {
        forma: nextForm,
        valor: rest > 0 ? formatCurrencyInputFromNumber(rest) : '',
        tipoCartao: nextForm === 'CARTAO' ? 'DEBITO' : undefined,
      },
    ]);
  };

  return (
    <Modal open={open} onClose={onClose} title="Fechar Comanda">
      <div className="space-y-5">
        <div className="text-center">
          <p className="text-sm text-ink-muted">Total da comanda</p>
          <p className="text-3xl font-bold text-brand-600 tabular-nums">{formatCurrency(comandaTotal)}</p>
        </div>

        <div className="rounded-xl bg-surface-lighter border border-line p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Informado</span>
            <span className="font-semibold tabular-nums text-ink">{formatCurrency(informed)}</span>
          </div>
          <div className="h-2 rounded-full bg-line overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${isBalanced ? 'bg-success' : remaining > 0 ? 'bg-brand-600' : 'bg-danger'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isBalanced ? (
            <p className="text-sm font-medium text-center text-success">Pagamento completo</p>
          ) : remaining > 0 ? (
            <p className="text-sm font-medium text-center text-orange-dark tabular-nums">
              Faltam {formatCurrency(remaining)}
            </p>
          ) : (
            <p className="text-sm font-medium text-center text-danger tabular-nums">
              Excedeu {formatCurrency(Math.abs(remaining))}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {paymentForm.length > 1 ? 'Dividir pagamento' : 'Forma de pagamento'}
          </p>

          {paymentForm.map((row, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-3 space-y-3">
              {paymentForm.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-faint">Pagamento {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="touch-btn-secondary touch-btn-sm shrink-0"
                  >
                    Remover
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_FORMS.map((forma) => (
                  <button
                    key={forma}
                    type="button"
                    onClick={() =>
                      updateRow(i, {
                        forma,
                        tipoCartao: forma === 'CARTAO' ? row.tipoCartao ?? 'DEBITO' : undefined,
                      })
                    }
                    className={`min-h-11 rounded-xl text-sm font-semibold transition-colors ${
                      row.forma === forma
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface border border-line text-ink-muted'
                    }`}
                  >
                    {PAYMENT_LABELS[forma]}
                  </button>
                ))}
              </div>

              {row.forma === 'CARTAO' && (
                <div className="grid grid-cols-2 gap-2">
                  {(['DEBITO', 'CREDITO'] as const).map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      onClick={() => updateRow(i, { tipoCartao: tipo })}
                      className={`min-h-11 rounded-xl text-sm font-semibold transition-colors ${
                        row.tipoCartao === tipo
                          ? 'bg-brand-600 text-white'
                          : 'bg-surface border border-line text-ink-muted'
                      }`}
                    >
                      {tipo === 'DEBITO' ? 'Débito' : 'Crédito'}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <CurrencyInput
                  className="input flex-1"
                  value={row.valor}
                  onChange={(value) => updateRow(i, { valor: value })}
                  placeholder="R$ 0,00"
                />
                {!isBalanced && remaining > 0.01 && (
                  <button
                    type="button"
                    onClick={() => fillRemaining(i)}
                    className="shrink-0 min-h-14 px-3 rounded-xl border border-brand-200 bg-brand-50 text-brand-600 text-xs font-semibold active:scale-95"
                  >
                    Usar
                    <br />
                    restante
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {paymentForm.length < 3 && !isBalanced && (
          <button type="button" onClick={addSplit} className="touch-btn-secondary w-full min-h-12 text-sm">
            + Dividir pagamento
          </button>
        )}

        <button
          type="button"
          className="touch-btn-primary w-full"
          onClick={onConfirm}
          disabled={isPending || !isBalanced || !isPaymentFormValid(paymentForm)}
        >
          {isPending ? 'Fechando...' : `Confirmar pagamento · ${formatCurrency(comandaTotal)}`}
        </button>
      </div>
    </Modal>
  );
}

export function ComandaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento } = useEvento();

  const [showAddItem, setShowAddItem] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [closedComanda, setClosedComanda] = useState<Comanda | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([
    { forma: 'PIX', valor: '' },
  ]);
  const [error, setError] = useState('');

  const { data: comanda, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['comanda', id],
    queryFn: () => api.get<Comanda>(`/api/comandas/${id}`),
    enabled: !!id,
  });

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

  const addItemMutation = useMutation({
    mutationFn: (data: { produtoId: string; volumeMl: number; quantidade: number; tapId?: string }) =>
      api.post<Comanda>(`/api/comandas/${id}/itens`, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['comanda', id], updated);
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      setShowAddItem(false);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao adicionar item'),
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
    mutationFn: (pagamentos: { forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO'; valor: number }[]) =>
      api.post<Comanda>(`/api/pagamentos/comandas/${id}/fechar`, { pagamentos }),
    onSuccess: (data) => {
      setClosedComanda(data);
      setShowPayment(false);
      setShowReceipt(true);
      queryClient.setQueryData(['comanda', id], data);
      if (evento) queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao fechar comanda'),
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
      if (!comanda) throw new Error('Comanda não carregada');
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
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao abrir nova comanda'),
  });

  const openPayment = () => {
    if (!comanda) return;
    setPaymentForm([{ forma: 'PIX', valor: formatCurrencyInputFromNumber(comanda.total) }]);
    setShowPayment(true);
    setError('');
  };

  const handleClose = () => {
    const pagamentos = paymentForm.map((p) => ({
      forma: toPaymentForma(p),
      valor: parseCurrencyInput(p.valor),
    }));
    closeMutation.mutate(pagamentos);
  };

  const comandaTotal = comanda ? parseFloat(comanda.total) : 0;

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
        <p className="empty-state-text">Comanda não encontrada</p>
      </div>
    );
  }

  const isOpen = comanda.status === 'ABERTA';
  const isCancelled = comanda.status === 'CANCELADA';
  const eventoAberto = eventoForTaps?.status === 'ABERTO';
  const tapsComChope = taps?.filter((t) => t.ativo && t.chopeAtual && isBebidaChope(t.chopeAtual)) ?? [];
  const bebidasEmbalagem = cardapio?.produtos.filter((p) => isVendaUnitaria(p) && p.tipo === 'BEBIDA') ?? [];
  const comidas = cardapio?.produtos.filter((p) => p.tipo === 'COMIDA') ?? [];
  const hasActionBar = isOpen || !isOpen;

  return (
    <div className={`space-y-4 ${hasActionBar ? 'page-with-action-bar' : 'pb-2'}`}>

      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold min-w-0 truncate leading-tight">{comanda.cliente.nome}</h2>
          <StatusBadge variant={comandaStatusVariant(comanda.status)} />
        </div>
        {comanda.cliente.telefone && <p className="text-sm text-ink-faint mt-1">{comanda.cliente.telefone}</p>}
        <p className="text-2xl sm:text-3xl font-bold text-brand-600 mt-2 tabular-nums">{formatCurrency(comanda.total)}</p>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Itens */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="section-label">Itens</h3>
          {isOpen && (
            <button
              type="button"
              className="touch-btn-orange touch-btn-sm shrink-0"
              onClick={() => setShowAddItem(true)}
            >
              + Itens
            </button>
          )}
        </div>
        {comanda.itens.map((item) => (
          <div key={item.id} className="card flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{item.produto.nome}</p>
              <p className="text-sm text-ink-muted">{formatItemDetail(item)}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-bold tabular-nums">{formatCurrency(parseFloat(item.precoUnit) * item.quantidade)}</span>
              {isOpen && (
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
        {comanda.itens.length === 0 && (
          <p className="text-ink-faint text-center py-4">
            Nenhum item ainda. Toque em <span className="font-semibold text-orange">+ Itens</span> para adicionar.
          </p>
        )}
      </div>

      {!isOpen && (
        <div className="rounded-xl bg-surface-lighter border border-line px-4 py-3 text-sm text-ink-muted leading-relaxed">
          {isCancelled ? (
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

      {/* Pagamentos — comanda fechada */}
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

      {/* Ações fixas — comanda aberta */}
      {isOpen && comanda.itens.length > 0 && (
        <MobileActionBar>
          <button type="button" className="touch-btn-orange w-full" onClick={() => setShowAddItem(true)}>
            + Itens
          </button>
          <button type="button" className="touch-btn-primary w-full" onClick={openPayment}>
            Fechar Comanda · {formatCurrency(comanda.total)}
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/comandas')}>
            Voltar ao evento
          </button>
        </MobileActionBar>
      )}

      {isOpen && comanda.itens.length === 0 && (
        <MobileActionBar>
          <button type="button" className="touch-btn-orange w-full" onClick={() => setShowAddItem(true)}>
            + Itens
          </button>
          <p className="text-xs text-center text-ink-faint px-2">
            Sem consumação — use Encerrar comanda para cancelar.
          </p>
          <button
            type="button"
            className="touch-btn-secondary w-full"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? 'Encerrando...' : 'Encerrar comanda'}
          </button>
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/comandas')}>
            Voltar ao evento
          </button>
        </MobileActionBar>
      )}

      {/* Ações fixas — comanda fechada */}
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
                : `Nova comanda · ${comanda.cliente.nome}`}
            </button>
          )}
          <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/comandas')}>
            Voltar ao evento
          </button>
        </MobileActionBar>
      )}

      <AdicionarItemComandaModal
        open={showAddItem}
        onClose={() => setShowAddItem(false)}
        tapsComChope={tapsComChope}
        bebidas={bebidasEmbalagem}
        comidas={comidas}
        eventoAberto={!!eventoAberto}
        comandaTotal={comandaTotal}
        onAdd={(data) => addItemMutation.mutate(data)}
        isPending={addItemMutation.isPending}
        error={showAddItem ? error : undefined}
      />

      <FecharComandaModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        comandaTotal={comandaTotal}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={handleClose}
        isPending={closeMutation.isPending}
      />

      {/* Recibo */}
      <Modal open={showReceipt} onClose={() => { setShowReceipt(false); navigate('/comandas'); }} title="Comanda Fechada">
        {closedComanda && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-xl font-bold">{closedComanda.cliente.nome}</p>
            <p className="text-3xl font-bold text-brand-600">{formatCurrency(closedComanda.total)}</p>
            <div className="space-y-1">
              {closedComanda.pagamentos.map((p) => (
                <p key={p.id} className="text-ink-muted">{PAYMENT_LABELS[p.forma]}: {formatCurrency(p.valor)}</p>
              ))}
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
