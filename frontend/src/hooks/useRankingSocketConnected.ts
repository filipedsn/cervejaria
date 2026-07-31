import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { connectSocket } from '../lib/socket';

/** Indica se o socket de ranking está conectado (para selo AO VIVO). */
export function useRankingSocketConnected(enabled = true): boolean {
  const { isAuthenticated, cervejaria, isLoading } = useAuth();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || isLoading || !isAuthenticated || !cervejaria?.id) {
      setConnected(false);
      return;
    }

    const socket = connectSocket(cervejaria.id);

    const sync = () => setConnected(socket.connected);
    sync();

    socket.on('connect', sync);
    socket.on('disconnect', sync);

    return () => {
      socket.off('connect', sync);
      socket.off('disconnect', sync);
    };
  }, [enabled, isLoading, isAuthenticated, cervejaria?.id]);

  return connected;
}

/** Versão para demo mode (sem auth) — considera "live" por polling. */
export function useRankingLiveIndicator(liveConnected: boolean, isDemo: boolean): boolean {
  if (isDemo) return true;
  return liveConnected;
}
