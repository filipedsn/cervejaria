import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useOperacaoContexto } from '../hooks/useOperacaoContexto';
import { usePollInterval } from '../hooks/usePollInterval';
import { currentMesKey, formatMesLabel } from '../lib/month-key';
import type { RankingPdvPeriodoResponse, RankingPdvResponse } from '../types';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';
import { MonthNavigator } from '../components/MonthNavigator';
import { PageHeader } from '../components/PageHeader';
import { RankingList } from '../components/RankingList';
import type { CaixaResposta } from '../lib/operacao';

type Escopo = 'dia' | 'mensal' | 'geral';
type Ocorrencia = { id: string; nome: string; data: string; status: string };

function operationDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function shiftDay(day: string, offset: number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function parseEscopo(value: string | null): Escopo {
  return value === 'mensal' || value === 'geral' ? value : 'dia';
}

export function RankingPdvPage() {
  const { contexto, isResolved } = useOperacaoContexto();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mes, setMes] = useState(searchParams.get('mes') ?? currentMesKey());
  const escopo = parseEscopo(searchParams.get('escopo'));
  const dia = searchParams.get('dia') ?? operationDay();
  const pointId = searchParams.get('pontoVendaId') ?? contexto.pontosVenda.find((point) => point.ativo)?.id ?? '';
  const point = contexto.pontosVenda.find((candidate) => candidate.id === pointId && candidate.ativo);
  const pollMs = usePollInterval(60_000);
  const range = useMemo(() => ({ inicio: shiftDay(operationDay(), -180), fim: shiftDay(operationDay(), 180) }), []);

  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', pointId],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${encodeURIComponent(pointId)}`),
    enabled: Boolean(pointId),
    refetchInterval: pollMs,
  });
  const occurrenceId = searchParams.has('ocorrenciaId')
    ? searchParams.get('ocorrenciaId') ?? ''
    : caixaQuery.data?.sessao?.ocorrenciaId ?? '';

  const occurrencesQuery = useQuery({
    queryKey: ['ranking-pdv-occurrences', pointId, range.inicio, range.fim],
    queryFn: () => api.get<{ ocorrencias: Ocorrencia[] }>(`/api/operacao/agenda/ocorrencias?inicio=${range.inicio}&fim=${range.fim}`),
    enabled: Boolean(pointId && contexto.tapsEnabled),
  });
  const occurrences = (occurrencesQuery.data?.ocorrencias ?? []).filter((item) => item.status !== 'CANCELADA');
  const selectedOccurrence = occurrences.find((item) => item.id === occurrenceId);

  const rankingQuery = useQuery({
    queryKey: ['ranking-pdv', pointId, dia, occurrenceId],
    queryFn: () => {
      const query = new URLSearchParams({ dia });
      if (occurrenceId) query.set('ocorrenciaId', occurrenceId);
      return api.get<RankingPdvResponse>(`/api/ranking/pdv/${encodeURIComponent(pointId)}?${query}`);
    },
    enabled: Boolean(pointId && escopo === 'dia' && contexto.tapsEnabled),
    refetchInterval: pollMs,
    staleTime: 0,
  });
  const periodQuery = useQuery({
    queryKey: ['ranking-pdv-period', pointId, escopo, escopo === 'mensal' ? mes : null],
    queryFn: () => {
      const query = new URLSearchParams();
      if (escopo === 'mensal') query.set('mes', mes);
      return api.get<RankingPdvPeriodoResponse>(`/api/ranking/pdv/${encodeURIComponent(pointId)}/periodo${query.size ? `?${query}` : ''}`);
    },
    enabled: Boolean(pointId && escopo !== 'dia' && contexto.tapsEnabled),
    refetchInterval: pollMs,
    staleTime: 0,
  });

  const updateParams = (next: { escopo?: Escopo; dia?: string; mes?: string; ocorrenciaId?: string | null }) => {
    const params = new URLSearchParams(searchParams);
    if (next.escopo) {
      if (next.escopo === 'dia') params.delete('escopo');
      else params.set('escopo', next.escopo);
    }
    if (next.dia) params.set('dia', next.dia);
    if (next.mes) params.set('mes', next.mes);
    if (next.ocorrenciaId === null) params.set('ocorrenciaId', '');
    else if (next.ocorrenciaId) params.set('ocorrenciaId', next.ocorrenciaId);
    if (pointId) params.set('pontoVendaId', pointId);
    setSearchParams(params);
  };

  if (!isResolved) return <Loading />;
  if (!contexto.ativo || contexto.operationMode !== 'CAIXA' || !contexto.tapsEnabled) {
    return <EmptyState title="Ranking de chope indisponível neste PDV" description="O ranking fica disponível quando o módulo de Taps está habilitado para a operação." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;
  }
  if (!point) return <EmptyState title="Selecione um PDV válido" description="O ranking só pode consultar um PDV ativo da sua empresa." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;

  const activeQuery = escopo === 'dia' ? rankingQuery : periodQuery;
  if (activeQuery.isLoading) return <Loading />;
  const rows = escopo === 'dia' ? rankingQuery.data?.ranking ?? [] : periodQuery.data?.entries ?? [];
  const months = periodQuery.data?.mesesDisponiveis ?? [];
  const selectedMonth = months.includes(mes) ? mes : months[0] ?? mes;
  const error = activeQuery.error;

  return <div className="space-y-4">
    <PageHeader title="Ranking de chope" subtitle={`${point.nome}${selectedOccurrence ? ` · ${selectedOccurrence.nome}` : ''}`} backTo="/operacao/comandas" backLabel="Comandas" />
    <section className="card space-y-3">
      <div className="segmented-control w-full">
        {(['dia', 'mensal', 'geral'] as const).map((scope) => <button key={scope} type="button" aria-pressed={escopo === scope} className={`segmented-control-btn ${escopo === scope ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => updateParams({ escopo: scope, ...(scope === 'dia' ? {} : { ocorrenciaId: null })})}>{scope === 'dia' ? 'Dia' : scope === 'mensal' ? 'Mensal' : 'Geral'}</button>)}
      </div>
      {escopo === 'dia' ? <div className="space-y-2">
        <label className="label" htmlFor="ranking-pdv-day">Dia operacional</label>
        <input id="ranking-pdv-day" className="input" type="date" value={dia} onChange={(event) => updateParams({ dia: event.target.value, ocorrenciaId: null })} />
        <label className="label" htmlFor="ranking-pdv-occurrence">Agendamento (opcional)</label>
        {occurrencesQuery.isLoading ? <p role="status" className="text-sm text-ink-faint">Carregando agendamentos…</p> : occurrencesQuery.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-danger"><span>Não foi possível carregar os agendamentos deste PDV.</span><button className="touch-btn-secondary touch-btn-sm" type="button" onClick={() => void occurrencesQuery.refetch()}>Tentar novamente</button></div> : <select id="ranking-pdv-occurrence" className="input" value={occurrenceId} onChange={(event) => updateParams({ ocorrenciaId: event.target.value || null })}><option value="">Todas as comandas do PDV neste dia</option>{occurrences.map((item) => <option key={item.id} value={item.id}>{item.nome} · {new Date(`${item.data}T12:00:00`).toLocaleDateString('pt-BR')}</option>)}</select>}
        {occurrenceId && !selectedOccurrence && <p role="alert" className="text-sm text-amber-600">Este agendamento não está disponível neste PDV. Escolha outro ou remova o filtro.</p>}
      </div> : escopo === 'mensal' ? <div><p className="label">Mês</p><MonthNavigator value={selectedMonth} options={months.length ? months : [mes]} onChange={(value) => { setMes(value); updateParams({ escopo: 'mensal', mes: value }); }} /></div> : <p className="text-sm text-ink-faint">Consumo acumulado nas sessões de caixa deste PDV.</p>}
      {escopo === 'mensal' && <p className="text-sm text-ink-faint">Consumo acumulado em {formatMesLabel(selectedMonth)}.</p>}
      {escopo === 'dia' && rankingQuery.data?.ocorrencia && <p className="text-sm text-ink-faint">Resultado filtrado pela ocorrência {rankingQuery.data.ocorrencia.nome} em {new Date(`${rankingQuery.data.ocorrencia.data}T12:00:00`).toLocaleDateString('pt-BR')}.</p>}
    </section>
    {error ? <div className="card text-ink-soft" role="alert">{error instanceof ApiError ? error.message : 'Não foi possível carregar o ranking. Tente novamente.'}<button className="touch-btn-secondary touch-btn-sm ml-3" type="button" onClick={() => void activeQuery.refetch()}>Tentar novamente</button></div> : <RankingList entries={rows} emptyTitle="Ninguém no ranking neste período ainda." />}
  </div>;
}
