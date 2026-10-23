import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useOperacaoContexto } from '../hooks/useOperacaoContexto';
import { usePollInterval } from '../hooks/usePollInterval';
import { connectSocket, getSocket } from '../lib/socket';
import { currentMesKey, formatMesLabel } from '../lib/month-key';
import { computeRankingStats } from '../lib/ranking-tv-stats';
import type { RankingEntry, RankingPdvPeriodoResponse, RankingPdvResponse } from '../types';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';
import { MonthNavigator } from '../components/MonthNavigator';
import { RankingPodium } from '../components/ranking/RankingPodium';
import { RankingRestGrid } from '../components/ranking/RankingRestGrid';
import { RankingHeader } from '../components/ranking/RankingHeader';
import { RankingStatsBar } from '../components/ranking/RankingStatsBar';
import { RankingUpdatedAt } from '../components/ranking/RankingUpdatedAt';
import { RankingTvView } from '../components/RankingTvView';

type Escopo = 'dia' | 'mensal' | 'geral';
type Ocorrencia = { id: string; nome: string; data: string; status: string; agenda: { id: string; nome: string; archivedAt: string | null } | null };
type Agenda = { id: string; nome: string; primeiraData: string | null; ultimaData: string | null; archivedAt: string | null };

function operationDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function parseEscopo(value: string | null): Escopo {
  return value === 'mensal' || value === 'geral' ? value : 'dia';
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function queryText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Não foi possível carregar o ranking. Tente novamente.';
}

function rankingTvPath(search: URLSearchParams): string {
  const query = search.toString();
  return `/operacao/ranking/tv${query ? `?${query}` : ''}`;
}

function rankingPath(search: URLSearchParams): string {
  const query = search.toString();
  return `/operacao/ranking${query ? `?${query}` : ''}`;
}

