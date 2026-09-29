import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RankingSerieResponse } from '../types';
import { buildDemoRankingResponse } from '../lib/ranking-demo';
import { useEvento } from '../contexts/EventoContext';
import { useAuth } from '../contexts/AuthContext';
import { useRankingLiveUpdates, useRankingSocketReconnect } from '../hooks/useRankingLiveUpdates';
import { usePollInterval } from '../hooks/usePollInterval';
import { Loading } from '../components/Loading';
import { RankingTvView } from '../components/RankingTvView';
import { rankingSeriePageUrl } from '../lib/ranking-tv-url';

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

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

export function RankingSerieFullscreenPage() {
  const { serieId } = useParams<{ serieId: string }>();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading } = useAuth();
  const { evento: eventoAtivo } = useEvento();

  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;
  const escopo: Escopo = searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal';
  const mes = searchParams.get('mes') ?? currentMesKey();
  const eventoId = searchParams.get('eventoId');
  const liveEventoId = eventoAtivo?.id;
  const alsoRefetch = useMemo(
    () => (serieId ? [{ prefix: ['ranking-serie', serieId] as const }] : []),
    [serieId],
  );

  useRankingLiveUpdates(liveEventoId, !isDemo && !!liveEventoId, alsoRefetch);
  useRankingSocketReconnect(liveEventoId, !isDemo);
  const pollMs = usePollInterval(60_000);

  const demoData = useMemo(
    () => (isDemo ? buildDemoRankingResponse(demoCount) : null),
    [isDemo, demoCount],
  );

  const { data: apiData, isLoading: loadingRanking, dataUpdatedAt } = useQuery({
    queryKey: ['ranking-serie', serieId, escopo, escopo === 'mensal' ? mes : null],
    queryFn: () => {
      const query = escopo === 'mensal' && mes ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.get<RankingSerieResponse>(`/api/ranking/serie/${serieId}${query}`);
    },
    enabled: !!serieId && !isDemo && !authLoading,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const data = isDemo ? null : apiData;
  const entries = isDemo ? (demoData?.ranking ?? []) : (data?.entries ?? []);

  if (!isDemo && (authLoading || loadingRanking)) return <Loading />;

  const diaLabel =
    data?.serie.diaSemana != null ? `Toda ${DIAS_SEMANA[data.serie.diaSemana]}` : 'Agenda fixa';
  const subtitle = isDemo
    ? 'Simulação'
    : [
        data?.serie.local,
        diaLabel,
        escopo === 'mensal' ? formatMesLabel(mes) : 'Histórico completo',
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <RankingTvView
      kicker={escopo === 'mensal' ? 'Ranking mensal ao vivo' : 'Ranking geral ao vivo'}
      title={isDemo ? 'Simulação de ranking' : (data?.serie.nome ?? 'Agenda')}
      subtitle={subtitle}
      badge={isDemo ? `Simulação · ${demoCount} participantes` : undefined}
      exitTo={eventoId
        ? `/ranking/${eventoId}?escopo=${escopo}${escopo === 'mensal' ? `&mes=${encodeURIComponent(mes)}` : ''}`
        : serieId ? rankingSeriePageUrl(serieId, escopo) : '/eventos'}
      entries={entries}
      lastUpdatedAt={isDemo ? Date.now() : dataUpdatedAt}
      isDemo={isDemo}
    />
  );
}
