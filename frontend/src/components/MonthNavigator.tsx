import { formatMesLabel } from '../lib/month-key';

interface MonthNavigatorProps {
  value: string;
  options: string[];
  onChange: (mes: string) => void;
}

/** Navegação de mês (◀ label ▶), mesmo padrão do Dashboard BI. */
export function MonthNavigator({ value, options, onChange }: MonthNavigatorProps) {
  const index = options.indexOf(value);
  const canOlder = index >= 0 && index < options.length - 1;
  const canNewer = index > 0;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5">
      <button
        type="button"
        onClick={() => canOlder && onChange(options[index + 1])}
        disabled={!canOlder}
        className="touch-btn-secondary touch-btn-sm min-w-11 shrink-0 px-0 text-lg disabled:opacity-30"
        aria-label="Mês anterior"
      >
        ◀
      </button>
      <div className="flex-1 min-w-0 px-1 text-center">
        <p className="font-bold text-base sm:text-lg capitalize truncate">{formatMesLabel(value)}</p>
      </div>
      <button
        type="button"
        onClick={() => canNewer && onChange(options[index - 1])}
        disabled={!canNewer}
        className="touch-btn-secondary touch-btn-sm min-w-11 shrink-0 px-0 text-lg disabled:opacity-30"
        aria-label="Próximo mês"
      >
        ▶
      </button>
    </div>
  );
}
