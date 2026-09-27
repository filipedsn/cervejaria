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
import { api, formatCurrency } from '../../lib/api';
import { PAYMENT_LABELS } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { getSocket } from '../../lib/socket';
import { Loading } from '../../components/Loading';
import type { OperacaoDashboard } from '../../lib/operacao';
import {
  formatDuracaoTurnoMinutos,
  formatTurnoTitulo,
  pluralComandasOperacao,
} from '../../lib/operacao';

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

function KpiCard({
  label,
  value,
  trend,
  hint,
}: {
  label: string;
  value: string;
  trend?: number | null;
  hint?: string;
}) {
  return (
    <div className="dashboard-kpi-card">
      <p className="section-label leading-snug">{label}</p>
      <p className="dashboard-kpi-value">{value}</p>
      <div className="dashboard-kpi-trend-slot">
        {trend != null ? (
          <p className={trend >= 0 ? 'text-success' : 'text-danger'}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs mês anterior
          </p>
        ) : hint ? (
          <p className="text-ink-faint">{hint}</p>
        ) : (
          <span aria-hidden="true" className="invisible">
            —
          </span>
        )}
      </div>
    </div>
  );
}

function TurnoMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold tabular-nums text-ink leading-none">{value}</p>
      <p className="text-[11px] text-ink-faint mt-1 leading-none">{label}</p>
    </div>
  );
}

