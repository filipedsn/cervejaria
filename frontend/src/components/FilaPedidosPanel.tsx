import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import type { PedidoCliente } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useAuth } from '../contexts/AuthContext';
import { connectSocket, getSocket, joinEvento } from '../lib/socket';
import { Modal } from './Modal';

function formatVolume(ml: number) {
  if (ml <= 1) return '';
  return ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`;
}

function pedidoNotFoundError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404) return true;
  return /não encontrado|nao encontrado/i.test(err.message);
}

export function FilaPedidosPanel() {
  const { evento } = useEvento();
  const { cervejaria } = useAuth();
  const queryClient = useQueryClient();
  const [recusarId, setRecusarId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const pedidosQueryKey = ['pedidos-pendentes', evento?.id] as const;

  const removePedidoFromCache = useCallback(
    (pedidoId: string) => {
      if (!evento) return;
      queryClient.setQueryData<PedidoCliente[]>(pedidosQueryKey, (old) =>
        old?.filter((p) => p.id !== pedidoId) ?? [],
      );
    },
    [evento, pedidosQueryKey, queryClient],
  );

  const { data: pedidos = [] } = useQuery({
    queryKey: pedidosQueryKey,
    queryFn: () => api.get<PedidoCliente[]>(`/api/pedidos/eventos/${evento!.id}/pedidos?status=PENDENTE`),
    enabled: !!evento,
    refetchInterval: (query) => {
      const list = query.state.data ?? [];
      return list.length > 0 ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!cervejaria) return;
    connectSocket(cervejaria.id);
  }, [cervejaria?.id]);

  useEffect(() => {
    if (!evento) return;
    joinEvento(evento.id);
  }, [evento?.id]);

  useEffect(() => {
    if (!evento) return;
    const socket = getSocket();

    const syncInBackground = () => {
      void queryClient.invalidateQueries({ queryKey: pedidosQueryKey });
      queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
    };

    const onPedidoCreated = (pedido: PedidoCliente) => {
      queryClient.setQueryData<PedidoCliente[]>(pedidosQueryKey, (old) => {
        const list = old ?? [];
        if (list.some((p) => p.id === pedido.id)) return list;
        return [...list, pedido];
      });
      void queryClient.invalidateQueries({ queryKey: pedidosQueryKey });
    };

    const onPedidoCancelado = (pedido: PedidoCliente) => {
      removePedidoFromCache(pedido.id);
      void queryClient.invalidateQueries({ queryKey: pedidosQueryKey });
    };

    const onPedidoResolved = (pedido: PedidoCliente) => {
      removePedidoFromCache(pedido.id);
      syncInBackground();
    };

    socket.on('pedido:created', onPedidoCreated);
    socket.on('pedido:confirmed', onPedidoResolved);
    socket.on('pedido:recusado', onPedidoResolved);
    socket.on('pedido:cancelado', onPedidoCancelado);

    return () => {
      socket.off('pedido:created', onPedidoCreated);
      socket.off('pedido:confirmed', onPedidoResolved);
      socket.off('pedido:recusado', onPedidoResolved);
      socket.off('pedido:cancelado', onPedidoCancelado);
    };
  }, [evento?.id, pedidosQueryKey, queryClient, removePedidoFromCache]);

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/pedidos/${id}/confirmar`, {}),
    onSuccess: (_data, id) => {
      removePedidoFromCache(id);
      queryClient.invalidateQueries({ queryKey: ['pedidos-pendentes', evento?.id] });
      queryClient.invalidateQueries({ queryKey: ['comandas', evento?.id] });
      setError('');
    },
    onError: (err, id) => {
      if (pedidoNotFoundError(err)) {
        removePedidoFromCache(id);
        setError('Pedido cancelado pelo cliente');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Erro ao confirmar');
    },
  });

  const recusarMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/api/pedidos/${id}/recusar`, { motivo }),
    onSuccess: (_data, { id }) => {
      setRecusarId(null);
      setMotivo('');
      removePedidoFromCache(id);
      queryClient.invalidateQueries({ queryKey: ['pedidos-pendentes', evento?.id] });
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao recusar'),
  });

  if (!evento || pedidos.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-lg">Pedidos do cliente</h2>
        <span className="badge-live">{pedidos.length} pendente(s)</span>
      </div>
      <p className="text-sm text-ink-muted -mt-1">
        Confirme para lançar os itens na comanda do cliente.
      </p>
      {error && <div className="alert-error">{error}</div>}
      {pedidos.map((pedido) => (
        <article key={pedido.id} className="card space-y-3 border-brand-200/50">
          <div className="flex justify-between gap-2">
            <div>
              <p className="font-bold">{pedido.cliente?.nome ?? 'Cliente'}</p>
              <p className="text-xs text-ink-muted">
                {new Date(pedido.createdAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <p className="font-bold text-brand-600">{formatCurrency(pedido.totalEstimado)}</p>
          </div>
          <ul className="text-sm space-y-0.5">
            {pedido.itens.map((item) => (
              <li key={item.id}>
                {item.quantidade}x {item.produto.nome}{' '}
                {item.volumeMl > 1 ? formatVolume(item.volumeMl) : ''}
              </li>
            ))}
          </ul>
          {pedido.observacao && (
            <p className="text-xs text-ink-muted">Obs: {pedido.observacao}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="touch-btn-primary flex-1 touch-btn-sm"
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate(pedido.id)}
            >
              Confirmar
            </button>
            <button
              type="button"
              className="touch-btn-secondary flex-1 touch-btn-sm"
              onClick={() => {
                setRecusarId(pedido.id);
                setMotivo('');
              }}
            >
              Recusar
            </button>
          </div>
        </article>
      ))}

      <Modal open={!!recusarId} onClose={() => setRecusarId(null)} title="Recusar pedido">
        <div className="space-y-3">
          <div>
            <label className="label">Motivo</label>
            <textarea
              className="input min-h-[80px]"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: item indisponível"
            />
          </div>
          <button
            type="button"
            className="touch-btn-danger w-full"
            disabled={!motivo.trim() || recusarMutation.isPending}
            onClick={() => recusarId && recusarMutation.mutate({ id: recusarId, motivo: motivo.trim() })}
          >
            Confirmar recusa
          </button>
        </div>
      </Modal>
    </section>
  );
}