export function RankingPdvPage({ tv = false }: { tv?: boolean }) {
  const { contexto, isResolved, isError: contextoError } = useOperacaoContexto();
  const { cervejaria, canPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const escopo = parseEscopo(searchParams.get('escopo'));
  const dia = searchParams.get('dia') ?? operationDay();
  const mes = searchParams.get('mes') ?? currentMesKey();
  const occurrenceId = searchParams.get('ocorrenciaId') ?? '';
  const agendaId = searchParams.get('agendaId') ?? '';
  const activePoints = contexto.pontosVenda.filter((point) => point.ativo);
  const pointId = searchParams.get('pontoVendaId') ?? activePoints[0]?.id ?? '';
  const point = activePoints.find((candidate) => candidate.id === pointId);
  const companyId = cervejaria?.id ?? '';
  const pollMs = usePollInterval(60_000);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId || !pointId || !contexto.tapsEnabled) return;
    connectSocket(companyId);
    const socket = getSocket();
    const refreshCurrentPoint = () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'ranking-pdv' || query.queryKey[0] === 'ranking-pdv-period')
          && query.queryKey[1] === companyId
          && query.queryKey[2] === pointId,
      });
    };
    socket.on('operacao:comanda-atualizada', refreshCurrentPoint);
    socket.on('operacao:pedido-atualizado', refreshCurrentPoint);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      connectSocket(companyId);
      const currentSocket = getSocket();
      if (!currentSocket.connected) currentSocket.connect();
      refreshCurrentPoint();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      socket.off('operacao:comanda-atualizada', refreshCurrentPoint);
      socket.off('operacao:pedido-atualizado', refreshCurrentPoint);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [companyId, contexto.tapsEnabled, pointId, queryClient]);

  const occurrencesQuery = useQuery({
    queryKey: ['ranking-pdv-occurrences', companyId, pointId],
    queryFn: () => api.get<{ agendas: Agenda[]; ocorrencias: Ocorrencia[] }>(`/api/ranking/pdv/${encodeURIComponent(pointId)}/ocorrencias`),
    enabled: Boolean(companyId && pointId && contexto.tapsEnabled),
  });
  const occurrences = occurrencesQuery.data?.ocorrencias ?? [];
  const agendas = occurrencesQuery.data?.agendas ?? [];
  const selectedOccurrence = occurrences.find((item) => item.id === occurrenceId);
  const selectedAgendaId = agendaId || selectedOccurrence?.agenda?.id || '';
  const selectedAgenda = agendas.find((agenda) => agenda.id === selectedAgendaId);

  const rankingQuery = useQuery({
    queryKey: ['ranking-pdv', companyId, pointId, dia, occurrenceId, agendaId],
    queryFn: () => {
      const query = new URLSearchParams({ dia });
      if (occurrenceId) query.set('ocorrenciaId', occurrenceId);
      if (agendaId) query.set('agendaId', agendaId);
      return api.get<RankingPdvResponse>(`/api/ranking/pdv/${encodeURIComponent(pointId)}?${query}`);
    },
    enabled: Boolean(companyId && pointId && occurrenceId && escopo === 'dia' && contexto.tapsEnabled),
    refetchInterval: pollMs,
    staleTime: 0,
  });
  const periodQuery = useQuery({
    queryKey: ['ranking-pdv-period', companyId, pointId, selectedAgendaId, escopo, escopo === 'mensal' ? mes : null, occurrenceId],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set('agendaId', selectedAgendaId);
      if (occurrenceId) query.set('ocorrenciaId', occurrenceId);
      if (escopo === 'mensal') query.set('mes', mes);
      return api.get<RankingPdvPeriodoResponse>(`/api/ranking/pdv/${encodeURIComponent(pointId)}/periodo?${query}`);
    },
    enabled: Boolean(companyId && pointId && selectedAgendaId && (escopo === 'mensal' || escopo === 'geral') && contexto.tapsEnabled),
    refetchInterval: pollMs,
    staleTime: 0,
  });
  useEffect(() => {
    if (!isResolved || !pointId) return;
    const params = new URLSearchParams(searchParams);
    let changed = false;
    if (params.get('pontoVendaId') !== pointId) { params.set('pontoVendaId', pointId); changed = true; }
    if (!params.get('dia')) { params.set('dia', dia); changed = true; }
    if (occurrencesQuery.isSuccess && selectedOccurrence && params.get('dia') !== selectedOccurrence.data) {
      params.set('dia', selectedOccurrence.data);
      changed = true;
    }
    if (escopo === 'mensal' && !params.get('mes')) { params.set('mes', mes); changed = true; }
    if (occurrencesQuery.isSuccess && occurrenceId && selectedOccurrence?.agenda?.id && !params.get('agendaId')) {
      params.set('agendaId', selectedOccurrence.agenda.id);
      changed = true;
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [dia, escopo, isResolved, mes, occurrenceId, occurrencesQuery.isSuccess, pointId, searchParams, selectedAgenda?.id, selectedAgendaId, selectedOccurrence?.agenda?.id, selectedOccurrence?.data, setSearchParams]);

  const updateParams = (next: { escopo?: Escopo; dia?: string; mes?: string; ocorrenciaId?: string | null; agendaId?: string | null; pontoVendaId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (next.escopo) {
      if (next.escopo === 'dia') params.delete('escopo');
      else params.set('escopo', next.escopo);
    }
    if (next.dia) params.set('dia', next.dia);
    if (next.mes) params.set('mes', next.mes);
    if (next.ocorrenciaId === null) params.delete('ocorrenciaId');
    else if (next.ocorrenciaId !== undefined) next.ocorrenciaId ? params.set('ocorrenciaId', next.ocorrenciaId) : params.delete('ocorrenciaId');
    if (next.agendaId !== undefined) next.agendaId ? params.set('agendaId', next.agendaId) : params.delete('agendaId');
    if (next.pontoVendaId) {
      params.set('pontoVendaId', next.pontoVendaId);
      params.delete('ocorrenciaId');
      params.delete('agendaId');
    }
    if (pointId && !next.pontoVendaId) params.set('pontoVendaId', pointId);
    setSearchParams(params);
  };

  if (!isResolved) return contextoError ? <EmptyState title="Não foi possível carregar o contexto do PDV" description="Tente novamente em alguns instantes." /> : <Loading />;
  if (!contexto.ativo || contexto.operationMode !== 'CAIXA' || !contexto.tapsEnabled) {
    return <EmptyState title="Ranking de chope indisponível neste PDV" description="O ranking fica disponível quando Taps está habilitado na operação." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;
  }
  if (!point) return <EmptyState title="Selecione um PDV válido" description="O ranking só pode consultar um PDV ativo da sua empresa." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;

  const activeQuery = escopo === 'dia' ? rankingQuery : periodQuery;
  const rows: RankingEntry[] = escopo === 'dia'
    ? rankingQuery.data?.ranking ?? []
    : periodQuery.data?.entries ?? [];
  const responseDay = rankingQuery.data?.dia ?? dia;
  const contextLabel = escopo === 'dia'
    ? `${formatDateOnly(responseDay)}${selectedOccurrence ? ` · ${selectedOccurrence.nome}` : occurrenceId ? ' · agendamento selecionado' : ''}`
    : `${selectedAgenda ? `Agenda · ${selectedAgenda.nome} · ` : ''}${escopo === 'mensal' ? `Mensal · ${formatMesLabel(mes)}` : 'Geral · todo o histórico'}`;
  const title = `${point.nome} · ${contextLabel}`;
  const tvPath = rankingTvPath(searchParams);
  const returnPath = rankingPath(searchParams);
  const canOpenClientHistory = canPermission('clients.manage');
  const lastUpdatedAt = activeQuery.dataUpdatedAt || undefined;
  const error = activeQuery.isError ? queryText(activeQuery.error) : null;
  const agendaOptionsError = (escopo !== 'dia') && occurrencesQuery.isError
    ? 'Não foi possível carregar as agendas deste PDV.'
    : null;
  const selectionRequired = escopo !== 'dia' && !selectedAgendaId && !occurrencesQuery.isLoading && !occurrencesQuery.isError;
  const dailySelectionRequired = escopo === 'dia' && !occurrenceId && !occurrencesQuery.isLoading && !occurrencesQuery.isError;
  const emptyMessage = escopo !== 'dia' && selectedAgenda
    ? `Ainda não há consumo registrado na agenda ${selectedAgenda.nome} para este período.`
    : `Ainda não há consumo registrado em ${contextLabel}.`;

  if (tv) {
    return <RankingTvView
      kicker="Consumo no PDV"
      title="Ranking de chope"
      subtitle={title}
      exitTo={returnPath}
      entries={rows}
      lastUpdatedAt={lastUpdatedAt}
      breweryName={cervejaria?.nome}
      breweryLogoUrl={cervejaria?.logoUrl}
      updateMode="polling"
      loading={activeQuery.isLoading || ((escopo !== 'dia' || dailySelectionRequired) && occurrencesQuery.isLoading)}
      error={error ?? agendaOptionsError}
      onRetry={() => void (occurrencesQuery.isError ? occurrencesQuery.refetch() : activeQuery.refetch())}
      emptyMessage={selectionRequired ? 'Selecione uma agenda na tela do ranking para consultar o acumulado.' : dailySelectionRequired ? 'Selecione uma ocorrência na tela do ranking para consultar o consumo do dia.' : emptyMessage}
      autoScroll
    />;
  }

  return (
    <div className="space-y-4">
      <div className="ranking-operational">
        <RankingHeader
          kicker="Consumo de chope"
          title="Ranking de chope"
          subtitle={title}
          breweryName={cervejaria?.nome}
          breweryLogoUrl={cervejaria?.logoUrl}
          breweryLogoVersion={cervejaria?.logoVersion ?? cervejaria?.updatedAt}
          isLive={false}
          badge="Atualiza a cada minuto"
        />

        <section className="ranking-operational-filters" aria-label="Filtros do ranking">
          <div className="segmented-control ranking-operational-scopes" aria-label="Período do ranking">
            {(['dia', 'mensal', 'geral'] as const).map((scope) => (
              <button key={scope} type="button" aria-pressed={escopo === scope} className={`segmented-control-btn ${escopo === scope ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => updateParams({ escopo: scope })}>
                {scope === 'dia' ? 'Dia' : scope === 'mensal' ? 'Mensal' : 'Geral'}
              </button>
            ))}
          </div>

          <div className="ranking-operational-filter-fields">
            {activePoints.length > 1 && <div className="ranking-operational-filter-field">
              <label className="label" htmlFor="ranking-pdv-point">Ponto de venda</label>
              <select id="ranking-pdv-point" className="input" value={pointId} onChange={(event) => updateParams({ pontoVendaId: event.target.value })}>
                {activePoints.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
            </div>}
            {escopo === 'dia' && <>
              <div className="ranking-operational-filter-field">
                <label className="label" htmlFor="ranking-pdv-day">Dia operacional</label>
                <input id="ranking-pdv-day" className="input" type="date" value={dia} onChange={(event) => updateParams({ dia: event.target.value, ocorrenciaId: null })} />
              </div>
              <div className="ranking-operational-filter-field">
                <label className="label" htmlFor="ranking-pdv-occurrence">Ocorrência do dia</label>
                {occurrencesQuery.isLoading ? <p role="status" className="text-sm text-ink-faint">Carregando agendamentos…</p> : occurrencesQuery.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><span>Não foi possível carregar os agendamentos.</span><button className="touch-btn-secondary touch-btn-sm" type="button" onClick={() => void occurrencesQuery.refetch()}>Tentar novamente</button></div> : <select id="ranking-pdv-occurrence" className="input" value={occurrenceId} onChange={(event) => { const selected = occurrences.find((item) => item.id === event.target.value); updateParams({ ocorrenciaId: event.target.value || null, agendaId: selected?.agenda?.id ?? null, ...(selected ? { dia: selected.data } : {}) }); }}><option value="">Selecione uma ocorrência</option>{occurrences.map((item) => <option key={item.id} value={item.id}>{item.nome} · {formatDateOnly(item.data)}{item.agenda?.archivedAt ? ' · regra arquivada' : ''}</option>)}</select>}
              </div>
            </>}
            {escopo !== 'dia' && <div className="ranking-operational-filter-field">
              <label className="label" htmlFor="ranking-pdv-agenda">Agenda</label>
              {occurrencesQuery.isLoading ? <p role="status" className="text-sm text-ink-faint">Carregando agendas…</p> : occurrencesQuery.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><span>Não foi possível carregar as agendas.</span><button className="touch-btn-secondary touch-btn-sm" type="button" onClick={() => void occurrencesQuery.refetch()}>Tentar novamente</button></div> : <select id="ranking-pdv-agenda" className="input" value={selectedAgendaId} onChange={(event) => updateParams({ agendaId: event.target.value || null, ...(selectedOccurrence?.agenda?.id !== event.target.value ? { ocorrenciaId: null } : {}) })}><option value="">Selecione uma agenda</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.nome}{agenda.archivedAt ? ' · arquivada' : ''}</option>)}</select>}
            </div>}
            {escopo === 'mensal' && <div className="ranking-operational-filter-field ranking-operational-month">
              <span className="label">Mês consultado</span>
              <MonthNavigator value={mes} options={periodQuery.data?.mesesDisponiveis.length ? periodQuery.data.mesesDisponiveis : [mes]} onChange={(value) => updateParams({ escopo: 'mensal', mes: value })} />
            </div>}
          </div>
          <details className="ranking-operational-help">
            <summary>Como o consumo é contado</summary>
            <p>O ranking soma itens de chope lançados e sem cancelamento. O histórico do cliente detalha as entregas separadamente.</p>
          </details>
        </section>

        <RankingStatsBar stats={computeRankingStats(rows)} exitTo="/operacao/comandas" exitLabel="Voltar para Comandas" tvTo={tvPath} />

        <main className="tap-champions-main ranking-operational-main">
          {activeQuery.isLoading || ((escopo !== 'dia' || dailySelectionRequired) && occurrencesQuery.isLoading) ? (
            <div className="ranking-operational-state" role="status"><Loading /></div>
          ) : agendaOptionsError ? (
            <div className="ranking-operational-state" role="alert"><p>{agendaOptionsError}</p><button className="touch-btn-secondary touch-btn-sm mt-3" type="button" onClick={() => void occurrencesQuery.refetch()}>Tentar novamente</button></div>
          ) : error ? (
            <div className="ranking-operational-state" role="alert"><p>{error}</p><button className="touch-btn-secondary touch-btn-sm mt-3" type="button" onClick={() => void activeQuery.refetch()}>Tentar novamente</button></div>
          ) : selectionRequired ? (
            <div className="ranking-operational-state"><p>Selecione uma agenda para consultar os acumulados desse histórico.</p></div>
          ) : dailySelectionRequired ? (
            <div className="ranking-operational-state"><p>Selecione uma ocorrência para consultar o consumo do dia.</p><p className="mt-2 text-sm text-ink-muted">Ocorrências avulsas também têm ranking diário, sem acumulado de agenda.</p></div>
          ) : rows.length === 0 ? (
            <div className="ranking-operational-state"><p className="tap-champions-empty-title">{emptyMessage}</p></div>
          ) : (
            <>
              <RankingPodium entries={rows} leaderMl={rows[0]?.totalMl ?? 0} linkToClientHistory={canOpenClientHistory} />
              <RankingRestGrid entries={rows} leaderMl={rows[0]?.totalMl ?? 0} linkToClientHistory={canOpenClientHistory} autoScroll={false} />
            </>
          )}
        </main>

        <footer className="ranking-operational-footer">
          <RankingUpdatedAt lastUpdatedAt={lastUpdatedAt} />
          <span>Atualização automática a cada minuto</span>
        </footer>
      </div>
    </div>
  );
}
