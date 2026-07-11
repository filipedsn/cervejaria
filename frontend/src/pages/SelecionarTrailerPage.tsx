import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TrailerOperacional } from '../types';
import { formatTrailerLabel } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { Loading } from '../components/Loading';

export function SelecionarTrailerPage() {
  const navigate = useNavigate();
  const { setTrailer, isLoading: loadingContext } = useEvento();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: trailers, isLoading } = useQuery({
    queryKey: ['trailers', 'operacional'],
    queryFn: () => api.get<TrailerOperacional[]>('/api/trailers/operacional'),
  });

  if (isLoading || loadingContext) return <Loading fullScreen />;

  const list = trailers ?? [];

  function handleSelect(trailer: TrailerOperacional) {
    setPendingId(trailer.id);
    setTrailer(trailer.id);
    if (trailer.eventoAberto) {
      navigate('/comandas', { replace: true });
    } else {
      navigate('/eventos', { replace: true });
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <p className="text-4xl" aria-hidden>
          🚐
        </p>
        <h1 className="text-xl font-bold text-ink">Onde você vai trabalhar?</h1>
        <p className="text-sm text-ink-muted max-w-sm mx-auto">
          Escolha o trailer para esta sessão. Comandas e ranking ficam limitados a ele.
        </p>
      </div>

      <div className="space-y-3">
        {list.map((trailer) => {
          const isPending = pendingId === trailer.id;
          const aoVivo = !!trailer.eventoAberto;

          return (
            <button
              key={trailer.id}
              type="button"
              disabled={!!pendingId}
              onClick={() => handleSelect(trailer)}
              className="card w-full text-left p-4 space-y-2 active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-ink truncate">{formatTrailerLabel(trailer)}</p>
                  {trailer.eventoAberto ? (
                    <p className="text-sm text-ink-muted mt-1 truncate">
                      {trailer.eventoAberto.nome} · {trailer.eventoAberto.local}
                    </p>
                  ) : (
                    <p className="text-sm text-ink-faint mt-1">Nenhum evento ao vivo</p>
                  )}
                </div>
                {aoVivo ? (
                  <span className="badge-live shrink-0 inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    Ao vivo
                  </span>
                ) : (
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint shrink-0">
                    Sem evento
                  </span>
                )}
              </div>
              {isPending && <p className="text-xs text-brand-600 font-medium">Entrando…</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
