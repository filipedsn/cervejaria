import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useCozinhaAlerta } from './useCozinhaAlerta';
import { usePollInterval } from './usePollInterval';
import { connectSocket, getSocket } from '../lib/socket';
import type { PedidoCozinha, StatusPedido } from '../lib/quiosque';

export const QUIOSQUE_COZINHA_QUERY_KEY = ['quiosque-cozinha'] as const;

export function useQuiosqueCozinha() {
  const { cervejaria } = useAuth();
  const queryClient = useQueryClient();
  const semeado = useRef(false);
  const pollMs = usePollInterval(20_000);

  const query = useQuery({
    queryKey: QUIOSQUE_COZINHA_QUERY_KEY,
    queryFn: () => api.get<PedidoCozinha[]>('/api/quiosque/cozinha?incluirEntregues=true'),
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

  const aguardando = naFila.filter((pedido) => pedido.status === 'RECEBIDO').length;
  const alerta = useCozinhaAlerta(aguardando);

  useEffect(() => {
    if (semeado.current || !query.data) return;
    alerta.ignorar(query.data.map((pedido) => pedido.id));
    semeado.current = true;
  }, [query.data, alerta.ignorar]);

  useEffect(() => {
    if (!cervejaria) return;

    connectSocket(cervejaria.id);
    const socket = getSocket();

    const onNovo = (pedido: PedidoCozinha) => {
      alerta.avisar(pedido.id);
      void queryClient.invalidateQueries({ queryKey: QUIOSQUE_COZINHA_QUERY_KEY });
    };
    const onAtualizado = () => {
      void queryClient.invalidateQueries({ queryKey: QUIOSQUE_COZINHA_QUERY_KEY });
    };

    socket.on('quiosque:pedido-novo', onNovo);
    socket.on('quiosque:pedido-atualizado', onAtualizado);

    return () => {
      socket.off('quiosque:pedido-novo', onNovo);
      socket.off('quiosque:pedido-atualizado', onAtualizado);
    };
  }, [cervejaria?.id, queryClient, alerta.avisar]);

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusPedido }) =>
      api.patch<PedidoCozinha>(`/api/quiosque/cozinha/${id}/status`, { status }),
    onMutate: ({ id, status }) => {
      const agora = new Date().toISOString();
      queryClient.setQueryData<PedidoCozinha[]>(QUIOSQUE_COZINHA_QUERY_KEY, (atual) =>
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUIOSQUE_COZINHA_QUERY_KEY }),
  });

  return {
    ...query,
    naFila,
    entregues,
    aguardando,
    alerta,
    mudarStatus,
    erroMutation: mudarStatus.error instanceof ApiError ? mudarStatus.error.message : null,
  };
}
