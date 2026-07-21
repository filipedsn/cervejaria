import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RankingSerieResponse } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { useRankingLiveUpdates } from '../hooks/useRankingLiveUpdates';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { RankingList } from '../components/RankingList';
import { rankingSerieTvUrl } from '../lib/ranking-tv-url';
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

export function RankingSeriePage() {
  const { serieId } = useParams<{ serieId: string }>();
  const [searchParams] = useSearchParams();
  const { evento: eventoAtivo } = useEvento();
  const initialEscopo: Escopo = searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal';
  const [escopo, setEscopo] = useState<Escopo>(initialEscopo);
  const [mes, setMes] = useState(currentMesKey);
  const alsoRefetch = useMemo(
    () => (serieId ? [{ prefix: ['ranking-serie', serieId] as const }] : []),
    [serieId],
  );

  useEffect(() => {
    setEscopo(searchParams.get('escopo') === 'geral' ? 'geral' : 'mensal');
  }, [searchParams]);

  useRankingLiveUpdates(eventoAtivo?.id, !!eventoAtivo?.id, alsoRefetch);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ranking-serie', serieId, escopo, escopo === 'mensal' ? mes : null],
    queryFn: () => {
      const query = escopo === 'mensal' && mes ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.get<RankingSerieResponse>(`/api/ranking/serie/${serieId}${query}`);
    },
    enabled: !!serieId,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data?.mesesDisponiveis.length) return;
    if (!data.mesesDisponiveis.includes(mes)) {
      setMes(data.mesesDisponiveis[0]);
    }
  }, [data?.mesesDisponiveis, mes]);

  if (!serieId) {
    return (
      <div className="card">
        <p className="text-ink-soft">Agenda não informada.</p>
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
        <p className="text-ink-soft">Não foi possível carregar o ranking da agenda.</p>
        <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block">
          Voltar aos eventos
        </Link>
      </div>
    );
  }

  const diaLabel =
    data.serie.diaSemana != null ? `Toda ${DIAS_SEMANA[data.serie.diaSemana]}` : 'Agenda fixa';

  const mesOptions =
    data.mesesDisponiveis.length > 0 ? data.mesesDisponiveis : [mes];
  const selectedMes = mesOptions.includes(mes) ? mes : mesOptions[0];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ranking da agenda"
        subtitle={`${data.serie.nome} · ${data.serie.local} · ${diaLabel}`}
        action={
          <Link to="/eventos" className="touch-btn-secondary touch-btn-sm shrink-0">
            Eventos
          </Link>
        }
      />

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`touch-btn-sm px-4 ${escopo === 'mensal' ? 'touch-btn-primary' : 'btn-outline-light'}`}
            onClick={() => setEscopo('mensal')}
          >
            Mensal
          </button>
          <button
            type="button"
            className={`touch-btn-sm px-4 ${escopo === 'geral' ? 'touch-btn-primary' : 'btn-outline-light'}`}
            onClick={() => setEscopo('geral')}
          >
            Geral
          </button>
        </div>

        {escopo === 'mensal' && (
          <label className="block space-y-1">
            <span className="text-sm text-ink-muted">Mês</span>
            <select
              className="input w-full"
              value={selectedMes}
              onChange={(e) => setMes(e.target.value)}
            >
              {mesOptions.map((option) => (
                <option key={option} value={option}>
                  {formatMesLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="text-sm text-ink-faint">
          {escopo === 'mensal'
            ? `Consumo acumulado em ${formatMesLabel(selectedMes)}.`
            : 'Consumo acumulado em todas as sessões desta agenda.'}
        </p>

        <Link
          to={rankingSerieTvUrl(serieId, escopo, escopo === 'mensal' ? selectedMes : undefined)}
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
            : 'Ninguém no ranking desta agenda ainda.'
        }
      />
    </div>
  );
}
