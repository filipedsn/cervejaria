import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Trailer } from '../types';
import { formatTrailerLabel } from '../types';
import { Modal } from '../components/Modal';
import { Loading } from '../components/Loading';
import { TrailerTapsSection } from '../components/TrailerTapsSection';
import { TrailerPortalQr } from '../components/TrailerPortalQr';

function sortByActiveThenName(items: Trailer[]) {
  return [...items].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export function TrailersPage({ embedded }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Trailer | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ nome: '', identificador: '' });

  const { data: trailers, isLoading } = useQuery({
    queryKey: ['trailers'],
    queryFn: () => api.get<Trailer[]>('/api/trailers'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ nome: '', identificador: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (trailer: Trailer) => {
    setEditing(trailer);
    setForm({ nome: trailer.nome, identificador: trailer.identificador ?? '' });
    setError('');
    setShowModal(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const data = {
        nome: form.nome,
        identificador: form.identificador || undefined,
      };
      return editing
        ? api.put<Trailer>(`/api/trailers/${editing.id}`, data)
        : api.post<Trailer>('/api/trailers', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trailers'] });
      setShowModal(false);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.patch(`/api/trailers/${id}/ativo`, { ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trailers'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/trailers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trailers'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir'),
  });

  const handleToggle = (trailer: Trailer) => {
    const label = formatTrailerLabel(trailer);
    if (trailer.ativo && !confirm(`Desativar "${label}"? Eventos futuros não poderão usá-lo.`)) return;
    toggleMutation.mutate({ id: trailer.id, ativo: !trailer.ativo });
  };

  const handleDelete = (trailer: Trailer) => {
    const label = formatTrailerLabel(trailer);
    if (!confirm(`Excluir "${label}" permanentemente? Taps deste trailer também serão removidos.`)) return;
    deleteMutation.mutate(trailer.id);
  };

  if (isLoading) return <Loading />;

  const sorted = sortByActiveThenName(trailers ?? []);

  return (
    <div className="space-y-4">
      {!embedded && <h2 className="text-xl font-bold">Trailers</h2>}

      <button type="button" className="touch-btn-primary touch-btn-sm w-full" onClick={openCreate}>
        + Novo trailer
      </button>

      <div className="space-y-3">
        {sorted.map((trailer) => (
          <div
            key={trailer.id}
            className={`card space-y-0 ${!trailer.ativo ? 'opacity-60' : ''}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-lg">{formatTrailerLabel(trailer)}</p>
                  {!trailer.ativo && <span className="badge-inactive">Inativo</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => openEdit(trailer)}>
                  Editar
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => handleToggle(trailer)}>
                  {trailer.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" className="touch-btn-danger touch-btn-sm" onClick={() => handleDelete(trailer)}>
                  Excluir
                </button>
              </div>
            </div>
            <TrailerTapsSection trailerId={trailer.id} />
            <TrailerPortalQr trailer={trailer} />
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-ink-faint text-center py-8">Nenhum trailer cadastrado</p>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar trailer' : 'Novo trailer'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="space-y-4"
        >
          {error && <div className="alert-error">{error}</div>}
          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex: Principal, Reserva..."
              required
            />
          </div>
          <div>
            <label className="label">Identificador (opcional)</label>
            <input
              className="input"
              value={form.identificador}
              onChange={(e) => setForm({ ...form, identificador: e.target.value })}
              placeholder="Placa ou apelido"
            />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </Modal>

      {error && !showModal && <div className="alert-error">{error}</div>}
    </div>
  );
}
