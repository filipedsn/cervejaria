import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useCozinhaAlerta } from './useCozinhaAlerta';
import { usePollInterval } from './usePollInterval';
import { connectSocket, getSocket } from '../lib/socket';
import type { PedidoCozinha, StatusPedido } from '../lib/operacao';

export const CAIXA_COZINHA_QUERY_KEY = ['operacao-cozinha'] as const;

export function useOperacaoCozinha() {
  const { cervejaria } = useAuth();
  const queryClient = useQueryClient();
  const pedidosConhecidos = useRef<Set<string> | null>(null);
  const pollMs = usePollInterval(20_000);

  const query = useQuery({
    queryKey: CAIXA_COZINHA_QUERY_KEY,
    queryFn: () => api.get<PedidoCozinha[]>('/api/operacao/cozinha?incluirEntregues=true'),
    refetchInterval: pollMs,
  });

  const naFila = useMemo(
    () =>
      (query.data ?? []).filter(
        (pedido) => pedido.status !== 'ENTREGUE' && pedido.status !== 'CANCELADO',
      ),
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
  const alerta = useCozinhaAlerta(aguardando);

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
      void queryClient.invalidateQueries({ queryKey: CAIXA_COZINHA_QUERY_KEY });
    };
    const onAtualizado = () => {
      void queryClient.invalidateQueries({ queryKey: CAIXA_COZINHA_QUERY_KEY });
    };

    socket.on('operacao:pedido-novo', onNovo);
    socket.on('operacao:pedido-atualizado', onAtualizado);

    return () => {
      socket.off('operacao:pedido-novo', onNovo);
      socket.off('operacao:pedido-atualizado', onAtualizado);
    };
  }, [cervejaria?.id, queryClient, alerta.avisar]);

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusPedido }) =>
      api.patch<PedidoCozinha>(`/api/operacao/cozinha/${id}/status`, { status }),
    onMutate: ({ id, status }) => {
      const agora = new Date().toISOString();
      queryClient.setQueryData<PedidoCozinha[]>(CAIXA_COZINHA_QUERY_KEY, (atual) =>
        (atual ?? []).map((pedido) => {
          if (pedido.id !== id) return pedido;
          return {
            ...pedido,
            status,
            statusDesde: agora,
            entregueEm:
              status === 'ENTREGUE'
                ? agora
                : pedido.status === 'ENTREGUE'
                  ? null
                  : pedido.entregueEm,
          };
        }),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CAIXA_COZINHA_QUERY_KEY }),
  });

  const removerItem = useMutation({
    mutationFn: ({ comandaId, itemId, quantidade }: { comandaId: string; itemId: string; quantidade?: number }) =>
      api.delete(`/api/operacao/comandas/${comandaId}/itens/${itemId}`, quantidade ? { quantidade } : undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CAIXA_COZINHA_QUERY_KEY }),
  });

  const confirmarCancelamentoItem = useMutation({
    mutationFn: ({ pedidoId, itemId }: { pedidoId: string; itemId: string }) =>
      api.patch(`/api/operacao/cozinha/${pedidoId}/itens/${itemId}/confirmar-cancelamento`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CAIXA_COZINHA_QUERY_KEY }),
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
    removerItem,
    confirmarCancelamentoItem,
    erroMutation: mudarStatus.error instanceof ApiError ? mudarStatus.error.message : null,
    erroItemMutation: removerItem.error instanceof ApiError ? removerItem.error.message : null,
    erroConfirmarCancelamentoItem: confirmarCancelamentoItem.error instanceof ApiError
      ? confirmarCancelamentoItem.error.message
      : null,
  };
}
