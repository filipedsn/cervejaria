import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { PedidoElapsedTimer } from '../../components/PedidoElapsedTimer';
import { IconBell } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useCozinhaAlerta } from '../../hooks/useCozinhaAlerta';
import { connectSocket, getSocket } from '../../lib/socket';
import { rotuloComanda, type PedidoCozinha, type StatusPedido } from '../../lib/quiosque';

const AVANCO: Partial<Record<StatusPedido, { status: StatusPedido; label: string }>> = {
  RECEBIDO: { status: 'EM_PREPARO', label: 'Iniciar preparo' },
  EM_PREPARO: { status: 'PRONTO', label: 'Pronto' },
  PRONTO: { status: 'ENTREGUE', label: 'Entregue' },
};

const VOLTA: Partial<Record<StatusPedido, StatusPedido>> = {
  EM_PREPARO: 'RECEBIDO',
  PRONTO: 'EM_PREPARO',
  ENTREGUE: 'PRONTO',
};

const BADGE: Record<string, { classe: string; label: string }> = {
  RECEBIDO: { classe: 'badge-open', label: 'Na fila' },
  EM_PREPARO: { classe: 'badge-warning', label: 'Preparando' },
  PRONTO: { classe: 'badge-live', label: 'Pronto' },
  ENTREGUE: { classe: 'badge-inactive', label: 'Entregue' },
};

const QUERY_KEY = ['quiosque-cozinha'];

export function QuiosqueCozinhaPage() {
  const { cervejaria } = useAuth();
  const queryClient = useQueryClient();
  const [verEntregues, setVerEntregues] = useState(false);
  const [erro, setErro] = useState('');
  const semeado = useRef(false);

  const { data: pedidos, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<PedidoCozinha[]>('/api/quiosque/cozinha?incluirEntregues=true'),
    // Rede de quiosque cai; o socket e o caminho normal, isto e o seguro.
    refetchInterval: 20_000,
  });

  const naFila = useMemo(
    () => (pedidos ?? []).filter((pedido) => pedido.status !== 'ENTREGUE'),
    [pedidos],
  );
  const entregues = useMemo(
    () => (pedidos ?? []).filter((pedido) => pedido.status === 'ENTREGUE').reverse(),
    [pedidos],
  );

  const aguardando = naFila.filter((pedido) => pedido.status === 'RECEBIDO').length;
  const { ativo, precisaLiberar, alternar, avisar, ignorar } = useCozinhaAlerta(aguardando);

  // O que ja estava na fila quando a tela abriu nao e novidade para apitar.
  useEffect(() => {
    if (semeado.current || !pedidos) return;
    ignorar(pedidos.map((pedido) => pedido.id));
    semeado.current = true;
  }, [pedidos, ignorar]);

  useEffect(() => {
    if (!cervejaria) return;

    connectSocket(cervejaria.id);
    const socket = getSocket();

    const onNovo = (pedido: PedidoCozinha) => {
      avisar(pedido.id);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    };
    const onAtualizado = () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    };

    socket.on('quiosque:pedido-novo', onNovo);
    socket.on('quiosque:pedido-atualizado', onAtualizado);

    return () => {
      socket.off('quiosque:pedido-novo', onNovo);
      socket.off('quiosque:pedido-atualizado', onAtualizado);
    };
  }, [cervejaria?.id, queryClient, avisar]);

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusPedido }) =>
      api.patch<PedidoCozinha>(`/api/quiosque/cozinha/${id}/status`, { status }),
    onMutate: ({ id, status }) => {
      setErro('');
      // O toque precisa responder na hora: a cozinha nao espera a rede.
      queryClient.setQueryData<PedidoCozinha[]>(QUERY_KEY, (atual) =>
        (atual ?? []).map((pedido) => (pedido.id === id ? { ...pedido, status } : pedido)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) =>
      setErro(err instanceof ApiError ? err.message : 'Não foi possível atualizar o pedido'),
  });

  if (isLoading) return <Loading />;

  const lista = verEntregues ? entregues : naFila;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <nav className="segmented-control flex-1" aria-label="Filtro da cozinha">
          <button
            type="button"
            onClick={() => setVerEntregues(false)}
            className={`segmented-control-btn ${!verEntregues ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            Na fila{naFila.length > 0 ? ` (${naFila.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setVerEntregues(true)}
            className={`segmented-control-btn ${verEntregues ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            Entregues
          </button>
        </nav>
        <button
          type="button"
          onClick={() => void alternar()}
          aria-pressed={ativo}
          aria-label={
            !ativo
              ? 'Ativar som de novos pedidos'
              : precisaLiberar
                ? 'Liberar som de novos pedidos'
                : 'Desativar som de novos pedidos'
          }
          className={`icon-btn ${
            !ativo
              ? 'bg-surface border border-line text-ink-muted'
              : precisaLiberar
                ? 'alert-warn-btn'
                : 'alert-active-btn'
          }`}
        >
          <IconBell className="w-6 h-6" strokeWidth={ativo ? 2.25 : 1.75} />
        </button>
      </div>

      {precisaLiberar && (
        <p className="text-xs text-ink-muted">
          Toque na campainha para liberar o som depois que a tela dormiu.
        </p>
      )}

      {erro && <div className="alert-error">{erro}</div>}

      {lista.length === 0 && (
        <p className="text-ink-faint text-center py-10">
          {verEntregues ? 'Nada entregue hoje ainda.' : 'Nenhum pedido na cozinha.'}
        </p>
      )}

      {lista.map((pedido, indice) => {
        const avanco = AVANCO[pedido.status];
        const volta = VOLTA[pedido.status];
        const badge = BADGE[pedido.status];

        return (
          <article
            key={pedido.id}
            className={`card !p-3 space-y-2 ${pedido.status === 'RECEBIDO' ? 'pedido-card-alert' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {!verEntregues && (
                  <span className="text-xs font-bold uppercase tracking-wide text-brand-600 shrink-0">
                    #{indice + 1}
                  </span>
                )}
                <p className="text-xl font-bold truncate">{rotuloComanda(pedido.comanda)}</p>
              </div>
              <span className={`${badge.classe} shrink-0`}>{badge.label}</span>
            </div>

            <div className="flex items-baseline gap-2">
              <PedidoElapsedTimer
                createdAt={pedido.createdAt}
                className="text-2xl font-mono font-bold tabular-nums text-orange leading-none"
              />
              <span className="text-xs text-ink-muted">senha {pedido.numero}</span>
            </div>

            <ul className="text-base space-y-0.5">
              {pedido.itens.map((item) => (
                <li key={item.id}>
                  {item.quantidade}× {item.nome}
                </li>
              ))}
            </ul>

            {pedido.observacao && (
              <p className="text-xs text-ink-muted">Obs: {pedido.observacao}</p>
            )}

            <div className="flex gap-2">
              {avanco && (
                <button
                  type="button"
                  className="touch-btn-primary flex-1 touch-btn-sm"
                  disabled={mudarStatus.isPending}
                  onClick={() => mudarStatus.mutate({ id: pedido.id, status: avanco.status })}
                >
                  {avanco.label}
                </button>
              )}
              {volta && (
                <button
                  type="button"
                  className="touch-btn-ghost"
                  disabled={mudarStatus.isPending}
                  onClick={() => mudarStatus.mutate({ id: pedido.id, status: volta })}
                >
                  Voltar
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
