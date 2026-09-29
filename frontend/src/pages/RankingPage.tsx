import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatEventoWhen } from '../lib/api';
import type {
  Evento,
  RankingEntry,
  RankingPeriodoResponse,
  RankingResponse,
  RankingSerieResponse,
} from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useRankingLiveUpdates } from '../hooks/useRankingLiveUpdates';
import { usePollInterval } from '../hooks/usePollInterval';
import { resolveRankingSerieId } from '../lib/ranking-links';
import { rankingPeriodoTvUrl, rankingSerieTvUrl } from '../lib/ranking-tv-url';
import { currentMesKey, formatMesLabel } from '../lib/month-key';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { RankingList } from '../components/RankingList';
import { MonthNavigator } from '../components/MonthNavigator';

type Escopo = 'dia' | 'mensal' | 'geral';

function parseEscopo(value: string | null): Escopo {
  return value === 'mensal' || value === 'geral' ? value : 'dia';
}

export function RankingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { evento: eventoAtivo, trailer } = useEvento();
  const { eventoId: eventoIdParam } = useParams<{ eventoId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventoId = eventoAtivo?.id ?? eventoIdParam;
  const escopo = parseEscopo(searchParams.get('escopo'));
  const [mes, setMes] = useState(searchParams.get('mes') ?? currentMesKey());

  useEffect(() => {
    if (eventoAtivo?.id && eventoIdParam !== eventoAtivo.id) {
      navigate(`/ranking/${eventoAtivo.id}${location.search}`, { replace: true });
    }
  }, [eventoAtivo?.id, eventoIdParam, location.search, navigate]);

  useEffect(() => {
    const requestedMonth = searchParams.get('mes');
    if (requestedMonth) setMes(requestedMonth);
  }, [searchParams]);

  const pollMs = usePollInterval(60_000);

  const { data, isLoading } = useQuery({
    queryKey: ['ranking', eventoId],
    queryFn: () => api.get<RankingResponse>(`/api/ranking/evento/${eventoId!}`),
    enabled: !!eventoId,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const { data: eventoDetalhe } = useQuery({
    queryKey: ['evento', eventoId],
    queryFn: () => api.get<Evento>(`/api/eventos/${eventoId!}`),
    enabled: !!eventoId && !data?.evento?.serieId && !eventoAtivo?.serieId && !eventoAtivo?.serie?.id,
    staleTime: 60_000,
  });

  const eventoInfo = data?.evento;
  const serieId = resolveRankingSerieId(eventoId ?? '', [eventoInfo, eventoAtivo, eventoDetalhe]);
  const alsoRefetch = useMemo(() => [
    ...(serieId ? [{ prefix: ['ranking-serie', serieId] as const }] : []),
    ...(eventoId ? [{ prefix: ['ranking-periodo', eventoId] as const }] : []),
  ], [eventoId, serieId]);
  useRankingLiveUpdates(eventoId, true, alsoRefetch);
  const aggregateEnabled = !!eventoId && escopo !== 'dia';
  const queryMes = escopo === 'mensal' ? mes : null;

  const { data: serieData, isLoading: serieLoading, error: serieError } = useQuery({
    queryKey: ['ranking-serie', serieId, escopo, queryMes],
    queryFn: () => {
      const query = escopo === 'mensal' ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.get<RankingSerieResponse>(`/api/ranking/serie/${serieId}${query}`);
    },
    enabled: aggregateEnabled && !!serieId,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const { data: periodoData, isLoading: periodoLoading, error: periodoError } = useQuery({
    queryKey: ['ranking-periodo', eventoId, escopo, queryMes],
    queryFn: () => {
      const query = escopo === 'mensal' ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.get<RankingPeriodoResponse>(`/api/ranking/evento/${eventoId}/periodo${query}`);
    },
    enabled: aggregateEnabled && !!eventoId && !serieId,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  const mesesDisponiveis = serieId
    ? serieData?.mesesDisponiveis ?? []
    : periodoData?.mesesDisponiveis ?? [];
  const selectedMes = mesesDisponiveis.includes(mes) ? mes : mesesDisponiveis[0] ?? mes;
  const entries: RankingEntry[] = escopo === 'dia'
    ? data?.ranking ?? []
    : serieId
      ? serieData?.entries ?? []
      : periodoData?.entries ?? [];
  const aggregateError = serieId ? serieError : periodoError;
  const aggregateIsLoading = serieId ? serieLoading : periodoLoading;
  const tvUrl = escopo === 'dia'
    ? `/ranking/tv/${eventoId}`
    : serieId
      ? rankingSerieTvUrl(serieId, escopo, escopo === 'mensal' ? selectedMes : undefined, eventoId)
      : rankingPeriodoTvUrl(eventoId ?? '', escopo, escopo === 'mensal' ? selectedMes : undefined);

  const setScope = (next: Escopo) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'dia') {
      nextParams.delete('escopo');
      nextParams.delete('mes');
    } else {
      nextParams.set('escopo', next);
      if (next === 'mensal') nextParams.set('mes', mes);
      else nextParams.delete('mes');
    }
    setSearchParams(nextParams);
  };

  const onMonthChange = (value: string) => {
    setMes(value);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('escopo', 'mensal');
    nextParams.set('mes', value);
    setSearchParams(nextParams);
  };

  if (!eventoId) {
    return (
      <EmptyState
        title={trailer ? `Nenhum evento aberto em ${trailer.nome}` : 'Selecione um evento para ver o ranking'}
        action={
          <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block">
            Ir para Eventos
          </Link>
        }
      />
    );
  }

  if (isLoading || (escopo !== 'dia' && aggregateIsLoading)) return <Loading />;

  const isMonthly = escopo === 'mensal';
  const aggregateDescription = isMonthly
    ? `Consumo acumulado em ${formatMesLabel(selectedMes)}${serieId ? '.' : ' neste trailer.'}`
    : serieId
      ? 'Consumo acumulado em todas as sessões desta agenda.'
      : 'Consumo acumulado em todos os eventos deste trailer.';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ranking"
        subtitle={
          eventoInfo
            ? `${eventoInfo.nome} · ${eventoInfo.local}${eventoInfo.data
                ? ` · ${formatEventoWhen({
                    data: eventoInfo.data,
                    horaInicio: eventoInfo.horaInicio ?? '18:00',
                    horaFim: eventoInfo.horaFim,
                    recorrencia: 'NENHUMA',
                  })}`
                : ''}`
            : undefined
        }
      />

      <div className="card space-y-3">
        <div className="segmented-control w-full">
          {(['dia', 'mensal', 'geral'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={escopo === scope}
              className={`segmented-control-btn ${escopo === scope ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
              onClick={() => setScope(scope)}
            >
              {scope === 'dia' ? 'Dia' : scope === 'mensal' ? 'Mensal' : 'Geral'}
            </button>
          ))}
        </div>

        {isMonthly && (
          <div>
            <p className="label">Mês</p>
            <MonthNavigator value={selectedMes} options={mesesDisponiveis.length ? mesesDisponiveis : [mes]} onChange={onMonthChange} />
          </div>
        )}

        {escopo !== 'dia' && <p className="text-sm text-ink-faint">{aggregateDescription}</p>}

        <Link
          to={tvUrl}
          className="touch-btn-orange w-full min-h-12 flex items-center justify-center gap-2 text-base font-bold"
        >
          <span aria-hidden>📺</span>
          Tela cheia
        </Link>
      </div>

      {aggregateError ? (
        <div className="card text-ink-soft" role="alert">
          Não foi possível carregar o ranking deste período. Tente novamente.
        </div>
      ) : (
        <RankingList
          entries={entries}
          emptyTitle={escopo === 'dia' ? undefined : 'Ninguém no ranking neste período ainda.'}
        />
      )}
    </div>
  );
}
