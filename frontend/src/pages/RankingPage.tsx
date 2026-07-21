import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatEventoWhen } from '../lib/api';
import type { Evento, RankingEntry } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useRankingLiveUpdates } from '../hooks/useRankingLiveUpdates';
import { resolveRankingSerieId } from '../lib/ranking-links';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { RankingList } from '../components/RankingList';

interface RankingResponse {
  evento: {
    id: string;
    nome: string;
    local: string;
    data: string | null;
    horaInicio?: string;
    horaFim?: string | null;
    serieId?: string | null;
    trailerId?: string;
  };
  ranking: RankingEntry[];
}

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

  const { data: eventoDetalhe } = useQuery({
    queryKey: ['evento', eventoId],
    queryFn: () => api.get<Evento>(`/api/eventos/${eventoId!}`),
    enabled: !!eventoId && !data?.evento?.serieId && !eventoAtivo?.serieId && !eventoAtivo?.serie?.id,
    staleTime: 60_000,
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
  const serieId = resolveRankingSerieId(eventoId, [eventoInfo, eventoAtivo, eventoDetalhe]);
  const mensalTo = serieId
    ? `/ranking/serie/${serieId}?escopo=mensal`
    : `/ranking/periodo/${eventoId}?escopo=mensal`;
  const geralTo = serieId
    ? `/ranking/serie/${serieId}?escopo=geral`
    : `/ranking/periodo/${eventoId}?escopo=geral`;

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
      />

      <div className="space-y-2">
        <Link
          to={`/ranking/tv/${eventoId}`}
          className="touch-btn-orange w-full min-h-12 flex items-center justify-center gap-2 text-base font-bold"
        >
          <span aria-hidden>📺</span>
          Tela cheia
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <Link
            to={mensalTo}
            className="touch-btn-secondary min-h-12 flex items-center justify-center gap-2 text-sm font-semibold text-center px-2"
          >
            Ranking mensal
          </Link>
          <Link
            to={geralTo}
            className="touch-btn-secondary min-h-12 flex items-center justify-center gap-2 text-sm font-semibold text-center px-2"
          >
            Ranking geral
          </Link>
        </div>
      </div>

      <RankingList entries={data?.ranking ?? []} />
    </div>
  );
}
