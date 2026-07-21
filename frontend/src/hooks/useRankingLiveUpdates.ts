import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { connectSocket, getSocket, joinEvento, leaveEvento } from '../lib/socket';
import { isBebidaChope, type ProdutoTipo, type FormatoBebida } from '../types';

type RankingUpdatedPayload = { eventoId?: string };

type ComandaSocketPayload = {
  eventoId?: string;
  itens?: Array<{ produto?: { tipo: ProdutoTipo; formato: FormatoBebida | null } }>;
};

export type RankingLiveRefetchTarget =
  | { queryKey: readonly unknown[] }
  | { prefix: readonly unknown[] };

function isSameEvento(payload: ComandaSocketPayload | undefined, eventoId: string): boolean {
  return !!payload?.eventoId && payload.eventoId === eventoId;
}

function comandaHasChope(comanda: ComandaSocketPayload | undefined): boolean {
  return comanda?.itens?.some((item) => item.produto && isBebidaChope(item.produto)) ?? false;
}

function refetchRankingQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  eventoId: string | undefined,
  alsoRefetch: RankingLiveRefetchTarget[],
) {
  if (eventoId) {
    queryClient.refetchQueries({ queryKey: ['ranking', eventoId] });
  }

  for (const target of alsoRefetch) {
    if ('queryKey' in target) {
      queryClient.refetchQueries({ queryKey: [...target.queryKey] });
      continue;
    }
    queryClient.refetchQueries({
      predicate: (query) =>
        target.prefix.every((part, index) => query.queryKey[index] === part),
    });
  }
}

/** Mantém rankings sincronizados via socket (vendas/ajustes de chope). */
export function useRankingLiveUpdates(
  eventoId: string | undefined,
  enabled = true,
  alsoRefetch: RankingLiveRefetchTarget[] = [],
) {
  const queryClient = useQueryClient();
  const { isAuthenticated, cervejaria, isLoading } = useAuth();
  const alsoRefetchRef = useRef(alsoRefetch);
  alsoRefetchRef.current = alsoRefetch;

  useEffect(() => {
    if (!enabled || !eventoId || isLoading || !isAuthenticated || !cervejaria?.id) return;

    const socket = connectSocket(cervejaria.id);
    joinEvento(eventoId);

    const refetchAll = () => {
      refetchRankingQueries(queryClient, eventoId, alsoRefetchRef.current);
    };

    const onRankingUpdated = (payload?: RankingUpdatedPayload) => {
      if (!payload?.eventoId || payload.eventoId === eventoId) {
        refetchAll();
      }
    };

    const onItemAdded = (comanda?: ComandaSocketPayload) => {
      if (isSameEvento(comanda, eventoId) && comandaHasChope(comanda)) {
        refetchAll();
      }
    };

    const onItemRemoved = (comanda?: ComandaSocketPayload) => {
      if (isSameEvento(comanda, eventoId)) {
        refetchAll();
      }
    };

    socket.on('ranking:updated', onRankingUpdated);
    socket.on('item:added', onItemAdded);
    socket.on('item:removed', onItemRemoved);

    return () => {
      socket.off('ranking:updated', onRankingUpdated);
      socket.off('item:added', onItemAdded);
      socket.off('item:removed', onItemRemoved);
      leaveEvento(eventoId);
    };
  }, [enabled, eventoId, isLoading, isAuthenticated, cervejaria?.id, queryClient]);
}

/** Reconecta o socket ao voltar para a aba (útil na tela de TV). */
export function useRankingSocketReconnect(eventoId: string | undefined, enabled = true) {
  const { isAuthenticated, cervejaria, isLoading } = useAuth();

  useEffect(() => {
    if (!enabled || isLoading || !isAuthenticated || !cervejaria?.id) return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const socket = getSocket();
      connectSocket(cervejaria.id);
      if (eventoId) joinEvento(eventoId);
      if (!socket.connected) socket.connect();
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, eventoId, isLoading, isAuthenticated, cervejaria?.id]);
}
