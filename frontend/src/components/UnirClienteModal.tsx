import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Cliente, ClienteListResponse } from '../types';
import { Modal } from './Modal';

function namesMatch(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'accent' }) === 0;
}

function ClienteResumoCard({
  label,
  cliente,
  variant,
}: {
  label: string;
  cliente: Cliente;
  variant: 'keep' | 'remove';
}) {
  const visitas = cliente.estatisticas?.totalComandasFechadas ?? 0;
  const gasto = cliente.estatisticas?.totalGasto ?? cliente.totalGasto ?? 0;

  return (
    <div
      className={`rounded-xl border p-3 space-y-1 ${
        variant === 'keep' ? 'border-brand-500/40 bg-brand-50/40' : 'border-line bg-surface-lighter'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="font-bold text-ink">{cliente.nome}</p>
      <p className="text-sm text-ink-muted">
        {cliente.telefone ? formatPhone(cliente.telefone) : 'Sem telefone'}
      </p>
      <p className="text-sm text-ink-muted">
        {visitas} visita{visitas === 1 ? '' : 's'} · {formatCurrency(gasto)}
      </p>
    </div>
  );
}

interface UnirClienteModalProps {
  open: boolean;
  destino: Cliente;
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (fonteId: string) => void;
}

export function UnirClienteModal({
  open,
  destino,
  pending = false,
  error = '',
  onClose,
  onConfirm,
}: UnirClienteModalProps) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Cliente | null>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setSearch('');
      setSelected(null);
      return;
    }
    const timer = window.setTimeout(() => setSearch(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q, open]);

  const initialQuery = destino.nome.trim();
  const effectiveSearch = search || (open ? initialQuery : '');

  const { data, isLoading } = useQuery({
    queryKey: ['clientes-merge-search', effectiveSearch],
    queryFn: () =>
      api.get<ClienteListResponse>(
        `/api/clientes?q=${encodeURIComponent(effectiveSearch)}&ordenar=nome&limit=20`,
      ),
    enabled: open && effectiveSearch.length > 0,
  });

  const candidates = (data?.items ?? []).filter((c) => c.id !== destino.id);

  const handleClose = () => {
    if (pending) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Unir clientes"
      footer={
        selected ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              disabled={pending}
              onClick={handleClose}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-14"
              disabled={pending}
              onClick={() => onConfirm(selected.id)}
            >
              {pending ? 'Unindo...' : 'Unir clientes'}
            </button>
          </div>
        ) : (
          <button type="button" className="touch-btn-secondary w-full min-h-14" onClick={handleClose}>
            Voltar
          </button>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted leading-relaxed">
          O cliente desta ficha será mantido. O outro será removido e todo o histórico passará para cá.
        </p>

        <ClienteResumoCard label="Manter" cliente={destino} variant="keep" />

        <div>
          <label className="label" htmlFor="unir-cliente-busca">
            Cliente a absorver
          </label>
          <input
            id="unir-cliente-busca"
            className="input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
            }}
            placeholder="Buscar por nome ou telefone..."
          />
        </div>

        {error && <div className="alert-error">{error}</div>}

        {selected && (
          <div className="space-y-2">
            <ClienteResumoCard label="Absorver e remover" cliente={selected} variant="remove" />
            <p className="text-xs text-ink-faint">
              Esta ação não pode ser desfeita. Comandas e pedidos do cliente selecionado serão transferidos.
            </p>
          </div>
        )}

        {!selected && (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {isLoading && <p className="text-sm text-ink-faint text-center py-3">Buscando...</p>}
            {!isLoading && candidates.length === 0 && effectiveSearch && (
              <p className="text-sm text-ink-faint text-center py-3">Nenhum cliente encontrado</p>
            )}
            {candidates.map((cliente) => {
              const sameName = namesMatch(cliente.nome, destino.nome);
              return (
                <button
                  key={cliente.id}
                  type="button"
                  className="w-full text-left rounded-xl border border-line bg-surface px-3 py-2.5 active:bg-surface-lighter"
                  onClick={() => setSelected(cliente)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold truncate">{cliente.nome}</p>
                    {!cliente.telefone && <span className="badge-warning shrink-0">Sem telefone</span>}
                    {sameName && <span className="badge-brand shrink-0">Mesmo nome</span>}
                  </div>
                  <p className="text-xs text-ink-faint mt-0.5 truncate">
                    {cliente.telefone ? formatPhone(cliente.telefone) : 'Sem telefone'} ·{' '}
                    {cliente.estatisticas?.totalComandasFechadas ?? 0} visita(s) ·{' '}
                    {formatCurrency(cliente.estatisticas?.totalGasto ?? cliente.totalGasto ?? 0)}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <button
            type="button"
            className="text-sm text-brand-600 underline"
            disabled={pending}
            onClick={() => setSelected(null)}
          >
            Escolher outro cliente
          </button>
        )}
      </div>
    </Modal>
  );
}
