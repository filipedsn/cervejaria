import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency, formatMl } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Cliente, ClienteHistoricoResponse, UnirClientesResponse } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { EmptyState } from '../components/EmptyState';
import { ExcluirClienteModal } from '../components/ExcluirClienteModal';
import { UnirClienteModal } from '../components/UnirClienteModal';
import { Modal } from '../components/Modal';

const CADASTRO_LABELS: Record<string, string> = {
  STAFF: 'Equipe',
  AUTO_ATENDIMENTO: 'Auto-atendimento',
  COMANDA: 'Comanda',
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isDono } = useAuth();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [optInMarketing, setOptInMarketing] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeSuccess, setMergeSuccess] = useState('');
  const [histPage, setHistPage] = useState(1);
  const autoEditDone = useRef(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => api.get<Cliente>(`/api/clientes/${id}`),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: historico, isLoading: histLoading } = useQuery({
    queryKey: ['cliente-historico', id, histPage],
    queryFn: () =>
      api.get<ClienteHistoricoResponse>(`/api/clientes/${id}/historico?page=${histPage}&limit=10`),
    enabled: !!id,
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Cliente>(`/api/clientes/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes-list'] });
      setEditMode(false);
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/clientes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes-list'] });
      setShowDeleteModal(false);
      navigate('/clientes');
    },
    onError: (err) => {
      setShowDeleteModal(false);
      setDeleteError(err instanceof ApiError ? err.message : 'Erro ao excluir cliente');
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (fonteId: string) =>
      api.post<UnirClientesResponse>(`/api/clientes/${id}/unir`, { fonteId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['cliente-historico', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes-list'] });
      setShowMergeModal(false);
      setMergeError('');
      setMergeSuccess(
        `Cliente unido com sucesso (${data.comandasMovidas} comanda(s) transferida(s)).`,
      );
      setHistPage(1);
    },
    onError: (err) => {
      setMergeError(err instanceof ApiError ? err.message : 'Erro ao unir clientes');
    },
  });

  useEffect(() => {
    if (autoEditDone.current || searchParams.get('edit') !== '1' || !cliente) return;
    autoEditDone.current = true;
    setNome(cliente.nome);
    setTelefone(cliente.telefone ? formatPhone(cliente.telefone) : '');
    setEmail(cliente.email ?? '');
    setObservacoes(cliente.observacoes ?? '');
    setOptInMarketing(cliente.optInMarketing ?? false);
    setEditMode(true);
    setError('');
  }, [searchParams, cliente]);

  const startEdit = () => {
    if (!cliente) return;
    setNome(cliente.nome);
    setTelefone(cliente.telefone ? formatPhone(cliente.telefone) : '');
    setEmail(cliente.email ?? '');
    setObservacoes(cliente.observacoes ?? '');
    setOptInMarketing(cliente.optInMarketing ?? false);
    setEditMode(true);
    setError('');
  };

  const handleDelete = () => {
    if (!cliente) return;
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    setDeleteError('');
    deleteMutation.mutate();
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      nome: nome.trim(),
      telefone: telefone ? formatPhone(telefone) : null,
      ...(isDono
        ? {
            email: email.trim() || null,
            observacoes: observacoes.trim() || null,
            optInMarketing,
          }
        : {}),
    });
  };

  if (isLoading || !cliente) return <Loading />;

  const stats = cliente.estatisticas;

  return (
    <div className="space-y-5 pb-6">
      <PageHeader
        title={cliente.nome}
        titleExtra={!cliente.telefone ? <span className="badge-warning">Sem telefone</span> : undefined}
      />

      {mergeSuccess && <div className="alert-success">{mergeSuccess}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center">
          <p className="text-xs text-ink-muted uppercase tracking-wide">Visitas</p>
          <p className="text-2xl font-bold text-brand-600">{stats?.totalComandasFechadas ?? 0}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-ink-muted uppercase tracking-wide">Total gasto</p>
          <p className="text-2xl font-bold text-brand-600">{formatCurrency(stats?.totalGasto ?? 0)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-ink-muted uppercase tracking-wide">Chope</p>
          <p className="text-2xl font-bold">{formatMl(stats?.totalMlChope ?? 0)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-ink-muted uppercase tracking-wide">Última visita</p>
          <p className="text-sm font-semibold mt-2">{formatDateTime(stats?.ultimaVisitaEm)}</p>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Dados</h2>
          {!editMode && (
            <div className="flex gap-2">
              {isDono && (
                <button
                  type="button"
                  className="touch-btn-secondary touch-btn-sm"
                  onClick={() => {
                    setMergeError('');
                    setShowMergeModal(true);
                  }}
                >
                  Unir
                </button>
              )}
              <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => startEdit()}>
                Editar
              </button>
              {isDono && cliente.podeExcluir && (
                <button
                  type="button"
                  className="touch-btn-danger touch-btn-sm"
                  disabled={deleteMutation.isPending}
                  onClick={handleDelete}
                >
                  {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
                </button>
              )}
            </div>
          )}
        </div>

        {editMode ? (
          <form onSubmit={handleSave} className="space-y-3">
            {error && <div className="alert-error">{error}</div>}
            <div>
              <label className="label">Nome</label>
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input
                className="input"
                value={telefone}
                onChange={(e) => setTelefone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </div>
            {isDono && (
              <>
                <div>
                  <label className="label">E-mail</label>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Observações</label>
                  <textarea
                    className="input min-h-[80px]"
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={optInMarketing}
                    onChange={(e) => setOptInMarketing(e.target.checked)}
                  />
                  Aceita comunicações de marketing
                </label>
              </>
            )}
            <button type="submit" className="touch-btn-primary w-full" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </form>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2 items-center">
              <dt className="text-ink-muted">Telefone</dt>
              <dd className="flex items-center gap-2">
                {cliente.telefone ? formatPhone(cliente.telefone) : '—'}
                {!cliente.telefone && <span className="badge-warning">Sem telefone</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">E-mail</dt>
              <dd>{cliente.email || '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Origem</dt>
              <dd>{CADASTRO_LABELS[cliente.cadastradoVia ?? 'COMANDA'] ?? cliente.cadastradoVia}</dd>
            </div>
            {cliente.observacoes && (
              <div>
                <dt className="text-ink-muted mb-1">Observações</dt>
                <dd className="text-ink">{cliente.observacoes}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Cliente desde</dt>
              <dd>{formatDateTime(cliente.createdAt)}</dd>
            </div>
          </dl>
        )}

        {!editMode && isDono && !cliente.podeExcluir && cliente.motivoExclusao && (
          <p className="text-sm text-ink-muted mt-2 leading-relaxed">{cliente.motivoExclusao}</p>
        )}

        {!editMode && (
          <button
            type="button"
            className="touch-btn-danger w-full mt-2"
            onClick={() => navigate('/clientes')}
          >
            Voltar
          </button>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="font-bold text-lg">Histórico de consumo</h2>
        {histLoading && <Loading />}
        {!histLoading && historico?.items.length === 0 && (
          <EmptyState title="Nenhuma comanda fechada ainda" />
        )}
        {historico?.items.map((item) => (
          <article key={item.id} className="card space-y-2">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-semibold">{item.evento.nome}</p>
                <p className="text-xs text-ink-muted">
                  {item.evento.local} · {formatDateTime(item.fechadaEm)}
                </p>
              </div>
              <p className="font-bold text-brand-600 shrink-0">{formatCurrency(item.total)}</p>
            </div>
            <ul className="text-sm text-ink-muted space-y-0.5">
              {item.itens.map((i) => (
                <li key={i.id}>
                  {i.quantidade}x {i.produto}
                  {i.volumeMl > 1 ? ` (${i.volumeMl} ml)` : ''} — {formatCurrency(i.subtotal)}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {historico && historico.pagination.pages > 1 && (
          <div className="flex justify-between items-center gap-2">
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm"
              disabled={histPage <= 1}
              onClick={() => setHistPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span className="text-sm text-ink-muted">
              {histPage} / {historico.pagination.pages}
            </span>
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm"
              disabled={histPage >= historico.pagination.pages}
              onClick={() => setHistPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        )}
      </section>

      {editMode && (
        <button
          type="button"
          className="touch-btn-danger w-full"
          onClick={() => navigate('/clientes')}
        >
          Voltar
        </button>
      )}

      <ExcluirClienteModal
        open={showDeleteModal}
        clienteNome={cliente.nome}
        pending={deleteMutation.isPending}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmDelete}
      />

      <UnirClienteModal
        open={showMergeModal}
        destino={cliente}
        pending={mergeMutation.isPending}
        error={mergeError}
        onClose={() => {
          if (mergeMutation.isPending) return;
          setShowMergeModal(false);
          setMergeError('');
        }}
        onConfirm={(fonteId) => mergeMutation.mutate(fonteId)}
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
