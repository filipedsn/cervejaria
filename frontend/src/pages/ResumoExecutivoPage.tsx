import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, downloadCsv, formatCurrency, formatEventoWhen, formatLiters } from '../lib/api';
import type { EventoResumoExecutivo } from '../types';
import { PAYMENT_LABELS } from '../types';
import { Loading } from '../components/Loading';
import { VerRankingButton } from '../components/VerRankingButton';
import { BackToEventosLink } from '../components/BackToEventosLink';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
function formatDuracaoMinutos(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function ChopeChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const ml = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-brand-600 font-bold tabular-nums">{formatLiters(ml)}</p>
    </div>
  );
}

function FluxChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as {
    fechado?: number;
    fechadoAvulsa?: number;
    aberto?: number;
    comandasFechadas?: number;
    comandasAvulsas?: number;
  };
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg space-y-1">
      <p className="font-semibold text-ink">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="tabular-nums" style={{ color: entry.color }}>
          {entry.dataKey === 'fechado' && `Fechado: ${formatCurrency(entry.value ?? 0)}`}
          {entry.dataKey === 'fechadoAvulsa' && `Venda avulsa: ${formatCurrency(entry.value ?? 0)}`}
          {entry.dataKey === 'aberto' && `Aberto: ${formatCurrency(entry.value ?? 0)}`}
        </p>
      ))}
      {row?.comandasFechadas != null && row.comandasFechadas > 0 && (
        <p className="text-ink-muted text-xs">{row.comandasFechadas} comanda(s) fechadas</p>
      )}
      {row?.comandasAvulsas != null && row.comandasAvulsas > 0 && (
        <p className="text-ink-muted text-xs">{row.comandasAvulsas} venda(s) avulsa(s)</p>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card py-4 px-4">
      <p className="section-label">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-brand-600 tabular-nums mt-1.5 leading-none">{value}</p>
    </div>
  );
}

