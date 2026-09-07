import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RankingPeriodoResponse } from '../types';
import { formatTrailerLabel } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useRankingLiveUpdates } from '../hooks/useRankingLiveUpdates';
import { usePollInterval } from '../hooks/usePollInterval';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { RankingList } from '../components/RankingList';
import { MonthNavigator } from '../components/MonthNavigator';
import { rankingPeriodoTvUrl } from '../lib/ranking-tv-url';
import { currentMesKey, formatMesLabel } from '../lib/month-key';

type Escopo = 'mensal' | 'geral';

export function RankingPeriodoPage() {
  const { eventoId } = useParams<{ eventoId: string }>();
  const [searchParams] = useSearchParams();
  const { evento: eventoAtivo } = useEvento();
  const initialEscopo: Escopo = searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal';
  const [escopo, setEscopo] = useState<Escopo>(initialEscopo);
  const [mes, setMes] = useState(currentMesKey);
  const alsoRefetch = useMemo(
    () => (eventoId ? [{ prefix: ['ranking-periodo', eventoId] as const }] : []),
    [eventoId],
  );

  useEffect(() => {
    setEscopo(searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal');
  }, [searchParams]);

  useRankingLiveUpdates(eventoAtivo?.id ?? eventoId, !!(eventoAtivo?.id ?? eventoId), alsoRefetch);
  const pollMs = usePollInterval(60_000);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ranking-periodo', eventoId, escopo, escopo === 'mensal' ? mes : null],
    queryFn: () => {
      const query = escopo === 'mensal' ? `?mes=${mes}` : '';
      return api.get<RankingPeriodoResponse>(`/api/ranking/evento/${eventoId}/periodo${query}`);
    },
    enabled: !!eventoId,
    staleTime: 0,
    refetchInterval: pollMs,
  });

  useEffect(() => {
    if (!data?.mesesDisponiveis?.length) return;
    if (!data.mesesDisponiveis.includes(mes)) {
      setMes(data.mesesDisponiveis[0]);
    }
  }, [data?.mesesDisponiveis, mes]);

  if (!eventoId) {
    return (
      <div className="card">
        <p className="text-ink-soft">Evento não informado.</p>
        <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block mt-4">
          Ir para Eventos
        </Link>
      </div>
    );
  }

  if (isLoading) return <Loading />;

  if (error || !data) {
    return (
      <div className="card space-y-3">
        <p className="text-ink-soft">Não foi possível carregar o ranking.</p>
        <Link to={`/ranking/${eventoId}`} className="touch-btn-primary touch-btn-sm inline-block">
          Voltar ao ranking
        </Link>
      </div>
    );
  }

  const mesOptions = data.mesesDisponiveis.length > 0 ? data.mesesDisponiveis : [mes];
  const selectedMes = mesOptions.includes(mes) ? mes : mesOptions[0];
  const trailerLabel = data.evento.trailer ? formatTrailerLabel(data.evento.trailer) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={escopo === 'mensal' ? 'Ranking mensal' : 'Ranking geral'}
        subtitle={[
          data.evento.nome,
          data.evento.local,
          trailerLabel,
          escopo === 'mensal' ? formatMesLabel(selectedMes) : 'Todos os eventos do trailer',
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="card space-y-3">
        <div className="segmented-control w-full">
          <Link
            to={`/ranking/${eventoId}`}
            className="segmented-control-btn segmented-control-btn-inactive"
          >
            Dia
          </Link>
          <Link
            to={`/ranking/periodo/${eventoId}?escopo=mensal`}
            className={`segmented-control-btn ${
              escopo === 'mensal' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Mensal
          </Link>
          <Link
            to={`/ranking/periodo/${eventoId}?escopo=geral`}
            className={`segmented-control-btn ${
              escopo === 'geral' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Geral
          </Link>
        </div>

        {escopo === 'mensal' && (
          <div>
            <p className="label">Mês</p>
            <MonthNavigator
              value={selectedMes}
              options={mesOptions}
              onChange={setMes}
            />
          </div>
        )}

        <p className="text-sm text-ink-faint">
          {escopo === 'mensal'
            ? `Consumo acumulado em ${formatMesLabel(selectedMes)} neste trailer.`
            : 'Consumo acumulado em todos os eventos deste trailer.'}
        </p>

        <Link
          to={rankingPeriodoTvUrl(eventoId, escopo, escopo === 'mensal' ? selectedMes : undefined)}
          className="touch-btn-orange w-full min-h-12 flex items-center justify-center gap-2 text-base font-bold"
        >
          <span aria-hidden>📺</span>
          Tela cheia
        </Link>
      </div>

      <RankingList
        entries={data.entries}
        emptyTitle={
          escopo === 'mensal'
            ? 'Ninguém no ranking neste mês ainda.'
            : 'Ninguém no ranking deste trailer ainda.'
        }
      />
    </div>
  );
}
