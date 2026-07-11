import { Link } from 'react-router-dom';

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function BackToEventosLink({ className }: { className?: string }) {
  return (
    <Link
      to="/eventos"
      aria-label="Voltar para lista de eventos"
      className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl bg-brand-50 border border-line text-brand-600 active:bg-brand-100 transition-colors ${className ?? ''}`}
    >
      <ChevronLeftIcon className="w-5 h-5 shrink-0" />
      <span className="text-xs font-bold uppercase tracking-wide leading-none">Eventos</span>
    </Link>
  );
}