export function ResumoExecutivoPage() {
  const { eventoId } = useParams<{ eventoId: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['resumo-executivo', eventoId],
    queryFn: () => api.get<EventoResumoExecutivo>(`/api/eventos/${eventoId}/resumo-executivo`),
    enabled: !!eventoId,
    retry: false,
  });

  const handleExportCsv = async () => {
    if (!eventoId || !data) return;
    try {
      await downloadCsv(
        `/api/relatorios/evento/${eventoId}/csv`,
        `resumo-${data.evento.nome.replace(/\s+/g, '-').slice(0, 40)}.csv`,
      );
    } catch {
      alert('Erro ao exportar CSV');
    }
  };

  if (isLoading) return <Loading />;

  if (isError || !data) {
    return (
      <EmptyState
        title="Resumo disponível apenas para eventos encerrados"
        action={
          <Link to="/eventos" className="touch-btn-danger touch-btn-sm inline-block">
            Voltar para Eventos
          </Link>
        }
      />
    );
  }

  const { evento, resumo, fluxoPorIntervalo, tempoComanda = { mediaMinutos: 0, distribuicao: [] }, porPagamento, porProduto, porFuncionario, rankingTop, topClientes } =
    data;
  const fluxoChart = fluxoPorIntervalo.map((i) => ({
    name: i.intervalo,
    fechado: i.fechado,
    fechadoAvulsa: i.fechadoAvulsa ?? 0,
    aberto: i.aberto,
    comandasFechadas: i.comandasFechadas,
    comandasAvulsas: i.comandasAvulsas ?? 0,
  }));
  const chopeChart = fluxoPorIntervalo.map((i) => ({
    name: i.intervalo,
    chopeMl: i.chopeMl ?? 0,
  }));
  const xTickInterval = Math.max(0, Math.ceil(fluxoChart.length / 8) - 1);
  const showDots = fluxoChart.length <= 24;
  const maxTempoFaixa = Math.max(1, ...tempoComanda.distribuicao.map((d) => d.comandas));

  return (
    <div className="space-y-6 pb-6">
      <div>
        <BackToEventosLink className="mb-3" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-eyebrow">Resumo executivo</p>
            <h1 className="page-title">{evento.nome}</h1>
            <p className="page-subtitle">{evento.local}</p>
            <p className="text-sm text-ink-faint mt-0.5">{formatEventoWhen(evento)}</p>
          </div>
          <StatusBadge variant="evento-fechado" label="Encerrado" className="uppercase" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Receita total" value={formatCurrency(resumo.receitaTotal)} />
        <KpiCard label="Comandas regulares" value={String(resumo.comandasRegulares)} />
        <KpiCard label="Vendas avulsas" value={String(resumo.vendasAvulsas)} />
        <KpiCard label="Receita avulsa" value={formatCurrency(resumo.receitaAvulsa)} />
        <KpiCard label="Ticket médio" value={formatCurrency(resumo.ticketMedio)} />
        <KpiCard label="Chope" value={formatLiters(resumo.chopeMl)} />
        <KpiCard label="Clientes" value={String(resumo.clientesUnicos)} />
        {tempoComanda.mediaMinutos > 0 && (
          <KpiCard label="Tempo médio comanda" value={formatDuracaoMinutos(tempoComanda.mediaMinutos)} />
        )}
      </div>

      {resumo.comandasAtendidas === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-ink-muted">Evento encerrado sem comandas fechadas</p>
        </div>
      ) : (
        <>
          {fluxoChart.length > 0 && (
            <section className="card p-4 sm:p-5">
              <h2 className="section-label mb-4">Fluxo do evento · 15 min</h2>
              <div className="h-56 sm:h-72 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={fluxoChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      interval={xTickInterval}
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)}
                      width={48}
                    />
                    <Tooltip content={<FluxChartTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      height={28}
                      formatter={(value) => {
                        if (value === 'fechado') return 'Fechado';
                        if (value === 'fechadoAvulsa') return 'Venda avulsa';
                        return 'Aberto';
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="fechado"
                      name="fechado"
                      stroke="var(--color-danger)"
                      strokeWidth={2.5}
                      dot={showDots ? { fill: 'var(--color-danger)', strokeWidth: 0, r: 3 } : false}
                      activeDot={{ r: 5, fill: 'var(--color-danger)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="fechadoAvulsa"
                      name="fechadoAvulsa"
                      stroke="var(--color-orange)"
                      strokeWidth={2.5}
                      dot={showDots ? { fill: 'var(--color-orange)', strokeWidth: 0, r: 3 } : false}
                      activeDot={{ r: 5, fill: 'var(--color-orange)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="aberto"
                      name="aberto"
                      stroke="var(--color-brand-600)"
                      strokeWidth={2.5}
                      dot={showDots ? { fill: 'var(--color-brand-600)', strokeWidth: 0, r: 3 } : false}
                      activeDot={{ r: 5, fill: 'var(--color-brand-500)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {chopeChart.some((b) => b.chopeMl > 0) && (
            <section className="card p-4 sm:p-5">
              <h2 className="section-label mb-4">Chope · 15 min</h2>
              <div className="h-48 sm:h-56 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chopeChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      interval={xTickInterval}
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatLiters(v)}
                      width={52}
                    />
                    <Tooltip content={<ChopeChartTooltip />} />
                    <Bar dataKey="chopeMl" fill="var(--color-brand-600)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {tempoComanda.distribuicao.some((d) => d.comandas > 0) && (
            <section className="card p-4 sm:p-5 space-y-4">
              <h2 className="section-label">Tempo comanda aberta</h2>
              <p className="text-sm text-ink-muted">
                Do primeiro item ao pagamento — média {formatDuracaoMinutos(tempoComanda.mediaMinutos)}
              </p>
              {tempoComanda.distribuicao.map((d) => (
                <div key={d.faixa} className="space-y-1.5">
                  <div className="flex justify-between text-sm gap-2">
                    <span className="font-medium">{d.faixa}</span>
                    <span className="tabular-nums text-ink-soft shrink-0">{d.comandas} comandas</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-lighter overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${Math.max((d.comandas / maxTempoFaixa) * 100, d.comandas > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>
          )}

          <div className="grid lg:grid-cols-2 gap-5">
            <section className="card p-4 sm:p-5 space-y-4">
              <h2 className="section-label">Formas de pagamento</h2>
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
              <h2 className="section-label">Produtos vendidos</h2>
              <div className="card divide-y divide-line p-0 overflow-hidden">
                {porProduto.map((p, i) => (
                  <div key={p.produtoId} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-6 text-sm font-bold text-ink-faint tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{p.nome}</p>
                      <p className="text-xs text-ink-faint">
                        {p.quantidade} un · {p.percentual}%
                      </p>
                    </div>
                    <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatCurrency(p.receita)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {topClientes.length > 0 && (
              <section className="space-y-3">
                <h2 className="section-label">Top clientes</h2>
                <div className="card divide-y divide-line p-0 overflow-hidden">
                  {topClientes.map((entry) => (
                    <div key={entry.clienteId} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-8 text-center font-bold text-brand-600 tabular-nums">#{entry.posicao}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{entry.nome}</p>
                        <p className="text-xs text-ink-faint">{entry.comandas} comandas</p>
                      </div>
                      <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatCurrency(entry.receita)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {rankingTop.length > 0 && (
              <section className="space-y-3">
                <h2 className="section-label">Top chope</h2>
                <div className="card divide-y divide-line p-0 overflow-hidden">
                  {rankingTop.map((entry) => (
                    <div key={entry.clienteId} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-8 text-center font-bold text-brand-600 tabular-nums">#{entry.posicao}</span>
                      <p className="flex-1 font-semibold truncate">{entry.nome}</p>
                      <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatLiters(entry.totalMl)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {porFuncionario.length > 0 && (
              <section className="space-y-3">
                <h2 className="section-label">Receita × funcionário</h2>
                <div className="card divide-y divide-line p-0 overflow-hidden">
                  {porFuncionario.map((f) => (
                    <div key={f.usuarioId ?? f.nome} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{f.nome}</p>
                        <p className="text-xs text-ink-faint">{f.comandas} comandas</p>
                      </div>
                      <p className="font-bold text-brand-600 tabular-nums shrink-0">{formatCurrency(f.receita)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <VerRankingButton eventoId={evento.id} fullWidth={false} className="min-h-11 px-4" />
        {resumo.comandasAtendidas > 0 && (
          <button type="button" onClick={handleExportCsv} className="touch-btn-secondary touch-btn-sm px-4">
            Exportar CSV
          </button>
        )}
      </div>

    </div>
  );
}
