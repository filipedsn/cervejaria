import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
    queryKey: ['cervejaria-dashboard', ano, mes, trailerParam],
    queryFn: () =>
      api.get<CervejariaDashboard>(
        `/api/cervejaria/dashboard?ano=${ano}&mes=${mes}${
          trailerParam ? `&trailerId=${encodeURIComponent(trailerParam)}` : ''
        }`,
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

  const weeklyChart = useMemo(
    () => data?.evolucaoSemanal.map((w) => ({ name: `Sem ${w.semana}`, receita: w.receita, comandas: w.comandas, label: w.label })) ?? [],
    [data?.evolucaoSemanal],
  );

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

  if (isLoading || !data) return <Loading />;

  const { resumo, porPagamento, porProduto, porFuncionario, eventosRecentes = [] } = data;
  const mesSelecionadoIdx = mes - 1;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <p className="page-eyebrow">Visão geral</p>
        <h1 className="page-title">{cervejaria?.nome ?? 'Dashboard'}</h1>
        <p className="page-subtitle">Performance mensal do negócio</p>
      </div>

      {showTrailerFilter && (
        <div className="space-y-2">
          <p className="section-label">Trailer</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTrailerId('all')}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold transition-colors ${
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
                className={`min-h-10 rounded-xl px-3 text-sm font-semibold transition-colors truncate max-w-full ${
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            className="touch-btn-secondary touch-btn-sm min-w-11 px-0 text-lg"
            aria-label="Mês anterior"
          >
            ◀
          </button>
          <div className="text-center min-w-[10rem]">
            <p className="font-bold text-lg">{MESES[mesSelecionadoIdx]}</p>
            <p className="text-sm text-ink-muted tabular-nums">{ano}</p>
          </div>
          <button
            type="button"
            onClick={() => goMonth(1)}
            disabled={!canGoNext}
            className="touch-btn-secondary min-h-11 min-w-11 px-0 text-lg disabled:opacity-30"
            aria-label="Próximo mês"
          >
            ▶
          </button>
        </div>
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="touch-btn-secondary touch-btn-sm px-4"
          >
            Mês atual
          </button>
        )}
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
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
                      <XAxis hide />
                      <YAxis
                        tick={{ fill: '#9ca3af', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                        width={48}
                      />
                      <Tooltip content={<EventoChartTooltip />} />
                      <Bar dataKey="receita" fill="var(--color-brand-600)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card divide-y divide-line p-0 overflow-hidden">
                {eventosOrdenados.map((e) => (
                  <Link
                    key={e.eventoId}
                    to={`/eventos/${e.eventoId}/resumo`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-surface-lighter transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{e.nome}</p>
                      <p className="text-xs text-ink-faint truncate">
                        {formatEventoDataCurta(e.data, e.horaInicio)}
                        {e.local ? ` · ${e.local}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums shrink-0">
                      <span className="font-bold text-brand-600">{formatCurrency(e.receitaTotal)}</span>
                      <span className="text-ink-muted">{formatCurrency(e.receitaPorHora)}/h</span>
                      <span className="text-ink-muted">{e.chopeLitrosPorHora.toFixed(1)} L/h</span>
                      <span className="text-ink-faint">{e.comandasAtendidas} comandas</span>
                      {e.vendasAvulsas > 0 && (
                        <span className="text-ink-faint">
                          {e.vendasAvulsas} avulsas · {formatCurrency(e.receitaAvulsa)}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card p-4 sm:p-5">
            <h2 className="section-label mb-4">Evolução semanal</h2>
            <div className="h-56 sm:h-64 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                    width={48}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="receita" fill="var(--color-brand-600)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
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
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                      style={{ width: `${Math.max(p.percentual, 4)}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <h2 className="section-label">Produtos mais vendidos</h2>
              <div className="card divide-y divide-line p-0 overflow-hidden">
                {porProduto.map((p, i) => (
                  <div key={p.produtoId} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-6 text-sm font-bold text-ink-faint tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{p.nome}</p>
                      <p className="text-xs text-ink-faint">
                        {p.quantidade} un · {p.percentual}% do faturamento
                      </p>
                    </div>
                    <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatCurrency(p.receita)}</p>
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                width={48}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="receita"
                stroke="var(--color-brand-600)"
                strokeWidth={2.5}
                dot={{ fill: 'var(--color-brand-600)', strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, fill: 'var(--color-brand-500)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
