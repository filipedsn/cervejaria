export type StatusBadgeVariant =
  | 'live'
  | 'evento-fechado'
  | 'comanda-aberta'
  | 'comanda-fechada'
  | 'comanda-cancelada'
  | 'series'
  | 'inactive';

const CONFIG: Record<StatusBadgeVariant, { className: string; label: string }> = {
  live: { className: 'badge-live', label: 'Aberto' },
  'evento-fechado': { className: 'badge-closed', label: 'Fechado' },
  inactive: { className: 'badge-inactive', label: 'Fechado' },
  'comanda-aberta': { className: 'badge-open', label: 'Aberta' },
  'comanda-fechada': { className: 'badge-closed', label: 'Fechada' },
  'comanda-cancelada': { className: 'badge-inactive', label: 'Cancelada' },
  series: { className: 'badge-series', label: 'Série semanal' },
};

export function StatusBadge({
  variant,
  label,
  className,
}: {
  variant: StatusBadgeVariant;
  label?: string;
  className?: string;
}) {
  const cfg = CONFIG[variant];
  return (
    <span className={`shrink-0 ${cfg.className} ${className ?? ''}`}>
      {label ?? cfg.label}
    </span>
  );
}

export function eventoStatusVariant(status: 'ABERTO' | 'FECHADO'): StatusBadgeVariant {
  return status === 'ABERTO' ? 'live' : 'evento-fechado';
}

export function comandaStatusVariant(status: 'ABERTA' | 'FECHADA' | 'CANCELADA'): StatusBadgeVariant {
  if (status === 'ABERTA') return 'comanda-aberta';
  if (status === 'CANCELADA') return 'comanda-cancelada';
  return 'comanda-fechada';
}
