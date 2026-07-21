import { Link } from 'react-router-dom';
import { formatCurrency, formatMl } from '../lib/api';
import type { RankingEntry } from '../types';
import { EmptyState } from './EmptyState';

const MEDALS = ['🥇', '🥈', '🥉'];

interface RankingListProps {
  entries: RankingEntry[];
  emptyTitle?: string;
  linkToCliente?: boolean;
}

export function RankingList({
  entries,
  emptyTitle = 'Ninguém no ranking ainda. Comece a vender!',
  linkToCliente = true,
}: RankingListProps) {
  if (entries.length === 0) {
    return <EmptyState icon="🏆" title={emptyTitle} />;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={entry.clienteId}
          className={`card flex items-center gap-4 ${
            entry.posicao <= 3 ? 'border-brand-400/20 bg-brand-400/5' : ''
          }`}
        >
          <div className="text-2xl w-10 text-center">
            {entry.posicao <= 3 ? MEDALS[entry.posicao - 1] : `#${entry.posicao}`}
          </div>
          <div className="flex-1 min-w-0">
            {linkToCliente ? (
              <Link
                to={`/clientes/${entry.clienteId}`}
                className="font-bold text-lg truncate block hover:text-brand-600"
              >
                {entry.nome}
              </Link>
            ) : (
              <p className="font-bold text-lg truncate">{entry.nome}</p>
            )}
            <p className="text-sm text-ink-muted">{entry.pedidos} chopp(s)</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold text-brand-600">{formatMl(entry.totalMl)}</p>
            <p className="text-xs text-ink-faint">{formatCurrency(entry.totalValor)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
