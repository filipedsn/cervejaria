import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, formatDate, formatMl, downloadCsv } from '../lib/api';
import type { EventoDashboard, RelatorioEvento } from '../types';
import { PAYMENT_LABELS } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { PorProdutoSection } from '../components/PorProdutoSection';

export function RelatoriosPage() {
  const queryClient = useQueryClient();
  const { evento } = useEvento();

  const { data, isLoading: loadingRelatorio } = useQuery({
    queryKey: ['relatorio', evento?.id],
    queryFn: () => api.get<RelatorioEvento>(`/api/relatorios/evento/${evento!.id}`),
    enabled: !!evento,
  });

  const { data: dashboard, isLoading: loadingDashboard } = useQuery({
    queryKey: ['dashboard', evento?.id],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${evento!.id}/dashboard`),
    enabled: !!evento,
  });

  useEffect(() => {
    if (!evento) return;
    const socket = getSocket();

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['relatorio', evento.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
    };

    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);

    return () => {
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
    };
  }, [evento?.id, queryClient]);

  const handleExportCsv = async () => {
    if (!evento) return;
    try {
      await downloadCsv(`/api/relatorios/evento/${evento.id}/csv`, `relatorio-${evento.nome}.csv`);
    } catch {
      alert('Erro ao exportar CSV');
    }
  };

  if (!evento) {
    return (
      <div className="text-center py-16">
        <p className="text-ink-muted">Selecione um evento para ver relatórios</p>
      </div>
    );
  }

  if (loadingRelatorio || loadingDashboard) return <Loading />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader
        title="Relatórios"
        subtitle={`${evento.nome}${evento.data ? ` · ${formatDate(evento.data)}` : ''}`}
        action={
          <button type="button" className="touch-btn-secondary text-sm min-h-12 px-4" onClick={handleExportCsv}>
            Exportar CSV
          </button>
        }
      />

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="card text-center py-3">
              <p className="text-[11px] text-ink-muted uppercase">Comandas</p>
              <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{data.resumo.comandasFechadas}</p>
            </div>
            <div className="card text-center py-3">
              <p className="text-[11px] text-ink-muted uppercase">Vendido</p>
              <p className="text-xl sm:text-2xl font-bold text-brand-600 mt-1 tabular-nums">{formatCurrency(data.resumo.totalVendido)}</p>
            </div>
            <div className="card text-center py-3">
              <p className="text-[11px] text-ink-muted uppercase">Volume</p>
              <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{formatMl(data.resumo.totalMl)}</p>
            </div>
          </div>

          {dashboard && (
            <PorProdutoSection
              aberto={dashboard.porProduto.aberto}
              fechado={dashboard.porProduto.fechado}
            />
          )}

          <section className="space-y-3">
            <h3 className="section-label">Por bebida (fechadas)</h3>
            <div className="space-y-2">
              {data.porBebida.map((b) => (
                <div key={b.produtoId} className="card flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{b.nome}</p>
                    <p className="text-sm text-ink-muted">{b.quantidade} un · {formatMl(b.totalMl)}</p>
                  </div>
                  <p className="font-bold text-brand-600 shrink-0 tabular-nums">{formatCurrency(b.valor)}</p>
                </div>
              ))}
              {data.porBebida.length === 0 && <p className="text-ink-faint text-center py-4 text-sm">Sem vendas fechadas</p>}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="section-label">Por pagamento</h3>
            <div className="space-y-2">
              {data.porPagamento.map((p) => (
                <div key={p.forma} className="card flex items-center justify-between py-3">
                  <p className="font-semibold">{PAYMENT_LABELS[p.forma] ?? p.forma}</p>
                  <p className="font-bold tabular-nums">{formatCurrency(p.valor)}</p>
                </div>
              ))}
              {data.porPagamento.length === 0 && <p className="text-ink-faint text-center py-4 text-sm">Sem pagamentos</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
