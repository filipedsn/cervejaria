import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { ClienteListResponse } from '../types';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { EmptyState } from '../components/EmptyState';

type Ordenar = 'ultimaVisita' | 'nome' | 'totalGasto';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClientesPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [ordenar, setOrdenar] = useState<Ordenar>('ultimaVisita');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['clientes-list', search, ordenar, page],
    queryFn: () =>
      api.get<ClienteListResponse>(
        `/api/clientes?q=${encodeURIComponent(search)}&ordenar=${ordenar}&page=${page}&limit=20`,
      ),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(q.trim());
    setPage(1);
  };

  return (
    <div className="space-y-4 pb-4">
      <PageHeader title="Clientes" subtitle="Cadastro, consumo e histórico" />

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
            ['totalGasto', 'Maior gasto'],
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

      {!isLoading && data?.items.length === 0 && (
        <EmptyState
          icon="👤"
          title={search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description="Clientes aparecem ao abrir comandas pelo painel ou pelo QR do trailer."
        />
      )}

      <div className="space-y-3">
        {data?.items.map((cliente) => (
          <Link
            key={cliente.id}
            to={`/clientes/${cliente.id}`}
            className="card block hover:border-brand-400/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-lg truncate">{cliente.nome}</p>
                {cliente.telefone && (
                  <p className="text-sm text-ink-muted">{formatPhone(cliente.telefone)}</p>
                )}
                <p className="text-xs text-ink-faint mt-1">
                  {cliente.estatisticas?.totalComandasFechadas ?? 0} visita(s)
                  {' · '}
                  Última: {formatDate(cliente.estatisticas?.ultimaVisitaEm)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-brand-600">
                  {formatCurrency(cliente.estatisticas?.totalGasto ?? cliente.totalGasto ?? 0)}
                </p>
                {(cliente.estatisticas?.totalMlChope ?? 0) > 0 && (
                  <p className="text-xs text-ink-faint">
                    {cliente.estatisticas!.totalMlChope} ml chope
                  </p>
                )}
              </div>
            </div>
          </Link>
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
    </div>
  );
}
