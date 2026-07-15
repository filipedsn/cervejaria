import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency } from '../lib/api';
import type { Comanda, EventoDashboard } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Loading } from '../components/Loading';
import { EncerrarEventoButton } from '../components/EncerrarEventoButton';
import { ExcluirEventoButton } from '../components/ExcluirEventoButton';
import { VerRankingButton } from '../components/VerRankingButton';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { EventoTapMontagemPanel } from '../components/EventoTapMontagemPanel';
import { FilaPedidosPanel } from '../components/FilaPedidosPanel';
import { MobileActionBar } from '../components/MobileActionBar';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'brand' | 'green' }) {
  return (
    <div className="metric-card">
      <p
        className={`metric-value w-full ${accent === 'green' ? 'metric-value-success' : ''}`}
      >
        {value}
      </p>
      <p className="text-xs sm:text-sm text-ink-muted leading-tight w-full">{label}</p>
    </div>
  );
}

export function ComandasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento, trailer } = useEvento();
  const [comandaTab, setComandaTab] = useState<'ABERTA' | 'FECHADA'>('ABERTA');

  const { data: dashboard, isLoading: loadingDashboard } = useQuery({
    queryKey: ['dashboard', evento?.id],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${evento!.id}/dashboard`),
    enabled: !!evento,
  });

  const { data: comandas, isLoading: loadingComandas } = useQuery({
    queryKey: ['comandas', evento?.id, comandaTab],
    queryFn: () => api.get<Comanda[]>(`/api/comandas/evento/${evento!.id}?status=${comandaTab}`),
    enabled: !!evento,
  });

  useEffect(() => {
    if (!evento) return;
    const socket = getSocket();

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['comandas', evento.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', evento.id] });
    };

    socket.on('comanda:created', invalidate);
    socket.on('comanda:updated', invalidate);
    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);

    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:updated', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
    };
  }, [evento?.id, queryClient]);

  if (!evento) {
    return (
      <div className="empty-state py-12 space-y-3">
        <p className="empty-state-text">
          {trailer
            ? `Nenhum evento aberto em ${trailer.nome}. Vá em Eventos para iniciar ou retomar.`
            : 'Use a barra acima para escolher ou criar um evento'}
        </p>
        <Link to="/eventos" className="touch-btn-primary touch-btn-sm inline-block">
          Ir para Eventos
        </Link>
      </div>
    );
  }

  if (loadingDashboard || loadingComandas) return <Loading />;

  const resumo = dashboard?.resumo;
  const isAbertas = comandaTab === 'ABERTA';

  return (
    <div className={`space-y-4 ${evento.status === 'ABERTO' ? 'page-with-action-bar' : 'pb-2'}`}>
      <EventoTapMontagemPanel
        eventoId={evento.id}
        eventoAberto={evento.status === 'ABERTO'}
        sectionId="evento-taps"
      />

      <Link to="/comandas/nova" className="touch-btn-hero">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/20 text-2xl leading-none font-normal">
          +
        </span>
        Nova Comanda
      </Link>

      {resumo && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comandas abertas" value={String(resumo.comandasAbertas)} />
          <StatCard label="Comandas fechadas" value={String(resumo.comandasFechadas)} accent="green" />
          <StatCard label="Valor em aberto" value={formatCurrency(resumo.valorAberto)} />
          <StatCard label="Valor fechado" value={formatCurrency(resumo.valorFechado)} accent="green" />
        </div>
      )}

      <VerRankingButton eventoId={evento.id} />

      <FilaPedidosPanel />

      <section className="space-y-3">
        <h2 className="section-label">Comandas</h2>
        <div className="segmented-control w-full">
          <button
            type="button"
            onClick={() => setComandaTab('ABERTA')}
            className={`segmented-control-btn ${
              isAbertas ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Abertas{resumo ? ` (${resumo.comandasAbertas})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setComandaTab('FECHADA')}
            className={`segmented-control-btn ${
              !isAbertas ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Fechadas{resumo ? ` (${resumo.comandasFechadas})` : ''}
          </button>
        </div>

        <div className="grid gap-3">
          {comandas?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/comandas/${c.id}`)}
              className="card-touch hover:border-brand-400/30 min-h-[4.5rem] w-full"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold truncate">{c.cliente.nome}</h3>
                    {!isAbertas && (
                      <StatusBadge variant="comanda-fechada" />
                    )}
                  </div>
                  {c.cliente.telefone && <p className="text-sm text-ink-faint">{c.cliente.telefone}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-brand-600 tabular-nums">{formatCurrency(c.total)}</p>
                  <p className="text-xs text-ink-faint">{c.itens.length} item(ns)</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {comandas?.length === 0 && (
          <EmptyState
            icon={isAbertas ? '📋' : '✅'}
            title={isAbertas ? 'Nenhuma comanda aberta ainda' : 'Nenhuma comanda fechada ainda'}
            description={isAbertas ? 'Use o botão acima para abrir a primeira' : undefined}
          />
        )}
      </section>

      {evento.status === 'ABERTO' && (
        <MobileActionBar>
          <div className="grid gap-2 w-full">
            {resumo && resumo.comandasAbertas + resumo.comandasFechadas === 0 && (
              <ExcluirEventoButton
                eventoId={evento.id}
                eventoNome={evento.nome}
                eventoAberto
                navigateAfterDelete="/eventos"
              />
            )}
            <EncerrarEventoButton eventoId={evento.id} />
          </div>
        </MobileActionBar>
      )}
    </div>
  );
}
