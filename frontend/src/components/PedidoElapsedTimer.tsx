import { useEffect, useState } from 'react';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PedidoElapsedTimer({ createdAt, className }: { createdAt: string; className?: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(createdAt).getTime());

  useEffect(() => {
    const tick = () => setElapsed(Date.now() - new Date(createdAt).getTime());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [createdAt]);

  return (
    <span className={className ?? 'text-xs font-mono tabular-nums text-ink-muted'} aria-label="Tempo aguardando">
      {formatElapsed(elapsed)}
    </span>
  );
}
