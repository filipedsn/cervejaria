import { useEffect, useState } from 'react';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  /** Inicio da contagem (criacao do pedido ou inicio do status atual). */
  startedAt: string;
  /** Quando preenchido, congela o cronometro neste instante. */
  stoppedAt?: string | null;
  className?: string;
  /** Acessibilidade: descreve o que esta sendo medido. */
  ariaLabel?: string;
}

export function PedidoElapsedTimer({ startedAt, stoppedAt, className, ariaLabel }: Props) {
  const calcular = () => {
    const fim = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
    return fim - new Date(startedAt).getTime();
  };

  const [elapsed, setElapsed] = useState(calcular);

  useEffect(() => {
    setElapsed(calcular());
    if (stoppedAt) return;

    const id = window.setInterval(() => setElapsed(calcular()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, stoppedAt]);

  return (
    <span
      className={className ?? 'text-xs font-mono tabular-nums text-ink-muted'}
      aria-label={ariaLabel ?? (stoppedAt ? 'Tempo total do pedido' : 'Tempo no status atual')}
    >
      {formatElapsed(elapsed)}
    </span>
  );
}

/** Compatibilidade com telas que ainda passam createdAt. */
export function PedidoElapsedTimerFromCreated({
  createdAt,
  className,
}: {
  createdAt: string;
  className?: string;
}) {
  return <PedidoElapsedTimer startedAt={createdAt} className={className} />;
}
