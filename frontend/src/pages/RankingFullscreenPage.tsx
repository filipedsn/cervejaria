import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RankingEntry } from '../types';
import { buildDemoRankingResponse } from '../lib/ranking-demo';
import { useRankingLiveUpdates, useRankingSocketReconnect } from '../hooks/useRankingLiveUpdates';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from '../components/Loading';
import { RankingTvView } from '../components/RankingTvView';

interface RankingResponse {
  evento: { id: string; nome: string; local: string; data: string | null };
  ranking: RankingEntry[];
}

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

  const { data: apiData, isLoading: loadingRanking } = useQuery({
    queryKey: ['ranking', eventoId],
    queryFn: () => api.get<RankingResponse>(`/api/ranking/evento/${eventoId}`),
    enabled: !!eventoId && !isDemo && !authLoading,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const data = isDemo ? demoData : apiData;

  if (!isDemo && (authLoading || loadingRanking)) return <Loading />;

  return (
    <RankingTvView
      kicker="Ranking do evento"
      title={data?.evento.nome ?? '...'}
      subtitle={data?.evento.local}
      badge={isDemo ? `Simulação · ${demoCount} participantes` : undefined}
      exitTo={isDemo ? '/ranking' : `/ranking/${eventoId}`}
      entries={data?.ranking ?? []}
      footerNote="Atualiza automaticamente a cada venda ou ajuste de chope neste evento"
    />
  );
}
