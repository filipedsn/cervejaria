import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RankingPeriodoResponse } from '../types';
import { formatTrailerLabel } from '../types';
import { buildDemoRankingResponse } from '../lib/ranking-demo';
import { useEvento } from '../contexts/EventoContext';
import { useAuth } from '../contexts/AuthContext';
import { useRankingLiveUpdates, useRankingSocketReconnect } from '../hooks/useRankingLiveUpdates';
import { usePollInterval } from '../hooks/usePollInterval';
import { Loading } from '../components/Loading';
import { RankingTvView } from '../components/RankingTvView';
import { rankingPeriodoPageUrl } from '../lib/ranking-tv-url';

type Escopo = 'mensal' | 'geral';

function currentMesKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMesLabel(mes: string): string {
  const [year, month] = mes.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function RankingPeriodoFullscreenPage() {
  const { eventoId } = useParams<{ eventoId: string }>();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading } = useAuth();
  const { evento: eventoAtivo } = useEvento();

  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;
  const escopo: Escopo = searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal';
  const mes = searchParams.get('mes') ?? currentMesKey();
  const liveEventoId = eventoAtivo?.id ?? eventoId;
  const alsoRefetch = useMemo(
    () => (eventoId ? [{ prefix: ['ranking-periodo', eventoId] as const }] : []),
    [eventoId],
  );

  useRankingLiveUpdates(liveEventoId, !isDemo && !!liveEventoId, alsoRefetch);
  useRankingSocketReconnect(liveEventoId, !isDemo);
  const pollMs = usePollInterval(60_000);

  const demoData = useMemo(
    () => (isDemo ? buildDemoRankingResponse(demoCount) : null),
    [isDemo, demoCount],
  );

  const { data: apiData, isLoading: loadingRanking, dataUpdatedAt } = useQuery({
    queryKey: ['ranking-periodo', eventoId, escopo, escopo === 'mensal' ? mes : null],
    queryFn: () => {
      const query = escopo === 'mensal' ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.get<RankingPeriodoResponse>(`/api/ranking/evento/${eventoId}/periodo${query}`);
    },
    enabled: !!eventoId && !isDemo && !authLoading,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const data = isDemo ? null : apiData;
  const entries = isDemo ? (demoData?.ranking ?? []) : (data?.entries ?? []);

  if (!isDemo && (authLoading || loadingRanking)) return <Loading />;

  const trailerLabel = data?.evento.trailer ? formatTrailerLabel(data.evento.trailer) : null;
  const subtitle = isDemo
    ? 'Simulação'
    : [
        data?.evento.local,
        trailerLabel,
        escopo === 'mensal' ? formatMesLabel(mes) : 'Todos os eventos do trailer',
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <RankingTvView
      kicker={escopo === 'mensal' ? 'Ranking mensal ao vivo' : 'Ranking geral ao vivo'}
      title={isDemo ? 'Simulação de ranking' : (data?.evento.nome ?? 'Evento')}
      subtitle={subtitle}
      badge={isDemo ? `Simulação · ${demoCount} participantes` : undefined}
      exitTo={eventoId ? rankingPeriodoPageUrl(eventoId, escopo) : '/eventos'}
      entries={entries}
      lastUpdatedAt={isDemo ? Date.now() : dataUpdatedAt}
      isDemo={isDemo}
    />
  );
}
