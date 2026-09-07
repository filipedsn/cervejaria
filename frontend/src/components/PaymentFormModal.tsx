import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { CurrencyInput } from './CurrencyInput';
import { formatCurrency } from '../lib/api';
import { PAYMENT_LABELS } from '../types';
import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../lib/currency';

export type PaymentFormRow = {
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO';
  tipoCartao?: 'DEBITO' | 'CREDITO';
  valor: string;
};

const PAYMENT_FORMS: PaymentFormRow['forma'][] = ['PIX', 'DINHEIRO', 'CARTAO'];

export function toPaymentForma(row: PaymentFormRow): 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' {
  if (row.forma === 'CARTAO') {
    return row.tipoCartao === 'CREDITO' ? 'CARTAO_CREDITO' : 'CARTAO_DEBITO';
  }
  return row.forma;
}

export function isPaymentFormValid(form: PaymentFormRow[]) {
  return form.every((row) => row.forma !== 'CARTAO' || row.tipoCartao != null);
}

export function paymentSummary(form: PaymentFormRow[], total: number) {
  const informed = form.reduce((s, p) => s + parseCurrencyInput(p.valor), 0);
  const diff = total - informed;
  return {
    informed,
    remaining: diff,
    isBalanced: Math.abs(diff) <= 0.01,
  };
}

export function createDefaultPaymentForm(total: number): PaymentFormRow[] {
  if (total <= 0.01) return [];
  return [{ forma: 'PIX', valor: formatCurrencyInputFromNumber(total) }];
}

type PaymentStep = 'form' | 'confirm';

export function PaymentFormModal({
  open,
  onClose,
  title,
  totalLabel = 'Total',
  total,
  paymentForm,
  setPaymentForm,
  onConfirm,
  isPending,
  confirmMessage = 'A comanda será fechada e não poderá ser editada.',
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  totalLabel?: string;
  total: number;
  paymentForm: PaymentFormRow[];
  setPaymentForm: React.Dispatch<React.SetStateAction<PaymentFormRow[]>>;
  onConfirm: () => void;
  isPending: boolean;
  confirmMessage?: string;
  headerExtra?: React.ReactNode;
}) {
  const [step, setStep] = useState<PaymentStep>('form');
  const isCourtesy = total <= 0.01;
  const { informed, remaining, isBalanced } = paymentSummary(paymentForm, total);
  const progress = total > 0 ? Math.min(100, (informed / total) * 100) : 100;
  const canReview = isCourtesy
    ? paymentForm.length === 0
    : paymentForm.length > 0 && isBalanced && isPaymentFormValid(paymentForm);

  useEffect(() => {
    if (!open) setStep('form');
  }, [open]);

  const handleClose = () => {
    if (isPending) return;
    setStep('form');
    onClose();
  };

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
    const rest = Math.max(0, total - others);
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

  const modalTitle = step === 'form' ? title : isCourtesy ? 'Confirmar cortesia?' : 'Confirmar pagamento?';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={modalTitle}
      hideHeaderClose
      closeOnBackdrop={false}
      footer={
        step === 'confirm' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              disabled={isPending}
              onClick={() => setStep('form')}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-primary w-full min-h-14"
              disabled={isPending}
              onClick={onConfirm}
            >
              {isPending
                ? 'Processando...'
                : isCourtesy
                  ? 'Concluir cortesia'
                  : `Efetuar pagamento · ${formatCurrency(total)}`}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              className="touch-btn-primary w-full min-h-14"
              onClick={() => setStep('confirm')}
              disabled={isPending || !canReview}
            >
              {isCourtesy ? 'Revisar cortesia' : `Revisar pagamento · ${formatCurrency(total)}`}
            </button>
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              disabled={isPending}
              onClick={handleClose}
            >
              Fechar
            </button>
          </div>
        )
      }
    >
      {step === 'form' ? (
        <div className="space-y-5">
          {headerExtra}

          <div className="text-center">
            <p className="text-sm text-ink-muted">{totalLabel}</p>
            <p className="text-3xl font-bold text-brand-600 tabular-nums">{formatCurrency(total)}</p>
          </div>

          {isCourtesy ? (
            <div className="rounded-xl bg-surface-lighter border border-line p-4 text-center space-y-1">
              <p className="font-semibold text-success">Cortesia — sem pagamento</p>
              <p className="text-sm text-ink-muted">O desconto cobre o valor integral da venda.</p>
            </div>
          ) : (
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
          )}

          {!isCourtesy && <div className="space-y-3">
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
          </div>}

          {!isCourtesy && paymentForm.length < 3 && !isBalanced && (
            <button type="button" onClick={addSplit} className="touch-btn-secondary w-full min-h-12 text-sm">
              + Dividir pagamento
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {headerExtra}

          <div className="text-center">
            <p className="text-sm text-ink-muted">{totalLabel}</p>
            <p className="text-3xl font-bold text-brand-600 tabular-nums">{formatCurrency(total)}</p>
          </div>

          {isCourtesy ? (
            <div className="rounded-xl border border-line bg-surface-lighter px-4 py-4 text-center">
              <p className="font-semibold text-success">Cortesia — nenhum pagamento será registrado</p>
            </div>
          ) : (
          <div className="rounded-xl border border-line bg-surface-lighter divide-y divide-line">
            {paymentForm.map((row, i) => {
              const forma = toPaymentForma(row);
              const valor = parseCurrencyInput(row.valor);
              return (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium text-ink">{PAYMENT_LABELS[forma]}</span>
                  <span className="font-semibold tabular-nums text-brand-600 shrink-0">
                    {formatCurrency(valor)}
                  </span>
                </div>
              );
            })}
          </div>
          )}

          <p className="text-sm text-ink-soft leading-relaxed">{confirmMessage}</p>
        </div>
      )}
    </Modal>
  );
}
