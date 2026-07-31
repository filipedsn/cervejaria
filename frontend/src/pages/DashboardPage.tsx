import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, formatCurrency, formatLiters } from '../lib/api';
import type { CervejariaDashboard, Trailer } from '../types';
import { PAYMENT_LABELS, formatTrailerLabel } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function parsePeriod(searchParams: URLSearchParams) {
  const now = new Date();
  const ano = Number.parseInt(searchParams.get('ano') ?? String(now.getFullYear()), 10);
  const mes = Number.parseInt(searchParams.get('mes') ?? String(now.getMonth() + 1), 10);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
    return { ano: now.getFullYear(), mes: now.getMonth() + 1 };
  }
  return { ano, mes };
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel = 'Receita',
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { comandas?: number } }>;
  label?: string;
  valueLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  const comandas = payload[0]?.payload?.comandas;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-brand-600 font-bold tabular-nums">{formatCurrency(value)}</p>
      {comandas != null && <p className="text-ink-muted text-xs mt-0.5">{comandas} comandas</p>}
      <p className="text-ink-faint text-[10px] mt-1">{valueLabel}</p>
    </div>
  );
}

function formatEventoDataCurta(data: string, horaInicio: string): string {
  const d = new Date(data);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · ${horaInicio}`;
}

function formatEventoChartDate(data: string): string {
  const d = new Date(data);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function compareEventoByData(
  a: { data: string; horaInicio: string },
  b: { data: string; horaInicio: string },
): number {
  const dataA = new Date(a.data).getTime();
  const dataB = new Date(b.data).getTime();
  if (dataA !== dataB) return dataA - dataB;
  return a.horaInicio.localeCompare(b.horaInicio);
}

function EventoChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: {
      nome?: string;
      dataLabel?: string;
      horaInicio?: string;
      local?: string | null;
      comandas?: number;
    };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const value = payload[0]?.value ?? 0;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg max-w-[14rem]">
      <p className="font-semibold text-ink leading-snug">{row.nome}</p>
      <p className="text-xs text-ink-muted mt-0.5">
        {row.dataLabel}
        {row.horaInicio ? ` · ${row.horaInicio}` : ''}
        {row.local ? ` · ${row.local}` : ''}
      </p>
      <p className="text-brand-600 font-bold tabular-nums mt-1">{formatCurrency(value)}</p>
      {row.comandas != null && (
        <p className="text-ink-muted text-xs mt-0.5">{row.comandas} comandas</p>
      )}
    </div>
  );
}

function WeeklyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { receita?: number; comandas?: number; ticket?: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-brand-600 font-bold tabular-nums mt-1">{formatCurrency(row.receita ?? 0)}</p>
      <p className="text-ink-muted text-xs mt-0.5 tabular-nums">
        {row.comandas ?? 0} comandas · ticket {formatCurrency(row.ticket ?? 0)}
      </p>
    </div>
  );
}

function EventoMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold tabular-nums text-ink leading-none">{value}</p>
      <p className="text-[11px] text-ink-faint mt-1 leading-none">{label}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number | null;
}) {
  return (
    <div className="dashboard-kpi-card">
      <p className="section-label leading-snug">{label}</p>
      <p className="dashboard-kpi-value">{value}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      <div className="dashboard-kpi-trend-slot">
        {trend != null ? (
          <p className={trend >= 0 ? 'text-success' : 'text-danger'}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs mês anterior
          </p>
        ) : (
          <span aria-hidden="true" className="invisible">
            —
          </span>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { cervejaria } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ano, mes } = useMemo(() => parsePeriod(searchParams), [searchParams]);
  const [trailerId, setTrailerId] = useState<string>('all');
  const [tipoEvento, setTipoEvento] = useState<'todos' | 'agendado' | 'avulso'>('todos');

  const { data: trailers = [] } = useQuery({
    queryKey: ['trailers', 'ativo'],
    queryFn: () => api.get<Trailer[]>('/api/trailers?ativo=true'),
  });

  const showTrailerFilter = trailers.length > 1;
  const trailerParam = showTrailerFilter && trailerId !== 'all' ? trailerId : undefined;

  const now = new Date();
  const isCurrentMonth = ano === now.getFullYear() && mes === now.getMonth() + 1;
  const canGoNext =
    ano < now.getFullYear() || (ano === now.getFullYear() && mes < now.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['cervejaria-dashboard', ano, mes, trailerParam, tipoEvento],
    queryFn: () =>
      api.get<CervejariaDashboard>(
        `/api/cervejaria/dashboard?ano=${ano}&mes=${mes}${
          trailerParam ? `&trailerId=${encodeURIComponent(trailerParam)}` : ''
        }${tipoEvento !== 'todos' ? `&tipo=${tipoEvento}` : ''}`,
      ),
    staleTime: 30_000,
  });

  useEffect(() => {
    const socket = getSocket();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['cervejaria-dashboard'] });
    socket.on('comanda:closed', invalidate);
    return () => {
      socket.off('comanda:closed', invalidate);
    };
  }, [queryClient]);

  const goMonth = (delta: number) => {
    let newMes = mes + delta;
    let newAno = ano;
    if (newMes < 1) {
      newMes = 12;
      newAno -= 1;
    } else if (newMes > 12) {
      newMes = 1;
      newAno += 1;
    }
    if (newAno > now.getFullYear() || (newAno === now.getFullYear() && newMes > now.getMonth() + 1)) {
      return;
    }
    setSearchParams({ ano: String(newAno), mes: String(newMes) });
  };

  const weeklyChart = useMemo(() => {
    const rows =
      data?.evolucaoSemanal.map((w) => ({
        name: w.label,
        receita: w.receita,
        comandas: w.comandas,
        ticket: w.comandas > 0 ? w.receita / w.comandas : 0,
      })) ?? [];
    // Remove semanas zeradas no início e no fim (mantém buracos internos p/ continuidade)
    const isEmpty = (r: { receita: number; comandas: number }) => r.receita === 0 && r.comandas === 0;
    let start = 0;
    let end = rows.length - 1;
    while (start <= end && isEmpty(rows[start])) start += 1;
    while (end >= start && isEmpty(rows[end])) end -= 1;
    return start > end ? rows : rows.slice(start, end + 1);
  }, [data?.evolucaoSemanal]);

  const annualChart = useMemo(
    () => data?.receitaAnual.map((m) => ({ name: m.label, receita: m.receita, comandas: m.comandas })) ?? [],
    [data?.receitaAnual],
  );

  const eventosChart = useMemo(
    () =>
      [...(data?.eventosRecentes ?? [])]
        .sort(compareEventoByData)
        .map((e) => ({
          nome: e.nome,
          dataLabel: formatEventoChartDate(e.data),
          horaInicio: e.horaInicio,
          local: e.local,
          receita: e.receitaTotal,
          comandas: e.comandasAtendidas,
        })),
    [data?.eventosRecentes],
  );

  const eventosOrdenados = useMemo(
    () => [...(data?.eventosRecentes ?? [])].sort(compareEventoByData),
    [data?.eventosRecentes],
  );

  const maxReceitaEvento = useMemo(
    () => Math.max(0, ...(data?.eventosRecentes ?? []).map((e) => e.receitaTotal)),
    [data?.eventosRecentes],
  );

  const maxMediaAgenda = useMemo(
    () => Math.max(0, ...(data?.comparativoAgendas ?? []).map((g) => g.mediaPorSessao)),
    [data?.comparativoAgendas],
  );

  if (isLoading || !data) return <Loading />;

  const {
    resumo,
    porPagamento,
    porProduto,
    porFuncionario,
    eventosRecentes = [],
    comparativoAgendas = [],
  } = data;
  const mesSelecionadoIdx = mes - 1;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <p className="page-eyebrow">Visão geral</p>
        <h1 className="page-title">{cervejaria?.nome ?? 'Dashboard'}</h1>
        <p className="page-subtitle">Performance mensal do negócio</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3 items-center">
        {/* Mês/ano — mesma largura do primeiro card */}
        <div className="flex items-center justify-between gap-1 rounded-2xl border border-line bg-surface px-1.5 py-1.5">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            className="touch-btn-secondary min-h-9 min-w-9 px-0 text-base shrink-0"
            aria-label="Mês anterior"
          >
            ◀
          </button>
          <p className="flex-1 min-w-0 text-center font-bold text-sm sm:text-base tabular-nums whitespace-nowrap">
            {MESES[mesSelecionadoIdx]}/{ano}
          </p>
          <button
            type="button"
            onClick={() => goMonth(1)}
            disabled={!canGoNext}
            className="touch-btn-secondary min-h-9 min-w-9 px-0 text-base shrink-0 disabled:opacity-30"
            aria-label="Próximo mês"
          >
            ▶
          </button>
        </div>

        {/* Filtros — ocupam as colunas restantes, na mesma linha */}
        <div className="col-span-1 sm:col-span-2 2xl:col-span-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          {showTrailerFilter && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="section-label shrink-0">Trailer</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTrailerId('all')}
                  className={`min-h-9 rounded-xl px-3 text-sm font-semibold transition-colors ${
                    trailerId === 'all'
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface border border-line text-ink-muted'
                  }`}
                >
                  Todos
                </button>
                {trailers.map((trailer) => (
                  <button
                    key={trailer.id}
                    type="button"
                    onClick={() => setTrailerId(trailer.id)}
                    className={`min-h-9 rounded-xl px-3 text-sm font-semibold transition-colors truncate max-w-full ${
                      trailerId === trailer.id
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface border border-line text-ink-muted'
                    }`}
                  >
                    {formatTrailerLabel(trailer)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="section-label shrink-0">Tipo</span>
            <div className="flex flex-wrap gap-2">
              {([
                ['todos', 'Todos'],
                ['agendado', 'Agendados'],
                ['avulso', 'Avulsos'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTipoEvento(id)}
                  className={`min-h-9 rounded-xl px-3 text-sm font-semibold transition-colors ${
                    tipoEvento === id
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface border border-line text-ink-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="touch-btn-secondary touch-btn-sm px-4 ml-auto"
            >
              Mês atual
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3">
        <KpiCard
          label="Receita total"
          value={formatCurrency(resumo.receitaTotal)}
          trend={resumo.variacaoReceitaMesAnterior}
        />
        <KpiCard label="Comandas atendidas" value={String(resumo.comandasAtendidas)} />
        <KpiCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
        <KpiCard label="Receita avulsa" value={formatCurrency(resumo.receitaAvulsa)} />
        <KpiCard label="Ticket médio" value={formatCurrency(resumo.ticketMedio)} />
        <KpiCard label="Chope vendido" value={formatLiters(resumo.chopeMl)} />
      </div>

      {resumo.receitaTotal === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-ink-muted">Nenhuma venda fechada em {MESES[mesSelecionadoIdx]} {ano}</p>
        </div>
      ) : (
        <>
          {eventosRecentes.length > 0 && (
            <section className="space-y-4">
              <div className="card p-4 sm:p-5">
                <h2 className="section-label mb-4">Eventos encerrados no mês</h2>
                <div className="h-52 sm:h-60 -mx-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={eventosChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
                      <XAxis hide />
                      <YAxis
                        tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                        width={48}
                      />
                      <Tooltip content={<EventoChartTooltip />} />
                      <Bar dataKey="receita" fill="var(--color-chart-primary)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card divide-y divide-line p-0 overflow-hidden">
                {eventosOrdenados.map((e) => {
                  const semMovimento = e.receitaTotal === 0 && e.comandasAtendidas === 0;
                  const barPct =
                    maxReceitaEvento > 0 && e.receitaTotal > 0
                      ? Math.max((e.receitaTotal / maxReceitaEvento) * 100, 3)
                      : 0;
                  return (
                    <Link
                      key={e.eventoId}
                      to={`/eventos/${e.eventoId}/resumo`}
                      className={`block px-4 py-3.5 hover:bg-surface-lighter transition-colors ${
                        semMovimento ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{e.nome}</p>
                          <p className="text-xs text-ink-faint truncate mt-0.5">
                            {formatEventoDataCurta(e.data, e.horaInicio)}
                            {e.local ? ` · ${e.local}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-brand-600 text-lg tabular-nums leading-none">
                            {formatCurrency(e.receitaTotal)}
                          </p>
                          <p className="text-[11px] text-ink-faint mt-1 leading-none">receita total</p>
                        </div>
                      </div>

                      <div className="mt-2.5 h-1.5 rounded-full bg-surface-lighter overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        <EventoMetric value={String(e.comandasAtendidas)} label="comandas" />
                        <EventoMetric value={`${formatCurrency(e.receitaPorHora)}/h`} label="receita/h" />
                        <EventoMetric value={`${e.chopeLitrosPorHora.toFixed(1)} L/h`} label="chope/h" />
                        <EventoMetric value={formatCurrency(e.ticketMedio)} label="ticket médio" />
                        {e.vendasAvulsas > 0 && (
                          <EventoMetric
                            value={`${e.vendasAvulsas} · ${formatCurrency(e.receitaAvulsa)}`}
                            label="avulsas"
                          />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {tipoEvento !== 'avulso' && comparativoAgendas.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="section-label mb-0">Comparativo por agenda</h2>
                <p className="text-xs text-ink-faint">Ranqueado por receita média/sessão</p>
              </div>

              <div className="card divide-y divide-line p-0 overflow-hidden">
                {comparativoAgendas.map((g, i) => {
                  const barPct =
                    maxMediaAgenda > 0 && g.mediaPorSessao > 0
                      ? Math.max((g.mediaPorSessao / maxMediaAgenda) * 100, 3)
                      : 0;
                  const isTop = i === 0 && comparativoAgendas.length > 1;
                  return (
                    <div key={g.serieId} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                              isTop
                                ? 'bg-brand-600 text-white'
                                : 'bg-surface-lighter text-ink-muted'
                            }`}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold truncate">
                              {g.nome}
                              {isTop && (
                                <span className="ml-2 rounded-full bg-brand-600/15 px-2 py-0.5 text-[10px] font-semibold text-brand-600 align-middle">
                                  Mais rentável
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-ink-faint truncate mt-0.5">
                              {g.local ? `${g.local} · ` : ''}
                              {g.sessoes} {g.sessoes === 1 ? 'sessão' : 'sessões'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-brand-600 text-lg tabular-nums leading-none">
                            {formatCurrency(g.mediaPorSessao)}
                          </p>
                          <p className="text-[11px] text-ink-faint mt-1 leading-none">média/sessão</p>
                        </div>
                      </div>

                      <div className="mt-2.5 h-1.5 rounded-full bg-surface-lighter overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        <EventoMetric value={formatCurrency(g.receitaTotal)} label="receita total" />
                        <EventoMetric value={formatCurrency(g.ticketMedio)} label="ticket médio" />
                        <EventoMetric value={`${formatCurrency(g.receitaPorHora)}/h`} label="receita/h" />
                        <EventoMetric value={`${g.chopeLitros.toFixed(1)} L`} label="chope" />
                        <EventoMetric value={String(g.comandasAtendidas)} label="comandas" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2 mb-4">
              <h2 className="section-label mb-0">Evolução semanal</h2>
              <p className="text-xs text-ink-faint">Receita e comandas por semana</p>
            </div>
            <div className="h-60 sm:h-72 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weeklyChart} margin={{ top: 20, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="weeklyReceitaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-primary)" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="var(--color-chart-primary)" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="receita"
                    tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                    width={48}
                  />
                  <YAxis
                    yAxisId="comandas"
                    orientation="right"
                    allowDecimals={false}
                    tick={{ fill: 'var(--color-purple)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'var(--color-line-soft)', opacity: 0.4 }} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={28}
                    iconType="circle"
                    iconSize={9}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar
                    yAxisId="receita"
                    dataKey="receita"
                    name="Receita"
                    fill="url(#weeklyReceitaFill)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={52}
                  >
                    <LabelList
                      dataKey="receita"
                      position="top"
                      fill="var(--color-ink-faint)"
                      fontSize={10}
                      formatter={(v: number) =>
                        v > 0 ? (v >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${v.toFixed(0)}`) : ''
                      }
                    />
                  </Bar>
                  <Line
                    yAxisId="comandas"
                    type="monotone"
                    dataKey="comandas"
                    name="Comandas"
                    stroke="var(--color-purple)"
                    strokeWidth={2.5}
                    dot={{ fill: 'var(--color-purple)', strokeWidth: 0, r: 3.5 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-5">
            <section className="card p-4 sm:p-5 space-y-4">
              <h2 className="section-label">Receita × forma de pagamento</h2>
              {porPagamento.map((p) => (
                <div key={p.forma} className="space-y-1.5">
                  <div className="flex justify-between text-sm gap-2">
                    <span className="font-medium">{PAYMENT_LABELS[p.forma] ?? p.forma}</span>
                    <span className="tabular-nums text-ink-soft shrink-0">
                      {formatCurrency(p.valor)} · {p.percentual}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-lighter overflow-hidden">
                    <div
                      className="chart-bar-fill"
                      style={{ width: `${Math.max(p.percentual, 4)}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="section-label mb-2">Produtos mais vendidos</h2>
              <div className="divide-y divide-line">
                {porProduto.map((p, i) => (
                  <div key={p.produtoId} className="flex items-center gap-4 py-3">
                    <span className="w-6 shrink-0 text-sm font-bold text-ink-faint tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{p.nome}</p>
                      <p className="text-xs text-ink-faint">
                        {p.quantidade} un · {p.percentual}% do faturamento
                      </p>
                    </div>
                    <div className="w-20 shrink-0 text-right">
                      {p.chopeMl > 0 ? (
                        <>
                          <p className="font-semibold tabular-nums text-ink leading-none">{formatLiters(p.chopeMl)}</p>
                          <p className="text-[11px] text-ink-faint mt-1 leading-none">chope</p>
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </div>
                    <p className="w-28 shrink-0 text-right font-bold text-brand-600 tabular-nums">{formatCurrency(p.receita)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {porFuncionario.length > 0 && (
            <section className="space-y-3">
              <h2 className="section-label">Receita × funcionário</h2>
              <div className="card divide-y divide-line p-0 overflow-hidden">
                {porFuncionario.map((f) => (
                  <div key={f.usuarioId ?? f.nome} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{f.nome}</p>
                      <p className="text-xs text-ink-faint">{f.comandas} comandas fechadas</p>
                    </div>
                    <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatCurrency(f.receita)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="card p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2 mb-4">
          <h2 className="section-label mb-0">Receita mês a mês · {data.anoVigente}</h2>
          <p className="text-xs text-ink-faint">Ano vigente</p>
        </div>
        <div className="h-64 sm:h-72 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={annualChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                width={48}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="receita"
                stroke="var(--color-chart-primary)"
                strokeWidth={2.5}
                dot={{ fill: 'var(--color-chart-primary)', strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, fill: 'var(--color-chart-primary-active)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