export function OperacaoDashboardPage() {
  const queryClient = useQueryClient();
  const { cervejaria } = useAuth();
  const { contexto } = useOperacaoContexto();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ano, mes } = useMemo(() => parsePeriod(searchParams), [searchParams]);
  const [pontoVendaId, setPontoVendaId] = useState<string>('all');

  const pontos = contexto.ativo ? contexto.pontosVenda : [];
  const showPontoFilter = pontos.length > 1;
  const pontoParam = showPontoFilter && pontoVendaId !== 'all' ? pontoVendaId : undefined;

  const now = new Date();
  const isCurrentMonth = ano === now.getFullYear() && mes === now.getMonth() + 1;
  const canGoNext =
    ano < now.getFullYear() || (ano === now.getFullYear() && mes < now.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['operacao-dashboard', ano, mes, pontoParam],
    queryFn: () =>
      api.get<OperacaoDashboard>(
        `/api/operacao/dashboard?ano=${ano}&mes=${mes}${
          pontoParam ? `&pontoVendaId=${encodeURIComponent(pontoParam)}` : ''
        }`,
      ),
    staleTime: 30_000,
  });

  useEffect(() => {
    const socket = getSocket();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['operacao-dashboard'] });
    socket.on('operacao:comanda-atualizada', invalidate);
    return () => {
      socket.off('operacao:comanda-atualizada', invalidate);
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

  const turnosChart = useMemo(
    () =>
      (data?.turnosRecentes ?? []).map((turno) => ({
        nome: formatTurnoTitulo(turno.abertoEm, turno.fechadoEm),
        dataLabel: new Date(turno.fechadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        pontoNome: turno.pontoNome,
        receita: turno.receitaTotal,
        comandas: turno.comandasAtendidas,
        sessaoId: turno.sessaoId,
      })),
    [data?.turnosRecentes],
  );

  const turnosOrdenados = useMemo(
    () =>
      [...(data?.turnosRecentes ?? [])].sort(
        (a, b) => new Date(a.abertoEm).getTime() - new Date(b.abertoEm).getTime(),
      ),
    [data?.turnosRecentes],
  );

  if (isLoading || !data) return <Loading />;

  const { resumo, porPagamento, porProduto, porFuncionario, turnosRecentes, comparativoPontos } = data;
  const mesSelecionadoIdx = mes - 1;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <p className="page-eyebrow">Visão geral</p>
        <h1 className="page-title">{cervejaria?.nome ?? 'Dashboard'}</h1>
        <p className="page-subtitle">Performance mensal do operacao</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)] items-start">
        <div className="min-w-0 space-y-2">
          <span className="section-label block">Per&#237;odo</span>
          <div className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-1.5 py-1.5">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            className="touch-btn-secondary min-h-9 min-w-9 px-0 text-base shrink-0"
            aria-label="Mês anterior"
          >
            ◀
          </button>
          <p className="min-w-[9rem] flex-1 text-center font-bold text-sm sm:text-base tabular-nums whitespace-nowrap">
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
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {showPontoFilter && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="section-label shrink-0">Ponto</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPontoVendaId('all')}
                  className={`min-h-9 rounded-xl px-3 text-sm font-semibold transition-colors ${
                    pontoVendaId === 'all'
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface border border-line text-ink-muted'
                  }`}
                >
                  Todos
                </button>
                {pontos.map((ponto) => (
                  <button
                    key={ponto.id}
                    type="button"
                    onClick={() => setPontoVendaId(ponto.id)}
                    className={`min-h-9 rounded-xl px-3 text-sm font-semibold transition-colors truncate max-w-full ${
                      pontoVendaId === ponto.id
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface border border-line text-ink-muted'
                    }`}
                  >
                    {ponto.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

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
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Vendas no período"
          value={formatCurrency(resumo.receitaTotal)}
          trend={resumo.variacaoReceitaMesAnterior}
        />
        <KpiCard label="Recebido no período" value={formatCurrency(resumo.totalRecebido)} />
        <KpiCard label="Pendurado" value={formatCurrency(resumo.totalPendurado)} hint="Parte do recebido, sem sessão de caixa" />
        <KpiCard label="Saldo pendente" value={formatCurrency(resumo.saldoPendente)} />
        <KpiCard label="Comandas atendidas" value={String(resumo.comandasAtendidas)} />
        <KpiCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
        <KpiCard label="Ticket médio" value={formatCurrency(resumo.ticketMedio)} />
        <KpiCard label="Itens vendidos" value={String(resumo.itensVendidos)} />
        <KpiCard label="Turnos de caixa" value={String(resumo.turnosCaixa)} />
      </div>

      {resumo.receitaTotal === 0 && resumo.totalRecebido === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-ink-muted">Nenhuma venda fechada em {MESES[mesSelecionadoIdx]} {ano}</p>
        </div>
      ) : (
        <>
          {turnosRecentes.length > 0 && (
            <section className="space-y-4">
              <div className="card p-4 sm:p-5">
                <h2 className="section-label mb-4">Turnos encerrados no mês</h2>
                <div className="h-52 sm:h-60 -mx-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={turnosChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
                      <XAxis hide />
                      <YAxis
                        tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                        width={48}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as (typeof turnosChart)[number];
                          return (
                            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg max-w-[14rem]">
                              <p className="font-semibold">{row.nome}</p>
                              <p className="text-xs text-ink-muted mt-0.5">
                                {row.dataLabel} · {row.pontoNome}
                              </p>
                              <p className="text-brand-600 font-bold tabular-nums mt-1">{formatCurrency(row.receita)}</p>
                              <p className="text-ink-muted text-xs mt-0.5">{pluralComandasOperacao(row.comandas)}</p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="receita" fill="var(--color-chart-primary)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card divide-y divide-line p-0 overflow-hidden">
                {turnosOrdenados.map((turno) => {
                  const turnoHref = searchParams.toString()
                    ? `/operacao/turnos/${turno.sessaoId}?${searchParams.toString()}`
                    : `/operacao/turnos/${turno.sessaoId}`;

                  return (
                    <Link
                      key={turno.sessaoId}
                      to={turnoHref}
                      className="block px-4 py-3.5 hover:bg-surface-lighter transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{formatTurnoTitulo(turno.abertoEm, turno.fechadoEm)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-brand-600 text-lg tabular-nums leading-none">
                            {formatCurrency(turno.receitaTotal)}
                          </p>
                          <p className="text-[11px] text-ink-faint mt-1 leading-none">vendas do turno</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        <TurnoMetric value={pluralComandasOperacao(turno.comandasAtendidas)} label="atendidas" />
                        <TurnoMetric value={formatCurrency(turno.totalRecebido)} label="recebido" />
                        <TurnoMetric value={formatCurrency(turno.ticketMedio)} label="ticket médio" />
                        <TurnoMetric value={`${formatCurrency(turno.receitaPorHora)}/h`} label="receita/h" />
                        <TurnoMetric
                          value={formatDuracaoTurnoMinutos(
                            Math.max(
                              1,
                              Math.round(
                                (new Date(turno.fechadoEm).getTime() - new Date(turno.abertoEm).getTime()) / 60_000,
                              ),
                            ),
                          )}
                          label="duração"
                        />
                        {turno.vendasAvulsas > 0 && (
                          <TurnoMetric value={String(turno.vendasAvulsas)} label="vendas avulsas" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {comparativoPontos.length > 1 && (
            <section className="space-y-3">
              <h2 className="section-label">Comparativo por ponto de venda</h2>
              <div className="card divide-y divide-line p-0 overflow-hidden">
                {comparativoPontos.map((ponto, i) => (
                  <div key={ponto.pontoVendaId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-xs font-bold text-brand-600">{i + 1}</span>
                      <div>
                        <p className="font-semibold truncate">{ponto.nome}</p>
                        <p className="text-xs text-ink-faint">
                          {ponto.turnos} turno(s) · {ponto.comandasAtendidas} comandas
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-brand-600 tabular-nums shrink-0">
                      {formatCurrency(ponto.receitaTotal)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card p-4 sm:p-5">
            <h2 className="section-label mb-4">Evolução semanal</h2>
            <div className="h-60 sm:h-72 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weeklyChart} margin={{ top: 20, right: 4, left: 0, bottom: 0 }}>
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
                  <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="receita" dataKey="receita" name="Receita" fill="var(--color-chart-primary)" radius={[6, 6, 0, 0]} maxBarSize={52}>
                    <LabelList
                      dataKey="receita"
                      position="top"
                      fill="var(--color-ink-faint)"
                      fontSize={10}
                      formatter={(v) => {
                        const n = typeof v === 'number' ? v : Number(v);
                        return n > 0 ? (n >= 1000 ? `R$${(n / 1000).toFixed(1)}k` : `R$${n.toFixed(0)}`) : '';
                      }}
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
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-5">
            <section className="card p-4 sm:p-5 space-y-4">
              <h2 className="section-label">Recebimentos por forma</h2>
              {porPagamento.map((p) => (
                <div key={p.forma} className="space-y-1.5">
                  <div className="flex justify-between text-sm gap-2">
                    <span className="font-medium">{PAYMENT_LABELS[p.forma as keyof typeof PAYMENT_LABELS] ?? p.forma}</span>
                    <span className="tabular-nums text-ink-soft shrink-0">
                      {formatCurrency(p.valor)} · {p.percentual}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-lighter overflow-hidden">
                    <div className="chart-bar-fill" style={{ width: `${Math.max(p.percentual, 4)}%` }} />
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
        <h2 className="section-label mb-4">Receita mês a mês · {data.anoVigente}</h2>
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
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
                      <p className="font-semibold">{label}</p>
                      <p className="text-brand-600 font-bold tabular-nums">{formatCurrency(payload[0]?.value as number)}</p>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="receita"
                stroke="var(--color-chart-primary)"
                strokeWidth={2.5}
                dot={{ fill: 'var(--color-chart-primary)', strokeWidth: 0, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
