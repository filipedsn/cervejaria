import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatEventoWhen } from '../lib/api';
import type { RankingResponse } from '../types';
import { buildDemoRankingResponse } from '../lib/ranking-demo';
import { useRankingLiveUpdates, useRankingSocketReconnect } from '../hooks/useRankingLiveUpdates';
import { usePollInterval } from '../hooks/usePollInterval';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from '../components/Loading';
import { RankingTvView } from '../components/RankingTvView';

export function RankingFullscreenPage() {
  const { eventoId } = useParams<{ eventoId: string }>();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading } = useAuth();

  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;
  const demoData = useMemo(
    () => (isDemo ? buildDemoRankingResponse(demoCount) : null),
    [isDemo, demoCount],
  );

  useRankingLiveUpdates(eventoId, !isDemo);
  useRankingSocketReconnect(eventoId, !isDemo);
  const pollMs = usePollInterval(60_000);

  const { data: apiData, isLoading: loadingRanking, dataUpdatedAt } = useQuery({
    queryKey: ['ranking', eventoId],
    queryFn: () => api.get<RankingResponse>(`/api/ranking/evento/${eventoId}`),
    enabled: !!eventoId && !isDemo && !authLoading,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const data = isDemo ? demoData : apiData;

  if (!isDemo && (authLoading || loadingRanking)) return <Loading />;

  const subtitle = isDemo
    ? 'Simulação'
    : [data?.evento.local, data?.evento.data ? formatEventoWhen({
        data: data.evento.data,
        horaInicio: data.evento.horaInicio ?? '00:00',
        horaFim: data.evento.horaFim,
      }) : null]
        .filter(Boolean)
        .join(' · ');

  return (
    <RankingTvView
      kicker="Ranking ao vivo"
      title={data?.evento.nome ?? '...'}
      subtitle={subtitle || undefined}
      badge={isDemo ? `Simulação · ${demoCount} participantes` : undefined}
      exitTo={isDemo ? '/ranking' : `/ranking/${eventoId}`}
      entries={data?.ranking ?? []}
      lastUpdatedAt={isDemo ? Date.now() : dataUpdatedAt}
      isDemo={isDemo}
    />
  );
}
