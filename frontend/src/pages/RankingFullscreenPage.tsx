import { useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatLiters } from '../lib/api';
import type { RankingEntry } from '../types';
import { buildDemoRankingResponse } from '../lib/ranking-demo';
import { useRankingLiveUpdates, useRankingSocketReconnect } from '../hooks/useRankingLiveUpdates';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from '../components/Loading';

interface RankingResponse {
  evento: { id: string; nome: string; local: string; data: string | null };
  ranking: RankingEntry[];
}

const MEDALS = ['🥇', '🥈', '🥉'] as const;

function podiumClass(posicao: number) {
  if (posicao === 1) return 'border-brand-300/40 bg-brand-400/15';
  if (posicao === 2) return 'border-white/20 bg-white/5';
  if (posicao === 3) return 'border-amber-700/30 bg-amber-900/20';
  return 'border-white/8 bg-surface-light/80';
}

function RankingRow({ entry, compact }: { entry: RankingEntry; compact?: boolean }) {
  const isTop3 = entry.posicao <= 3;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border ${podiumClass(entry.posicao)} ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3 md:px-5 md:py-4'
      } ${isTop3 && !compact ? 'md:py-5' : ''}`}
    >
      <div
        className={`shrink-0 flex items-center justify-center font-bold tabular-nums ${
          isTop3 ? 'text-2xl md:text-3xl w-10 md:w-12' : 'text-base md:text-lg w-8 md:w-10 text-white/45'
        }`}
      >
        {isTop3 ? MEDALS[entry.posicao - 1] : `#${entry.posicao}`}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`font-bold truncate ${
            isTop3 ? 'text-lg md:text-2xl' : 'text-sm md:text-base'
          }`}
        >
          {entry.nome}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`font-bold text-brand-300 tabular-nums ${
            isTop3 ? 'text-xl md:text-3xl' : 'text-base md:text-lg'
          }`}
        >
          {formatLiters(entry.totalMl)}
        </p>
      </div>
    </div>
  );
}

export function RankingFullscreenPage() {
  const { eventoId } = useParams<{ eventoId: string }>();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading } = useAuth();
  const listRef = useRef<HTMLDivElement>(null);

  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;
  const demoData = useMemo(
    () => (isDemo ? buildDemoRankingResponse(demoCount) : null),
    [isDemo, demoCount],
  );

  useRankingLiveUpdates(eventoId, !isDemo);
  useRankingSocketReconnect(eventoId, !isDemo);

  const { data: apiData, isLoading: loadingRanking } = useQuery({
    queryKey: ['ranking', eventoId],
    queryFn: () => api.get<RankingResponse>(`/api/ranking/evento/${eventoId}`),
    enabled: !!eventoId && !isDemo && !authLoading,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const data = isDemo ? demoData : apiData;
  const ranking = data?.ranking ?? [];

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const overflow = el.scrollHeight > el.clientHeight + 8;
    if (!overflow) return;

    let direction = 1;
    let pauseUntil = 0;

    const tick = () => {
      if (Date.now() < pauseUntil) return;

      el.scrollTop += direction * 0.6;

      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const atTop = el.scrollTop <= 0;

      if (atBottom && direction === 1) {
        direction = -1;
        pauseUntil = Date.now() + 2500;
      } else if (atTop && direction === -1) {
        direction = 1;
        pauseUntil = Date.now() + 2500;
      }
    };

    const interval = window.setInterval(tick, 30);
    const pauseScroll = () => {
      pauseUntil = Date.now() + 8000;
    };

    el.addEventListener('mouseenter', pauseScroll);
    el.addEventListener('touchstart', pauseScroll, { passive: true });

    return () => {
      window.clearInterval(interval);
      el.removeEventListener('mouseenter', pauseScroll);
      el.removeEventListener('touchstart', pauseScroll);
    };
  }, [ranking.length]);

  if (!isDemo && (authLoading || loadingRanking)) return <Loading />;

  const top3 = ranking.filter((e) => e.posicao <= 3);
  const rest = ranking.filter((e) => e.posicao > 3);

  return (
    <div className="h-[100dvh] flex flex-col bg-surface overflow-hidden">
      <header className="shrink-0 px-4 md:px-8 pt-3 md:pt-5 pb-2 md:pb-3 border-b border-white/5 text-center relative">
        <Link
          to={isDemo ? '/ranking' : `/ranking/${eventoId}`}
          className="absolute top-3 right-4 md:top-4 md:right-8 touch-btn-secondary text-xs md:text-sm min-h-10 px-3 md:px-4 z-10"
          aria-label="Sair da tela cheia"
        >
          <span className="md:hidden">✕ Sair</span>
          <span className="hidden md:inline">Sair da tela cheia</span>
        </Link>
        {isDemo && (
          <p className="inline-flex items-center gap-2 text-xs md:text-sm font-semibold px-3 py-0.5 rounded-full bg-brand-400/15 text-brand-300 border border-brand-400/25 mb-2">
            Simulação · {demoCount} participantes
          </p>
        )}
        <p className="text-brand-400 text-xs md:text-sm font-semibold tracking-[0.2em] uppercase">
          Ranking do evento
        </p>
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold mt-0.5 leading-tight truncate px-2">
          {data?.evento.nome ?? '...'}
        </h1>
        <p className="text-white/45 text-sm md:text-base mt-0.5">{data?.evento.local}</p>
      </header>

      <main className="flex-1 min-h-0 flex flex-col px-4 md:px-8 py-4 md:py-6 gap-4 md:gap-5">
        {ranking.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-6xl md:text-8xl mb-4">🍺</p>
            <p className="text-xl md:text-3xl text-white/50">Aguardando chope nas taps...</p>
          </div>
        )}

        {top3.length > 0 && (
          <section
            className={`shrink-0 grid gap-2 md:gap-3 ${
              top3.length === 1
                ? 'grid-cols-1 max-w-md mx-auto w-full'
                : top3.length === 2
                  ? 'grid-cols-2 max-w-3xl mx-auto w-full'
                  : 'grid-cols-1 sm:grid-cols-3'
            }`}
          >
            {top3.map((entry) => (
              <RankingRow key={entry.clienteId} entry={entry} />
            ))}
          </section>
        )}

        {rest.length > 0 && (
          <section className="flex-1 min-h-0 flex flex-col">
            <p className="shrink-0 text-xs md:text-sm font-semibold uppercase tracking-wide text-white/35 mb-2 px-1">
              Demais colocações
            </p>
            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth ranking-tv-scroll pr-1"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-2.5 pb-4">
                {rest.map((entry) => (
                  <RankingRow key={entry.clienteId} entry={entry} compact />
                ))}
              </div>
            </div>
          </section>
        )}

        {ranking.length > 0 && ranking.length <= 3 && (
          <p className="shrink-0 text-center text-white/25 text-xs md:text-sm">
            Atualiza automaticamente a cada venda ou ajuste de chope neste evento
          </p>
        )}
      </main>
    </div>
  );
}
