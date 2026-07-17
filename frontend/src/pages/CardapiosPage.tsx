import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Cardapio, Produto } from '../types';
import { Modal } from '../components/Modal';
import { ModalFormFooter } from '../components/ModalFormFooter';
import { Loading } from '../components/Loading';
import { CardapioProdutosPicker } from '../components/CardapioProdutosPicker';

export function CardapiosPage({ embedded }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Cardapio | null>(null);
  const [nome, setNome] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const { data: cardapios, isLoading } = useQuery({
    queryKey: ['cardapios'],
    queryFn: () => api.get<Cardapio[]>('/api/cardapios'),
  });

  const { data: catalogo } = useQuery({
    queryKey: ['cardapios', 'catalogo'],
    queryFn: () => api.get<Produto[]>('/api/cardapios/catalogo'),
    enabled: showModal,
  });

  useEffect(() => {
    if (editing) {
      setNome(editing.nome);
      setSelectedIds(editing.produtoIds ?? editing.produtos?.map((p) => p.id) ?? []);
    } else {
      setNome('');
      setSelectedIds([]);
    }
  }, [editing, showModal]);

  const openCreate = () => {
    setEditing(null);
    setError('');
    setShowModal(true);
  };

  const openEdit = (cardapio: Cardapio) => {
    setEditing(cardapio);
    setError('');
    setShowModal(true);
  };

  const toggleProduto = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { nome: nome.trim(), produtoIds: selectedIds };
      return editing
        ? api.put<Cardapio>(`/api/cardapios/${editing.id}`, payload)
        : api.post<Cardapio>('/api/cardapios', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cardapios'] });
      setShowModal(false);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.patch(`/api/cardapios/${id}/ativo`, { ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cardapios'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/cardapios/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cardapios'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir'),
  });

  if (isLoading) return <Loading />;

  const sorted = [...(cardapios ?? [])].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return (
    <div className="space-y-4">
      {!embedded && <h2 className="text-xl font-bold">Cardápios</h2>}

      <button type="button" className="touch-btn-primary touch-btn-sm w-full" onClick={openCreate}>
        + Novo cardápio
      </button>

      {error && !showModal && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="space-y-3">
        {sorted.map((cardapio) => (
          <div key={cardapio.id} className={`card ${!cardapio.ativo ? 'opacity-60' : ''}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-lg">{cardapio.nome}</p>
                  {!cardapio.ativo && <span className="badge-inactive">Inativo</span>}
                </div>
                <p className="text-sm text-ink-muted mt-0.5">
                  {cardapio.itemCount ?? cardapio.produtos?.length ?? 0} item(ns)
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => openEdit(cardapio)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="touch-btn-secondary touch-btn-sm"
                  onClick={() => {
                    if (cardapio.ativo && !confirm(`Desativar "${cardapio.nome}"?`)) return;
                    toggleMutation.mutate({ id: cardapio.id, ativo: !cardapio.ativo });
                  }}
                >
                  {cardapio.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  className="touch-btn-danger touch-btn-sm"
                  onClick={() => {
                    if (!confirm(`Excluir "${cardapio.nome}" permanentemente?`)) return;
                    deleteMutation.mutate(cardapio.id);
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-sm text-ink-faint text-center py-6">Nenhum cardápio cadastrado.</p>
        )}
      </div>

      {showModal && (
        <Modal
          open
          onClose={() => setShowModal(false)}
          title={editing ? 'Editar cardápio' : 'Novo cardápio'}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nome.trim()) return;
              saveMutation.mutate();
            }}
          >
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <div>
              <label className="label">Nome</label>
              <input
                className="input"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Evento padrão"
                required
              />
            </div>
            {catalogo && (
              <CardapioProdutosPicker
                catalogo={catalogo}
                selectedIds={selectedIds}
                onToggle={toggleProduto}
              />
            )}
            <ModalFormFooter
              onCancel={() => setShowModal(false)}
              pending={saveMutation.isPending}
              disabled={!nome.trim()}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
