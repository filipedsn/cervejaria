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

export function BackLink({ to, label = 'Voltar', className }: { to: string; label?: string; className?: string }) {
  return (
    <Link to={to} className={`touch-btn-secondary touch-btn-sm inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <ChevronLeftIcon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}
