import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  ensurePedidoAlertAudioRunning,
  isPedidoAlertAudioLocked,
  isPedidoAlertEnabled,
  markPedidoAlertSeen,
  playPedidoAlert,
  playPedidoAlertPreview,
  seedPedidoAlertSeenIds,
  setPedidoAlertEnabled,
  stopPedidoAlertRepeat,
  syncPedidoAlertPendingCount,
  unlockPedidoAlertAudio,
} from '../lib/pedido-alert';
import {
  isPushSupported,
  subscribePedidoPush,
  unsubscribePedidoPush,
} from '../lib/push-notifications';
import { acquireScreenWakeLock } from '../lib/screen-wake-lock';
import { connectSocket, getSocket, joinEvento } from '../lib/socket';
import type { PedidoCliente } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useEvento } from '../contexts/EventoContext';
import { useScreenWakeLock } from './useScreenWakeLock';

export type PedidoPushStatus = 'granted' | 'denied' | 'unsupported' | 'disabled' | 'unknown';

export function usePedidoAlertSound() {
  const { evento } = useEvento();
  const { cervejaria } = useAuth();
  const [alertEnabled, setAlertEnabledState] = useState(() => isPedidoAlertEnabled());
  const [audioLocked, setAudioLocked] = useState(() => isPedidoAlertAudioLocked());
  const [pushStatus, setPushStatus] = useState<PedidoPushStatus>('unknown');
  const seededRef = useRef(false);
  const pendingIdsRef = useRef(new Set<string>());
  const eventoIdRef = useRef<string | null>(null);

  const eventoAberto = evento?.status === 'ABERTO';
  const wakeLockActive = alertEnabled && eventoAberto;
  useScreenWakeLock(wakeLockActive);

  const syncAudioLockState = useCallback(() => {
    setAudioLocked(isPedidoAlertAudioLocked());
  }, []);

  const tryRestoreAlerts = useCallback(async () => {
    if (!isPedidoAlertEnabled()) return;
    syncAudioLockState();
    if (!isPedidoAlertAudioLocked()) return;
    const ok = await unlockPedidoAlertAudio();
    setAudioLocked(!ok);
    if (ok && eventoIdRef.current) {
      syncPedidoAlertPendingCount(pendingIdsRef.current.size);
    }
  }, [syncAudioLockState]);

  const refreshPendingFromApi = useCallback(async () => {
    const eventoId = eventoIdRef.current;
    if (!eventoId) return;

    try {
      const list = await api.get<PedidoCliente[]>(
        `/api/pedidos/eventos/${eventoId}/pedidos?status=PENDENTE`,
      );
      pendingIdsRef.current = new Set(list.map((p) => p.id));
      syncPedidoAlertPendingCount(pendingIdsRef.current.size, {
        onRepeatTick: () => {
          void refreshPendingFromApi();
        },
      });
    } catch {
      // Mantém contagem local se a API falhar momentaneamente.
    }
  }, []);

  const syncPendingRepeat = useCallback(
    (options?: { playNow?: boolean }) => {
      syncPedidoAlertPendingCount(pendingIdsRef.current.size, {
        ...options,
        onRepeatTick: () => {
          void refreshPendingFromApi();
        },
      });
    },
    [refreshPendingFromApi],
  );

  const syncPushSubscription = useCallback(async () => {
    if (!alertEnabled) {
      setPushStatus('unknown');
      return;
    }
    if (!isPushSupported()) {
      setPushStatus('unsupported');
      return;
    }
    const result = await subscribePedidoPush();
    setPushStatus(result);
  }, [alertEnabled]);

  useEffect(() => {
    if (!alertEnabled) return;
    void syncPushSubscription();
  }, [alertEnabled, syncPushSubscription]);

  useEffect(() => {
    if (!alertEnabled) return;

    syncAudioLockState();

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        void tryRestoreAlerts();
        if (wakeLockActive) void acquireScreenWakeLock();
      }
    };

    const onInteract = () => {
      void tryRestoreAlerts();
      if (wakeLockActive) void acquireScreenWakeLock();
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    document.addEventListener('pointerdown', onInteract, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
      document.removeEventListener('pointerdown', onInteract);
    };
  }, [alertEnabled, wakeLockActive, syncAudioLockState, tryRestoreAlerts]);

  useEffect(() => {
    seededRef.current = false;
    pendingIdsRef.current = new Set();
    eventoIdRef.current = evento?.id ?? null;
    stopPedidoAlertRepeat();

    if (!evento?.id || !eventoAberto) return;

    let cancelled = false;
    void api
      .get<PedidoCliente[]>(`/api/pedidos/eventos/${evento.id}/pedidos?status=PENDENTE`)
      .then((list) => {
        if (cancelled) return;
        pendingIdsRef.current = new Set(list.map((p) => p.id));
        seedPedidoAlertSeenIds(list.map((p) => p.id));
        seededRef.current = true;
        syncPendingRepeat();
      })
      .catch(() => {
        if (!cancelled) seededRef.current = true;
      });

    return () => {
      cancelled = true;
      stopPedidoAlertRepeat();
    };
  }, [evento?.id, eventoAberto, syncPendingRepeat]);

  useEffect(() => {
    if (!evento?.id || !eventoAberto || !cervejaria) return;

    connectSocket(cervejaria.id);
    joinEvento(evento.id);

    const socket = getSocket();

    const onPedidoCreated = (pedido: PedidoCliente) => {
      if (!seededRef.current) {
        markPedidoAlertSeen(pedido.id);
        return;
      }
      if (pendingIdsRef.current.has(pedido.id)) return;

      pendingIdsRef.current.add(pedido.id);
      void playPedidoAlert(pedido.id);
      syncPendingRepeat();
    };

    const onPedidoRemoved = (pedido: PedidoCliente) => {
      pendingIdsRef.current.delete(pedido.id);
      syncPendingRepeat();
    };

    socket.on('pedido:created', onPedidoCreated);
    socket.on('pedido:confirmed', onPedidoRemoved);
    socket.on('pedido:recusado', onPedidoRemoved);
    socket.on('pedido:cancelado', onPedidoRemoved);

    return () => {
      socket.off('pedido:created', onPedidoCreated);
      socket.off('pedido:confirmed', onPedidoRemoved);
      socket.off('pedido:recusado', onPedidoRemoved);
      socket.off('pedido:cancelado', onPedidoRemoved);
    };
  }, [evento?.id, eventoAberto, cervejaria?.id, syncPendingRepeat]);

  const togglePedidoAlert = useCallback(async () => {
    if (!alertEnabled) {
      setPedidoAlertEnabled(true);
      setAlertEnabledState(true);
      const ok = await ensurePedidoAlertAudioRunning();
      setAudioLocked(!ok);
      if (ok) await playPedidoAlertPreview();
      void acquireScreenWakeLock();
      const pushResult = await subscribePedidoPush();
      setPushStatus(pushResult);
      syncPendingRepeat();
      return;
    }

    if (audioLocked) {
      const ok = await ensurePedidoAlertAudioRunning();
      setAudioLocked(!ok);
      if (ok) await playPedidoAlertPreview();
      void acquireScreenWakeLock();
      const pushResult = await subscribePedidoPush();
      setPushStatus(pushResult);
      syncPendingRepeat();
      return;
    }

    setPedidoAlertEnabled(false);
    setAlertEnabledState(false);
    stopPedidoAlertRepeat();
    await unsubscribePedidoPush();
    setPushStatus('unknown');
  }, [alertEnabled, audioLocked, syncPendingRepeat]);

  return {
    alertEnabled,
    alertNeedsUnlock: alertEnabled && audioLocked,
    pushStatus,
    wakeLockActive,
    togglePedidoAlert,
  };
}
