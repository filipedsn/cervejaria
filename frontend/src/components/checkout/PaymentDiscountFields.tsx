import { CurrencyInput } from '../CurrencyInput';
import { formatCurrency } from '../../lib/api';

export function PaymentDiscountFields({
  inputId,
  subtotal,
  discountValue,
  discountInput,
  onDiscountChange,
  total,
  disabled,
}: {
  inputId: string;
  subtotal: number;
  discountValue: number;
  discountInput: string;
  onDiscountChange: (value: string) => void;
  total: number;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-lighter p-4 space-y-3 text-sm">
      <div className="flex justify-between text-ink-muted">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatCurrency(subtotal)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-ink-muted shrink-0">
          Desconto
        </label>
        <CurrencyInput
          id={inputId}
          className="input w-28 text-right tabular-nums py-2"
          value={discountInput}
          onChange={onDiscountChange}
          disabled={disabled}
        />
      </div>
      <div className="flex justify-between font-medium text-ink border-t border-line pt-3">
        <span>Total com desconto</span>
        <span className="tabular-nums">{formatCurrency(total)}</span>
      </div>
      {Math.abs(discountValue - subtotal) <= 0.01 && subtotal > 0 && (
        <p className="text-xs text-success">Cortesia integral — não será necessário informar pagamento.</p>
      )}
    </div>
  );
}
