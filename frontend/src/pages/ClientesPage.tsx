import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Cliente, ClienteListResponse } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { EmptyState } from '../components/EmptyState';
import { ExcluirClienteModal } from '../components/ExcluirClienteModal';
import { Modal } from '../components/Modal';
import { IconPencil, IconTrash } from '../components/NavIcons';

type Ordenar = 'ultimaVisita' | 'nome' | 'totalGasto';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ClienteListItem({
  cliente,
  isDono,
  deletePending,
  onEdit,
  onDelete,
}: {
  cliente: Cliente;
  isDono: boolean;
  deletePending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const visitas = cliente.estatisticas?.totalComandasFechadas ?? 0;
  const gasto = cliente.estatisticas?.totalGasto ?? cliente.totalGasto ?? 0;
  const chopeMl = cliente.estatisticas?.totalMlChope ?? 0;

  const metaParts = [
    cliente.telefone ? formatPhone(cliente.telefone) : null,
    `${visitas} visita${visitas === 1 ? '' : 's'}`,
    chopeMl > 0 ? `${chopeMl} ml` : null,
    visitas > 0 ? `Última: ${formatDate(cliente.estatisticas?.ultimaVisitaEm)}` : null,
  ].filter(Boolean);

  return (
    <article className="card py-2.5 px-3">
      <div className="flex items-center gap-2">
        <Link to={`/clientes/${cliente.id}`} className="flex-1 min-w-0 active:opacity-80">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-bold text-base truncate">{cliente.nome}</p>
              {!cliente.telefone && <span className="badge-warning shrink-0">Sem telefone</span>}
            </div>
            <p className="font-bold text-brand-600 tabular-nums shrink-0 text-sm sm:text-base">
              {formatCurrency(gasto)}
            </p>
          </div>
          {metaParts.length > 0 && (
            <p className="text-xs text-ink-faint truncate mt-0.5">{metaParts.join(' · ')}</p>
          )}
          {(cliente.valorPendente ?? 0) > 0 && (
            <p className="mt-1 text-xs font-semibold text-orange-400">
              Saldo pendente: {formatCurrency(cliente.valorPendente ?? 0)}
            </p>
          )}
        </Link>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label={`Editar ${cliente.nome}`}
            className="icon-btn border border-line bg-surface text-ink-muted hover:text-ink hover:bg-surface-lighter"
            onClick={onEdit}
          >
            <IconPencil className="w-4 h-4" />
          </button>
          {isDono && cliente.podeExcluir && (
            <button
              type="button"
              aria-label={`Excluir ${cliente.nome}`}
              className="icon-btn-danger"
              disabled={deletePending}
              onClick={onDelete}
            >
              <IconTrash className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {isDono && !cliente.podeExcluir && cliente.motivoExclusao && (
        <p className="text-xs text-ink-faint mt-1.5 pl-0.5">{cliente.motivoExclusao}</p>
      )}
    </article>
  );
}

export function ClientesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDono } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [ordenar, setOrdenar] = useState<Ordenar>('ultimaVisita');
  const [page, setPage] = useState(1);
  const [clienteToDelete, setClienteToDelete] = useState<{ id: string; nome: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = q.trim();
      if (search === nextSearch) return;
      setSearch(nextSearch);
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [q, search]);

  const { data, error, isError, isFetching, isLoading } = useQuery({
    queryKey: ['clientes-list', search, ordenar, page],
    queryFn: () =>
      api.get<ClienteListResponse>(
        `/api/clientes?q=${encodeURIComponent(search)}&ordenar=${ordenar}&page=${page}&limit=20`,
      ),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/clientes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes-list'] });
      setDeleteError('');
      setClienteToDelete(null);
    },
    onError: (err) => {
      setClienteToDelete(null);
      setDeleteError(err instanceof ApiError ? err.message : 'Erro ao excluir cliente');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(q.trim());
    setPage(1);
  };

  const handleDeleteRequest = (clienteId: string, nome: string) => {
    setDeleteError('');
    setClienteToDelete({ id: clienteId, nome });
  };

  const confirmDelete = () => {
    if (!clienteToDelete) return;
    deleteMutation.mutate(clienteToDelete.id);
  };

  return (
    <div className="space-y-4 pb-4">
      <PageHeader title="Clientes" subtitle="Cadastro, consumo e histórico" />

      <button type="button" className="touch-btn-primary w-full" onClick={() => navigate('/clientes/novo')}>
        + Novo cliente
      </button>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Buscar nome, telefone ou e-mail..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="touch-btn-secondary touch-btn-sm shrink-0">
          Buscar
        </button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ['ultimaVisita', 'Última visita'],
            ['totalGasto', 'Maior valor recebido'],
            ['nome', 'Nome A–Z'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`touch-btn-sm shrink-0 ${ordenar === value ? 'touch-btn-primary' : 'touch-btn-secondary'}`}
            onClick={() => {
              setOrdenar(value);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && <Loading />}

      {isFetching && !isLoading && (
        <p className="text-sm text-ink-muted" role="status">Atualizando clientes...</p>
      )}

      {isError && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {error instanceof ApiError ? error.message : 'Não foi possível carregar os clientes. Tente novamente.'}
        </p>
      )}

      {!isLoading && !isError && data?.items.length === 0 && (
        <EmptyState
          icon="👤"
          title={search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description="Clientes aparecem ao abrir comandas pelo painel ou pelo QR do trailer."
        />
      )}

      <div className="space-y-2" aria-busy={isLoading || isFetching}>
        {data?.items.map((cliente) => (
          <ClienteListItem
            key={cliente.id}
            cliente={cliente}
            isDono={isDono}
            deletePending={deleteMutation.isPending}
            onEdit={() => navigate(`/clientes/${cliente.id}?edit=1`)}
            onDelete={() => handleDeleteRequest(cliente.id, cliente.nome)}
          />
        ))}
      </div>

      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            className="touch-btn-secondary touch-btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="text-sm text-ink-muted">
            Página {data.pagination.page} de {data.pagination.pages}
          </span>
          <button
            type="button"
            className="touch-btn-secondary touch-btn-sm"
            disabled={page >= data.pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}

      <ExcluirClienteModal
        open={!!clienteToDelete}
        clienteNome={clienteToDelete?.nome ?? ''}
        pending={deleteMutation.isPending}
        onClose={() => setClienteToDelete(null)}
        onConfirm={confirmDelete}
      />

      <Modal
        open={!!deleteError}
        onClose={() => setDeleteError('')}
        title="Não foi possível excluir"
        footer={
          <button
            type="button"
            className="touch-btn-primary w-full min-h-14"
            onClick={() => setDeleteError('')}
          >
            Entendi
          </button>
        }
      >
        <p className="text-ink-soft leading-relaxed">{deleteError}</p>
      </Modal>
    </div>
  );
}
