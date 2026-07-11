import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatTrailerLabel } from '../types';
import { useEvento } from '../contexts/EventoContext';

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function TrailerSwitcher() {
  const queryClient = useQueryClient();
  const {
    trailer,
    trailers,
    trailerId,
    eventosAbertos,
    setTrailer,
    canChangeTrailer,
  } = useEvento();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (trailers.length <= 1 || !trailerId || !trailer) return null;

  function handleSelect(id: string) {
    if (id === trailerId) {
      setOpen(false);
      return;
    }
    setTrailer(id);
    queryClient.invalidateQueries({ queryKey: ['comandas'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['ranking'] });
    setOpen(false);
  }

  if (!canChangeTrailer) {
    return (
      <div className="flex items-center min-h-10 px-3 rounded-xl border border-line bg-surface-lighter">
        <p className="text-xs text-ink-faint uppercase tracking-wide font-semibold">Trailer</p>
        <p className="text-sm font-semibold text-ink truncate ml-2">{formatTrailerLabel(trailer)}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 w-full min-h-10 px-3 rounded-xl border border-line bg-surface shadow-sm text-left active:bg-surface-lighter"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint shrink-0">Trailer</span>
        <span className="text-sm font-bold text-ink truncate flex-1">{formatTrailerLabel(trailer)}</span>
        <ChevronDownIcon className="w-5 h-5 text-ink-muted shrink-0" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Selecionar trailer"
          className="absolute z-50 left-0 right-0 mt-1 py-1 rounded-xl border border-line bg-surface shadow-lg max-h-64 overflow-y-auto"
        >
          {trailers.map((item) => {
            const aoVivo = eventosAbertos.some((e) => e.trailerId === item.id);
            const selected = item.id === trailerId;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(item.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 ${
                    selected ? 'bg-brand-50 text-brand-700' : 'hover:bg-surface-lighter'
                  }`}
                >
                  <span className="text-sm font-semibold truncate flex-1">{formatTrailerLabel(item)}</span>
                  {aoVivo && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-success shrink-0">
                      Ao vivo
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
