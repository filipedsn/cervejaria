import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';

interface ConnectionStatusProps {
  /** Admin e telas sem tempo real não precisam monitorar o socket */
  trackSocket?: boolean;
}

export function ConnectionStatus({ trackSocket = true }: ConnectionStatusProps) {
  const [online, setOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(!trackSocket);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!trackSocket) {
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    const socket = getSocket();
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketConnected(socket.connected);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [trackSocket]);

  if (online && socketConnected) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 text-center py-1 text-xs font-medium ${
        !online ? 'bg-red-600' : 'bg-yellow-600'
      }`}
    >
      {!online ? 'Sem conexão — verifique a internet' : 'Reconectando...'}
    </div>
  );
}
