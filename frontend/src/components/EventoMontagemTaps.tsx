import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TapComChope } from '../types';
import { TapEventoGrid } from './EventoTapMontagemPanel';

export function EventoMontagemTaps({
  eventoId,
  variant = 'card',
}: {
  eventoId: string;
  variant?: 'hero' | 'card';
}) {
  const { data: taps, isLoading } = useQuery({
    queryKey: ['evento-taps', eventoId],
    queryFn: () => api.get<TapComChope[]>(`/api/eventos/${eventoId}/taps`),
    enabled: !!eventoId,
  });

  if (isLoading || !taps?.length) return null;

  const label = taps.some((t) => t.montagemPrevista) ? 'Montagem prevista' : 'Chopes no evento';

  return (
    <div className="space-y-2">
      <p className={`text-xs font-bold uppercase tracking-wide ${variant === 'hero' ? 'text-white/80' : 'text-ink-muted'}`}>
        {label}
      </p>
      <TapEventoGrid taps={taps} variant={variant} />
    </div>
  );
}
