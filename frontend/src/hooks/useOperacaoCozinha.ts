import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useCozinhaAlerta } from './useCozinhaAlerta';
import { usePollInterval } from './usePollInterval';
import { connectSocket, getSocket } from '../lib/socket';
import type { PedidoCozinha, StatusPedido } from '../lib/operacao';
import { ESTACOES, type EstacaoUi } from '../lib/estacao';

export const CAIXA_COZINHA_QUERY_KEY = ['operacao-cozinha'] as const;
export const CAIXA_BAR_QUERY_KEY = ['operacao-bar'] as const;

export function estacaoQueryKey(estacao: EstacaoUi) {
  return estacao === 'bar' ? CAIXA_BAR_QUERY_KEY : CAIXA_COZINHA_QUERY_KEY;
}

/** Fila da Cozinha (padrão) ou do Bar; mesmas regras, API e alerta próprios. */
export function useOperacaoCozinha(estacao: EstacaoUi = 'cozinha') {
  const filaQueryKey = estacaoQueryKey(estacao);
  const apiBase = ESTACOES[estacao].api;
  const { cervejaria } = useAuth();
  const queryClient = useQueryClient();
  const pedidosConhecidos = useRef<Set<string> | null>(null);
  const statusRequestsRef = useRef(new Set<string>());
  const [pedidosComStatusPendente, setPedidosComStatusPendente] = useState<Set<string>>(new Set());
  const pollMs = usePollInterval(20_000);

  const query = useQuery({
    queryKey: filaQueryKey,
    queryFn: () => api.get<PedidoCozinha[]>(`${apiBase}?incluirEntregues=true`),
    refetchInterval: pollMs,
  });

  const naFila = useMemo(
    () =>
      (query.data ?? []).filter(
        (pedido) => pedido.status !== 'ENTREGUE' && pedido.status !== 'CANCELADO',
      ).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [query.data],
  );
  const entregues = useMemo(
    () => (query.data ?? []).filter((pedido) => pedido.status === 'ENTREGUE').reverse(),
    [query.data],
  );

  const pedidosNaFila = naFila.filter((pedido) => pedido.status === 'RECEBIDO');
  const itensNaFila = pedidosNaFila.reduce(
    (total, pedido) => total + pedido.itens.reduce((subtotal, item) => subtotal + item.quantidade, 0),
    0,
  );
  const pedidosEmPreparo = naFila.filter((pedido) => pedido.status === 'EM_PREPARO');
  const emPreparo = pedidosEmPreparo
    .reduce(
      (total, pedido) => total + pedido.itens.reduce((subtotal, item) => subtotal + item.quantidade, 0),
      0,
    );
  const pedidosProntos = naFila.filter((pedido) => pedido.status === 'PRONTO');
  const prontos = pedidosProntos
    .reduce(
      (total, pedido) => total + pedido.itens.reduce((subtotal, item) => subtotal + item.quantidade, 0),
      0,
    );
  const aguardando = pedidosNaFila.length;
  const alerta = useCozinhaAlerta(aguardando, estacao);

  useEffect(() => {
    if (!query.data) return;

    const idsAtuais = new Set(query.data.map((pedido) => pedido.id));
    if (pedidosConhecidos.current === null) {
      // Ao abrir a cozinha, os pedidos que ja existem nao sao novidades.
      pedidosConhecidos.current = idsAtuais;
      alerta.ignorar([...idsAtuais]);
      return;
    }

    const novosPedidos = query.data.filter(
      (pedido) =>
        !pedidosConhecidos.current?.has(pedido.id) && pedido.status === 'RECEBIDO',
    );
    pedidosConhecidos.current = idsAtuais;
    novosPedidos.forEach((pedido) => alerta.avisar(pedido.id));
  }, [query.data, alerta.avisar, alerta.ignorar]);

  useEffect(() => {
    if (!cervejaria) return;

    connectSocket(cervejaria.id);
    const socket = getSocket();

    const onNovo = () => {
      void queryClient.invalidateQueries({ queryKey: filaQueryKey });
    };
    const onAtualizado = () => {
      void queryClient.invalidateQueries({ queryKey: filaQueryKey });
    };
    const onReconnect = () => {
      void queryClient.invalidateQueries({ queryKey: filaQueryKey });
    };

    socket.on('operacao:pedido-novo', onNovo);
    socket.on('operacao:pedido-atualizado', onAtualizado);
    socket.on('connect', onReconnect);

    return () => {
      socket.off('operacao:pedido-novo', onNovo);
      socket.off('operacao:pedido-atualizado', onAtualizado);
      socket.off('connect', onReconnect);
    };
  }, [cervejaria?.id, queryClient, alerta.avisar, filaQueryKey]);

  const mudarStatus = useMutation({
    mutationFn: ({ id, status, expectedStatus }: { id: string; status: StatusPedido; expectedStatus: StatusPedido }) =>
      api.patch<PedidoCozinha>(`${apiBase}/${id}/status`, { status, expectedStatus }),
    onSuccess: (pedidoConfirmado) => {
      queryClient.setQueryData<PedidoCozinha[]>(filaQueryKey, (atual) =>
        (atual ?? []).map((pedido) => pedido.id === pedidoConfirmado.id
          ? {
              ...pedido,
              ...pedidoConfirmado,
              comanda: {
                ...pedido.comanda,
                ...pedidoConfirmado.comanda,
                cliente: pedidoConfirmado.comanda.cliente ?? pedido.comanda.cliente,
              },
            }
          : pedido),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: filaQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['operacao-caixa'] });
      void queryClient.invalidateQueries({ queryKey: ['evento-caixa'] });
      void queryClient.invalidateQueries({ queryKey: ['operacao-estoque'] });
      void queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      void queryClient.invalidateQueries({ queryKey: ['comandas'] });
    },
  });

  const mudarStatusDoPedido = useCallback(async (input: { id: string; status: StatusPedido; expectedStatus: StatusPedido }) => {
    if (statusRequestsRef.current.has(input.id)) return false;
    statusRequestsRef.current.add(input.id);
    setPedidosComStatusPendente(new Set(statusRequestsRef.current));
    try {
      await mudarStatus.mutateAsync(input);
      return true;
    } finally {
      statusRequestsRef.current.delete(input.id);
      setPedidosComStatusPendente(new Set(statusRequestsRef.current));
    }
  }, [mudarStatus.mutateAsync]);

  const pedidoComStatusPendente = useCallback((pedidoId: string) => statusRequestsRef.current.has(pedidoId), []);

  const removerItem = useMutation({
    mutationFn: ({ comandaId, itemId, quantidade }: { comandaId: string; itemId: string; quantidade?: number }) =>
      api.delete(`/api/operacao/comandas/${comandaId}/itens/${itemId}`, quantidade ? { quantidade } : undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: filaQueryKey }),
  });

  const confirmarCancelamentoItem = useMutation({
    mutationFn: ({ pedidoId, itemId }: { pedidoId: string; itemId: string }) =>
      api.patch(`${apiBase}/${pedidoId}/itens/${itemId}/confirmar-cancelamento`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: filaQueryKey }),
  });

  return {
    ...query,
    naFila,
    entregues,
    pedidosNaFila: pedidosNaFila.length,
    itensNaFila,
    aguardando,
    pedidosEmPreparo: pedidosEmPreparo.length,
    emPreparo,
    pedidosProntos: pedidosProntos.length,
    prontos,
    alerta,
    mudarStatus,
    mudarStatusDoPedido,
    pedidosComStatusPendente,
    pedidoComStatusPendente,
    removerItem,
    confirmarCancelamentoItem,
    erroMutation: mudarStatus.error instanceof ApiError ? mudarStatus.error.message : null,
    erroItemMutation: removerItem.error instanceof ApiError ? removerItem.error.message : null,
    erroConfirmarCancelamentoItem: confirmarCancelamentoItem.error instanceof ApiError
      ? confirmarCancelamentoItem.error.message
      : null,
  };
}
