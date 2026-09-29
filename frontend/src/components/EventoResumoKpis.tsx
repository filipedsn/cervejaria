import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency } from '../lib/api';
import type { EventoDashboard } from '../types';
import { getSocket } from '../lib/socket';

function HeroStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-lighter/70 border border-line px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-ink-muted leading-tight">{label}</p>
      <p className="text-lg font-bold text-ink mt-1 truncate">{value}</p>
    </div>
  );
}

function CardStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-kpi-card !min-h-[4.75rem] py-2.5">
      <p className="section-label leading-snug text-[10px] sm:text-xs">{label}</p>
      <p className="dashboard-kpi-value">{value}</p>
    </div>
  );
}

const KPI_FIELDS = [
  { key: 'comandasAbertas' as const, label: 'Comandas abertas', format: (v: number) => String(v) },
  { key: 'comandasFechadas' as const, label: 'Comandas fechadas', format: (v: number) => String(v) },
  { key: 'vendasAvulsas' as const, label: 'Vendas avulsas', format: (v: number) => String(v) },
  { key: 'receitaAvulsa' as const, label: 'Receita avulsa', format: formatCurrency },
  { key: 'valorAberto' as const, label: 'Valor aberto', format: formatCurrency },
  { key: 'valorFechado' as const, label: 'Valor fechado', format: formatCurrency },
];

export function EventoResumoKpis({
  eventoId,
  variant = 'card',
  liveUpdates = false,
}: {
  eventoId: string;
  variant?: 'hero' | 'card';
  liveUpdates?: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', eventoId],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${eventoId}/dashboard`),
    enabled: !!eventoId,
  });

  useEffect(() => {
    if (!liveUpdates) return;

    const socket = getSocket();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] });
    };
    socket.on('comanda:created', invalidate);
    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);
    socket.on('pedido:confirmed', invalidate);
    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
      socket.off('pedido:confirmed', invalidate);
    };
  }, [eventoId, queryClient, liveUpdates]);

  const resumo = dashboard?.resumo;
  const Cell = variant === 'hero' ? HeroStatCell : CardStatCell;

  return (
    <div className={variant === 'hero' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-3 gap-2 w-full'}>
      {KPI_FIELDS.map(({ key, label, format }) => (
        <Cell
          key={key}
          label={label}
          value={resumo ? format(resumo[key]) : '—'}
        />
      ))}
    </div>
  );
}
