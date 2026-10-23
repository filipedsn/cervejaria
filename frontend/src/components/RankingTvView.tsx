import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { computeRankingStats } from '../lib/ranking-tv-stats';
import type { RankingEntry } from '../types';
import { RankingHeader } from './ranking/RankingHeader';
import { RankingPodium } from './ranking/RankingPodium';
import { RankingRestGrid } from './ranking/RankingRestGrid';
import { RankingStatsBar } from './ranking/RankingStatsBar';
import { QuiverTapSignature } from './ranking/QuiverTapSignature';
import { RankingUpdatedAt } from './ranking/RankingUpdatedAt';
import { useRankingLiveIndicator, useRankingSocketConnected } from '../hooks/useRankingSocketConnected';

export interface RankingTvViewProps {
  kicker: string;
  title: string;
  subtitle?: string;
  badge?: string;
  exitTo: string;
  entries: RankingEntry[];
  lastUpdatedAt?: number;
  isDemo?: boolean;
  updateMode?: 'socket' | 'polling';
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  linkToClientHistory?: boolean;
  autoScroll?: boolean;
  breweryName?: string | null;
  breweryLogoUrl?: string | null;
}

function EmptyIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40" aria-hidden>
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" />
    </svg>
  );
}

export function RankingTvView({
  kicker,
  title,
  subtitle,
  badge,
  exitTo,
  entries,
  lastUpdatedAt,
  isDemo = false,
  updateMode = 'socket',
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'Ainda não há consumo registrado neste evento.',
  linkToClientHistory = false,
  autoScroll = true,
  breweryName: breweryNameProp,
  breweryLogoUrl: breweryLogoUrlProp,
}: RankingTvViewProps) {
  const { cervejaria } = useAuth();
  const socketConnected = useRankingSocketConnected(!isDemo && updateMode === 'socket');
  const socketLive = useRankingLiveIndicator(socketConnected, isDemo);
  const isLive = updateMode === 'polling' ? false : socketLive;
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  const breweryName = breweryNameProp ?? cervejaria?.nome ?? (isDemo ? 'Cervejaria Demo' : null);
  const breweryLogoUrl = breweryLogoUrlProp ?? cervejaria?.logoUrl ?? null;

  const stats = useMemo(() => computeRankingStats(entries), [entries]);
  const leaderMl = stats?.leaderMl ?? 0;

  const syncFullscreen = useCallback(() => {
    setIsNativeFullscreen(!!document.fullscreenElement);
  }, []);

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [syncFullscreen]);

  const toggleNativeFullscreen = useCallback(() => {
    const root = document.querySelector('.qt-tv');
    if (!root) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void root.requestFullscreen?.();
    }
  }, []);

  return (
    <div className="tap-champions">
      <RankingHeader
        kicker={kicker}
        title={title}
        subtitle={subtitle}
        badge={badge ?? (updateMode === 'polling' ? 'Atualiza a cada minuto' : undefined)}
        breweryName={breweryName}
        breweryLogoUrl={breweryLogoUrl}
        breweryLogoVersion={cervejaria?.logoVersion ?? cervejaria?.updatedAt}
        isLive={isLive}
      />

      <RankingStatsBar
        stats={stats}
        exitTo={exitTo}
        isNativeFullscreen={isNativeFullscreen}
        onToggleNativeFullscreen={toggleNativeFullscreen}
      />

      <main className="tap-champions-main">
        {loading ? (
          <div className="tap-champions-empty" role="status"><p className="tap-champions-empty-title">Carregando ranking…</p></div>
        ) : error ? (
          <div className="tap-champions-empty" role="alert">
            <p className="tap-champions-empty-title">{error}</p>
            {onRetry && <button type="button" className="touch-btn-secondary touch-btn-sm mt-4" onClick={onRetry}>Tentar novamente</button>}
          </div>
        ) : entries.length === 0 ? (
          <div className="tap-champions-empty">
            <EmptyIcon />
            <p className="tap-champions-empty-title">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <>
            <RankingPodium entries={entries} leaderMl={leaderMl} linkToClientHistory={linkToClientHistory} />
            <RankingRestGrid entries={entries} leaderMl={leaderMl} linkToClientHistory={linkToClientHistory} autoScroll={autoScroll} />
          </>
        )}
      </main>

      <footer className="tap-champions-footer">
        <RankingUpdatedAt lastUpdatedAt={lastUpdatedAt} />
        <p className="tap-champions-footer-note">
          Quiver TAP: Transforme consumo em experiência.
        </p>
        <QuiverTapSignature />
      </footer>
    </div>
  );
}
