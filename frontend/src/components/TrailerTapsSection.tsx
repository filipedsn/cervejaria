import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Tap, Produto } from '../types';
import { isBebidaChope } from '../types';
import { Modal } from './Modal';
import { Loading } from './Loading';

function nextTapNumero(taps: Tap[]): number {
  if (taps.length === 0) return 1;
  return Math.max(...taps.map((t) => t.numero)) + 1;
}

function isTapNumeroEmUso(taps: Tap[], numero: number, excludeId?: string): boolean {
  return taps.some((t) => t.numero === numero && t.id !== excludeId);
}

function sortTaps(items: Tap[]) {
  return [...items].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.numero - b.numero;
  });
}

function TapModalForm({
  tap,
  taps,
  trailerId,
  chopes,
  onClose,
  onError,
}: {
  tap: Tap | null;
  taps: Tap[];
  trailerId: string;
  chopes: Produto[];
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState(() => (tap ? tap.numero : nextTapNumero(taps)));
  const [nome, setNome] = useState(() => tap?.nome ?? '');
  const [produtoId, setProdutoId] = useState(() => tap?.produtoId ?? chopes[0]?.id ?? '');
  const [numeroError, setNumeroError] = useState('');

  const numerosEmUso = taps
    .filter((t) => t.id !== tap?.id)
    .map((t) => t.numero)
    .sort((a, b) => a - b);

  const validateNumero = (value: number): string => {
    if (!Number.isFinite(value) || value < 1) return 'Informe um número válido (mínimo 1)';
    if (isTapNumeroEmUso(taps, value, tap?.id)) return `Tap ${value} já existe`;
    return '';
  };

  const handleNumeroChange = (raw: string) => {
    const value = parseInt(raw, 10);
    setNumero(Number.isFinite(value) ? value : 0);
    setNumeroError(validateNumero(value));
  };

  const save = useMutation({
    mutationFn: () => {
      const err = validateNumero(numero);
      if (err) throw new ApiError(err, 400);
      const data = {
        numero,
        nome: nome || undefined,
        produtoId,
        trailerId: tap?.trailerId ?? trailerId,
      };
      return tap ? api.put(`/api/taps/${tap.id}`, data) : api.post('/api/taps', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taps', trailerId] });
      onClose();
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : 'Erro ao salvar'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const err = validateNumero(numero);
        if (err) {
          setNumeroError(err);
          return;
        }
        save.mutate();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label">Número</label>
        <input
          type="number"
          className="input"
          value={numero || ''}
          onChange={(e) => handleNumeroChange(e.target.value)}
          required
          min={1}
        />
        {!tap && (
          <p className="text-xs text-ink-faint mt-1">
            Próximo número sugerido: {nextTapNumero(taps)}
          </p>
        )}
        {numerosEmUso.length > 0 && (
          <p className="text-xs text-ink-faint mt-1">Em uso: {numerosEmUso.join(', ')}</p>
        )}
        {numeroError && <p className="text-xs text-danger mt-1">{numeroError}</p>}
      </div>
      <div>
        <label className="label">Nome (opcional)</label>
        <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div>
        <label className="label">Chope disponível</label>
        <select
          className="input"
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          required
        >
          <option value="">Selecione o chope</option>
          {chopes.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
        <p className="text-xs text-ink-faint mt-1">
          Chope padrão deste tap. Alteração vale para eventos futuros; eventos em andamento mantêm a montagem já registrada.
        </p>
      </div>
      <button type="submit" className="touch-btn-primary w-full" disabled={save.isPending || !!numeroError || !produtoId}>
        {save.isPending ? 'Salvando...' : 'Salvar'}
      </button>
    </form>
  );
}

export function TrailerTapsSection({ trailerId }: { trailerId: string }) {
  const queryClient = useQueryClient();
  const [showTapModal, setShowTapModal] = useState(false);
  const [editingTap, setEditingTap] = useState<Tap | null>(null);
  const [error, setError] = useState('');

  const { data: taps, isLoading } = useQuery({
    queryKey: ['taps', trailerId],
    queryFn: () => api.get<Tap[]>(`/api/taps?trailerId=${trailerId}`),
    enabled: !!trailerId,
  });

  const { data: produtos } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => api.get<Produto[]>('/api/produtos'),
  });

  const chopes = produtos?.filter((p) => p.ativo && isBebidaChope(p)) ?? [];

  const toggleTapAtivo = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.patch(`/api/taps/${id}/ativo`, { ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['taps', trailerId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),
  });

  const deleteTap = useMutation({
    mutationFn: (id: string) => api.delete(`/api/taps/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['taps', trailerId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir'),
  });

  const handleToggleTap = (tap: Tap) => {
    const label = tap.nome ? `Tap ${tap.numero} — ${tap.nome}` : `Tap ${tap.numero}`;
    if (tap.ativo && !confirm(`Desativar ${label}?`)) return;
    toggleTapAtivo.mutate({ id: tap.id, ativo: !tap.ativo });
  };

  const handleDeleteTap = (tap: Tap) => {
    const label = tap.nome ? `Tap ${tap.numero} — ${tap.nome}` : `Tap ${tap.numero}`;
    if (!confirm(`Excluir ${label} permanentemente?`)) return;
    deleteTap.mutate(tap.id);
  };

  const sorted = sortTaps(taps ?? []);

  return (
    <div className="border-t border-line pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Taps</h4>
        <button
          type="button"
          className="touch-btn-primary touch-btn-sm"
          onClick={() => { setEditingTap(null); setShowTapModal(true); setError(''); }}
        >
          + Novo tap
        </button>
      </div>
      <p className="text-xs text-ink-faint">Informe qual chope cada tap serve. Durante o evento é possível trocar o barril.</p>

      {error && <div className="alert-error text-sm">{error}</div>}

      {isLoading ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-ink-faint text-center py-4">Nenhum tap instalado</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border border-line bg-surface-lighter px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 justify-between ${!t.ativo ? 'opacity-60' : ''}`}
            >
              <div>
                <p className="font-semibold">
                  Tap {t.numero}{t.nome ? ` — ${t.nome}` : ''}
                  {!t.ativo && <span className="badge-inactive ml-2">Inativo</span>}
                </p>
                <p className="text-sm text-ink-muted">{t.produto?.nome ?? 'Sem chope definido'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="touch-btn-secondary touch-btn-sm"
                  onClick={() => { setEditingTap(t); setShowTapModal(true); setError(''); }}
                >
                  Editar
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => handleToggleTap(t)}>
                  {t.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" className="touch-btn-danger touch-btn-sm" onClick={() => handleDeleteTap(t)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showTapModal}
        onClose={() => setShowTapModal(false)}
        title={editingTap ? 'Editar tap' : 'Novo tap'}
      >
        <TapModalForm
          key={editingTap?.id ?? 'new'}
          tap={editingTap}
          taps={taps ?? []}
          trailerId={trailerId}
          chopes={chopes}
          onClose={() => setShowTapModal(false)}
          onError={setError}
        />
      </Modal>
    </div>
  );
}
