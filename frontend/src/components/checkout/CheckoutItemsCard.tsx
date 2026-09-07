import type { ReactNode } from 'react';
import { formatCurrency } from '../../lib/api';

export function CheckoutItemsCard({
  children,
  empty,
  total,
  onAdd,
  addLabel = '+ Item',
  canAdd = true,
}: {
  children?: ReactNode;
  empty: boolean;
  total: number;
  onAdd?: () => void;
  addLabel?: string;
  canAdd?: boolean;
}) {
  return (
    <div className="card space-y-3">
      <h2 className="section-label mb-0">Itens</h2>
      {canAdd && onAdd && (
        <button type="button" className="touch-btn-primary w-full" onClick={onAdd}>
          {addLabel}
        </button>
      )}
      {empty ? (
        <p className="text-sm text-ink-faint text-center py-2">Adicione itens para vender</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-sm font-medium text-ink-muted">Total</span>
        <span className="text-2xl font-bold text-brand-600 tabular-nums">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
