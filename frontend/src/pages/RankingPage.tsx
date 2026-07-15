import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency, formatEventoWhen, formatMl } from '../lib/api';
import type { RankingEntry } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useRankingLiveUpdates } from '../hooks/useRankingLiveUpdates';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

interface RankingResponse {
  evento: { id: string; nome: string; local: string; data: string | null; horaInicio?: string; horaFim?: string | null };
  ranking: RankingEntry[];
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function RankingPage() {
  const navigate = useNavigate();
  const { evento: eventoAtivo, trailer } = useEvento();
  const { eventoId: eventoIdParam } = useParams<{ eventoId?: string }>();
  const eventoId = eventoAtivo?.id ?? eventoIdParam;

  useEffect(() => {
    if (eventoAtivo?.id && eventoIdParam !== eventoAtivo.id) {
      navigate(`/ranking/${eventoAtivo.id}`, { replace: true });
    }
  }, [eventoAtivo?.id, eventoIdParam, navigate]);

  useRankingLiveUpdates(eventoId);

  const { data, isLoading } = useQuery({
    queryKey: ['ranking', eventoId],
    queryFn: () => api.get<RankingResponse>(`/api/ranking/evento/${eventoId!}`),
    enabled: !!eventoId,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  if (!eventoId) {
    return (
      <EmptyState
        title={
          trailer
            ? `Nenhum evento aberto em ${trailer.nome}`
            : 'Selecione um evento para ver o ranking'
        }
        action={
          <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block">
            Ir para Eventos
          </Link>
        }
      />
    );
  }

  if (isLoading) return <Loading />;

  const eventoInfo = data?.evento;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ranking"
        subtitle={
          eventoInfo
            ? `${eventoInfo.nome} · ${eventoInfo.local}${
                eventoInfo.data
                  ? ` · ${formatEventoWhen({
                      data: eventoInfo.data,
                      horaInicio: eventoInfo.horaInicio ?? '18:00',
                      horaFim: eventoInfo.horaFim,
                      recorrencia: 'NENHUMA',
                    })}`
                  : ''
              }`
            : undefined
        }
        action={
          <Link
            to={`/ranking/tv/${eventoId}`}
            className="touch-btn-secondary touch-btn-sm shrink-0"
          >
            📺 Tela cheia
          </Link>
        }
      />

      <div className="space-y-3">
        {data?.ranking.map((entry) => (
          <div
            key={entry.clienteId}
            className={`card flex items-center gap-4 ${
              entry.posicao <= 3 ? 'border-brand-400/20 bg-brand-400/5' : ''
            }`}
          >
            <div className="text-2xl w-10 text-center">
              {entry.posicao <= 3 ? MEDALS[entry.posicao - 1] : `#${entry.posicao}`}
            </div>
            <div className="flex-1 min-w-0">
              <Link to={`/clientes/${entry.clienteId}`} className="font-bold text-lg truncate block hover:text-brand-600">
                {entry.nome}
              </Link>
              <p className="text-sm text-ink-muted">{entry.pedidos} chopp(s)</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xl font-bold text-brand-600">{formatMl(entry.totalMl)}</p>
              <p className="text-xs text-ink-faint">{formatCurrency(entry.totalValor)}</p>
            </div>
          </div>
        ))}
      </div>

      {data?.ranking.length === 0 && (
        <EmptyState icon="🏆" title="Ninguém no ranking ainda. Comece a vender!" />
      )}
    </div>
  );
}
