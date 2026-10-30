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

type Escopo = 'turno' | 'dia' | 'mensal' | 'geral';
type Ocorrencia = { id: string; nome: string; data: string; status: string; agenda: { id: string; nome: string; archivedAt: string | null } | null };
type Agenda = { id: string; nome: string; primeiraData: string | null; ultimaData: string | null; archivedAt: string | null };

function operationDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function parseEscopo(value: string | null, hasSession: boolean, hasOccurrence: boolean): Escopo {
  if (value === 'turno' || value === 'dia' || value === 'mensal' || value === 'geral') return value;
  if (hasSession) return 'turno';
  if (hasOccurrence) return 'dia';
  return 'turno';
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
  const sessionId = searchParams.get('sessaoCaixaId') ?? '';
  const occurrenceId = searchParams.get('ocorrenciaId') ?? '';
  const agendaId = searchParams.get('agendaId') ?? '';
  const dia = searchParams.get('dia') ?? operationDay();
  const mes = searchParams.get('mes') ?? currentMesKey();
  const escopo = parseEscopo(searchParams.get('escopo'), Boolean(sessionId), Boolean(occurrenceId));
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
    enabled: Boolean(companyId && pointId && contexto.tapsEnabled && (occurrenceId || escopo === 'mensal' || escopo === 'geral')),
  });
  const occurrences = occurrencesQuery.data?.ocorrencias ?? [];
  const agendas = occurrencesQuery.data?.agendas ?? [];
  const selectedOccurrence = occurrences.find((item) => item.id === occurrenceId);
  const selectedAgendaId = agendaId || selectedOccurrence?.agenda?.id || '';
  const selectedAgenda = agendas.find((agenda) => agenda.id === selectedAgendaId);

  const rankingQuery = useQuery({
    queryKey: ['ranking-pdv', companyId, pointId, escopo, sessionId, dia, occurrenceId, agendaId],
    queryFn: () => {
      const query = new URLSearchParams();
      if (escopo === 'turno') {
        query.set('sessaoCaixaId', sessionId);
        if (occurrenceId) query.set('ocorrenciaId', occurrenceId);
      } else {
        query.set('dia', dia);
        if (occurrenceId) query.set('ocorrenciaId', occurrenceId);
        if (agendaId) query.set('agendaId', agendaId);
      }
      return api.get<RankingPdvResponse>(`/api/ranking/pdv/${encodeURIComponent(pointId)}?${query}`);
    },
    enabled: Boolean(
      companyId
      && pointId
      && contexto.tapsEnabled
      && ((escopo === 'turno' && sessionId) || (escopo === 'dia' && occurrenceId)),
    ),
    refetchInterval: pollMs,
    staleTime: 0,
  });
  const hasAgendaScopes = Boolean(selectedAgendaId || selectedOccurrence?.agenda?.id || rankingQuery.data?.ocorrencia?.agendaId);
  const availableScopes: Escopo[] = [
    ...(sessionId ? (['turno'] as const) : []),
    ...(occurrenceId ? (['dia'] as const) : []),
    ...(hasAgendaScopes ? (['mensal', 'geral'] as const) : []),
  ];
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
    if (occurrencesQuery.isSuccess && selectedOccurrence && params.get('dia') !== selectedOccurrence.data) {
      params.set('dia', selectedOccurrence.data);
      changed = true;
    }
    if (escopo === 'mensal' && !params.get('mes')) { params.set('mes', mes); changed = true; }
    if (occurrencesQuery.isSuccess && occurrenceId && selectedOccurrence?.agenda?.id && !params.get('agendaId')) {
      params.set('agendaId', selectedOccurrence.agenda.id);
      changed = true;
    }
    if (rankingQuery.data?.ocorrencia?.agendaId && !params.get('agendaId') && (escopo === 'turno' || escopo === 'dia')) {
      params.set('agendaId', rankingQuery.data.ocorrencia.agendaId);
      changed = true;
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [escopo, isResolved, mes, occurrenceId, occurrencesQuery.isSuccess, pointId, rankingQuery.data?.ocorrencia?.agendaId, searchParams, selectedOccurrence?.agenda?.id, selectedOccurrence?.data, setSearchParams]);

  const availableScopesKey = availableScopes.join(',');
  useEffect(() => {
    const scopes = (availableScopesKey ? availableScopesKey.split(',') : []) as Escopo[];
    if (!scopes.length) return;
    if (scopes.includes(escopo)) return;
    const params = new URLSearchParams(searchParams);
    const fallback = scopes[0];
    if (fallback === 'turno') params.delete('escopo');
    else params.set('escopo', fallback);
    setSearchParams(params, { replace: true });
  }, [availableScopesKey, escopo, searchParams, setSearchParams]);

  const updateParams = (next: { escopo?: Escopo; dia?: string; mes?: string; ocorrenciaId?: string | null; agendaId?: string | null; sessaoCaixaId?: string | null; pontoVendaId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (next.escopo) {
      if (next.escopo === 'turno') params.delete('escopo');
      else params.set('escopo', next.escopo);
    }
    if (next.dia) params.set('dia', next.dia);
    if (next.mes) params.set('mes', next.mes);
    if (next.ocorrenciaId === null) params.delete('ocorrenciaId');
    else if (next.ocorrenciaId !== undefined) next.ocorrenciaId ? params.set('ocorrenciaId', next.ocorrenciaId) : params.delete('ocorrenciaId');
    if (next.agendaId !== undefined) next.agendaId ? params.set('agendaId', next.agendaId) : params.delete('agendaId');
    if (next.sessaoCaixaId === null) params.delete('sessaoCaixaId');
    else if (next.sessaoCaixaId !== undefined) next.sessaoCaixaId ? params.set('sessaoCaixaId', next.sessaoCaixaId) : params.delete('sessaoCaixaId');
    if (next.pontoVendaId) {
      params.set('pontoVendaId', next.pontoVendaId);
      params.delete('ocorrenciaId');
      params.delete('agendaId');
      params.delete('sessaoCaixaId');
      params.delete('escopo');
    }
    if (pointId && !next.pontoVendaId) params.set('pontoVendaId', pointId);
    setSearchParams(params);
  };

  if (!isResolved) return contextoError ? <EmptyState title="Não foi possível carregar o contexto do PDV" description="Tente novamente em alguns instantes." /> : <Loading />;
  if (!contexto.ativo || contexto.operationMode !== 'CAIXA' || !contexto.tapsEnabled) {
    return <EmptyState title="Ranking de chope indisponível neste PDV" description="O ranking fica disponível quando Taps está habilitado na operação." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;
  }
  if (!point) return <EmptyState title="Selecione um PDV válido" description="O ranking só pode consultar um PDV ativo da sua empresa." action={<Link className="touch-btn-secondary touch-btn-sm inline-block" to="/operacao/comandas">Voltar para Comandas</Link>} />;

  const activeQuery = escopo === 'mensal' || escopo === 'geral' ? periodQuery : rankingQuery;
  const rows: RankingEntry[] = escopo === 'mensal' || escopo === 'geral'
    ? periodQuery.data?.entries ?? []
    : rankingQuery.data?.ranking ?? [];
  const responseDay = rankingQuery.data?.dia ?? dia;
  const occurrenceLabel = selectedOccurrence?.nome
    ?? rankingQuery.data?.ocorrencia?.nome
    ?? (occurrenceId ? 'agendamento selecionado' : null);
  const contextLabel = escopo === 'turno'
    ? `Turno atual${occurrenceLabel ? ` · ${occurrenceLabel}` : ''}${responseDay ? ` · ${formatDateOnly(responseDay)}` : ''}`
    : escopo === 'dia'
      ? `${formatDateOnly(responseDay)}${occurrenceLabel ? ` · ${occurrenceLabel}` : ''}`
      : `${selectedAgenda ? `Agenda · ${selectedAgenda.nome} · ` : ''}${escopo === 'mensal' ? `Mensal · ${formatMesLabel(mes)}` : 'Geral · todo o histórico'}`;
  const title = `${point.nome} · ${contextLabel}`;
  const tvPath = rankingTvPath(searchParams);
  const returnPath = rankingPath(searchParams);
  const canOpenClientHistory = canPermission('clients.manage');
  const lastUpdatedAt = activeQuery.dataUpdatedAt || undefined;
  const error = activeQuery.isError ? queryText(activeQuery.error) : null;
  const agendaOptionsError = (escopo === 'mensal' || escopo === 'geral') && occurrencesQuery.isError
    ? 'Não foi possível carregar as agendas deste PDV.'
    : null;
  const selectionRequired = (escopo === 'mensal' || escopo === 'geral') && !selectedAgendaId && !occurrencesQuery.isLoading && !occurrencesQuery.isError;
  const sessionRequired = escopo === 'turno' && !sessionId;
  const dailySelectionRequired = escopo === 'dia' && !occurrenceId;
  const emptyMessage = (escopo === 'mensal' || escopo === 'geral') && selectedAgenda
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
      loading={activeQuery.isLoading || ((escopo === 'mensal' || escopo === 'geral') && occurrencesQuery.isLoading)}
      error={error ?? agendaOptionsError}
      onRetry={() => void (occurrencesQuery.isError ? occurrencesQuery.refetch() : activeQuery.refetch())}
      emptyMessage={sessionRequired ? 'Abra o caixa para consultar o ranking do turno.' : selectionRequired ? 'Selecione uma agenda com ocorrência vinculada para consultar o acumulado.' : dailySelectionRequired ? 'Abra o ranking a partir de um caixa com agendamento para consultar o consumo do dia.' : emptyMessage}
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

        <div className="ranking-operational-scopes-strip">
          <Link to="/operacao/comandas" className="ranking-operational-back">
            Voltar para Comandas
          </Link>
          {availableScopes.length > 0 && (
            <div className="ranking-operational-scopes-quiet" role="group" aria-label="Período do ranking">
              {availableScopes.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={escopo === scope}
                  className={`ranking-operational-scope-btn ${escopo === scope ? 'is-active' : ''}`}
                  onClick={() => updateParams({ escopo: scope })}
                >
                  {scope === 'turno' ? 'Turno' : scope === 'dia' ? 'Dia' : scope === 'mensal' ? 'Mensal' : 'Geral'}
                </button>
              ))}
            </div>
          )}
          {escopo === 'mensal' && (
            <div className="ranking-operational-month ranking-operational-month--strip">
              <MonthNavigator
                value={mes}
                options={periodQuery.data?.mesesDisponiveis.length ? periodQuery.data.mesesDisponiveis : [mes]}
                onChange={(value) => updateParams({ escopo: 'mensal', mes: value })}
              />
            </div>
          )}
        </div>

        <RankingStatsBar
          stats={computeRankingStats(rows)}
          exitTo="/operacao/comandas"
          exitLabel="Voltar para Comandas"
          tvTo={tvPath}
        />

        <main className="tap-champions-main ranking-operational-main">
          {activeQuery.isLoading || ((escopo === 'mensal' || escopo === 'geral') && occurrencesQuery.isLoading) ? (
            <div className="ranking-operational-state" role="status"><Loading /></div>
          ) : agendaOptionsError ? (
            <div className="ranking-operational-state" role="alert"><p>{agendaOptionsError}</p><button className="touch-btn-secondary touch-btn-sm mt-3" type="button" onClick={() => void occurrencesQuery.refetch()}>Tentar novamente</button></div>
          ) : error ? (
            <div className="ranking-operational-state" role="alert"><p>{error}</p><button className="touch-btn-secondary touch-btn-sm mt-3" type="button" onClick={() => void activeQuery.refetch()}>Tentar novamente</button></div>
          ) : sessionRequired ? (
            <div className="ranking-operational-state">
              <p>Abra o caixa para consultar o ranking do turno.</p>
              <p className="mt-2 text-sm text-ink-muted">O ranking do turno soma o chope lançado nesta sessão de caixa, com ou sem agendamento.</p>
              <Link className="touch-btn-secondary touch-btn-sm mt-3 inline-block" to="/operacao/comandas">Voltar para Comandas</Link>
            </div>
          ) : selectionRequired ? (
            <div className="ranking-operational-state"><p>Este turno não tem agenda vinculada para acumulados mensal/geral.</p></div>
          ) : dailySelectionRequired ? (
            <div className="ranking-operational-state"><p>Abra o ranking a partir de um caixa com agendamento para consultar o consumo do dia.</p></div>
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
          <details className="ranking-operational-help">
            <summary>Como o consumo é contado</summary>
            <p>O ranking soma itens de chope lançados e sem cancelamento. Turno usa a sessão de caixa aberta; Dia usa a ocorrência; Mensal e Geral acumulam pela agenda.</p>
          </details>
        </footer>
      </div>
    </div>
  );
}
