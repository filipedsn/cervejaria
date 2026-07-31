import { useEffect, useState } from 'react';

function formatRelativeSeconds(seconds: number): string {
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds} segundos`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return 'há 1 minuto';
  if (minutes < 60) return `há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'há 1 hora' : `há ${hours} horas`;
}

export function useRelativeUpdatedAt(updatedAt: number | undefined): string {
  const [label, setLabel] = useState('aguardando...');

  useEffect(() => {
    if (!updatedAt) {
      setLabel('aguardando...');
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
      setLabel(formatRelativeSeconds(seconds));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [updatedAt]);

  return label;
}
