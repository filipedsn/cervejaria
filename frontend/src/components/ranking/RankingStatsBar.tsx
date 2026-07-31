import type { ReactNode, SVGProps } from 'react';
import { formatLiters } from '../../lib/api';
import type { RankingTvStats } from '../../lib/ranking-tv-stats';
import { RankingToolbarActions } from './RankingToolbarActions';

function StatIcon({ className, children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={['tap-champions-stat-icon', className].filter(Boolean).join(' ')}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

function UsersIcon() {
  return (
    <StatIcon className="tap-champions-stat-icon opacity-80">
      <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 011.912-2.706C3.512 11.142 5.632 10.5 8 10.5s4.488.642 6.042 1.047a6.002 6.002 0 011.912 2.706 1.224 1.224 0 01-.569 1.175C14.3 17.138 11.308 18 8 18c-3.308 0-6.3-.862-6.385-1.572zM14.5 16.5c.534 0 1.048-.093 1.532-.262a4.5 4.5 0 00-1.228-1.068 5.32 5.32 0 00-2.804-.602 5.32 5.32 0 00-2.804.602 4.5 4.5 0 00-1.228 1.068c.484.169.998.262 1.532.262h6.804z" />
    </StatIcon>
  );
}

function BeerIcon() {
  return (
    <StatIcon className="tap-champions-stat-icon opacity-80">
      <path fillRule="evenodd" d="M8 2a1 1 0 011 1v1h2V3a1 1 0 112 0v1h.5A2.5 2.5 0 0116 6.5v1.25a5.5 5.5 0 01-2.4 4.56 4.002 4.002 0 01-7.2 0A5.5 5.5 0 014 7.75V6.5A2.5 2.5 0 016.5 4H7V3a1 1 0 011-1zm6.5 5.75V6.5a.5.5 0 00-.5-.5h-8a.5.5 0 00-.5.5v1.25a4 4 0 008 0zM8 14.5a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 008 14.5z" clipRule="evenodd" />
    </StatIcon>
  );
}

function CrownIcon() {
  return (
    <StatIcon className="tap-champions-stat-icon text-[var(--ranking-gold)]">
      <path d="M2 14h16v2H2v-2zm2.5-9L6 9l4-5 4 5 1.5-4L18 14H2l2.5-9z" />
    </StatIcon>
  );
}

function TrendIcon() {
  return (
    <StatIcon className="tap-champions-stat-icon text-[var(--ranking-orange)]">
      <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
    </StatIcon>
  );
}

interface RankingStatsBarProps {
  stats: RankingTvStats | null;
  exitTo: string;
  isNativeFullscreen?: boolean;
  onToggleNativeFullscreen?: () => void;
}

export function RankingStatsBar({
  stats,
  exitTo,
  isNativeFullscreen,
  onToggleNativeFullscreen,
}: RankingStatsBarProps) {
  const items: ReactNode[] = [];

  if (stats) {
    items.push(
      <span key="participants" className="tap-champions-stat">
        <UsersIcon />
        <span>
          <span className="tap-champions-stat-value">{stats.participants}</span>{' '}
          <span className="tap-champions-stat-label">participantes</span>
        </span>
      </span>,
    );

    items.push(<span key="d1" className="tap-champions-stat-divider hidden sm:block" aria-hidden />);

    items.push(
      <span key="total" className="tap-champions-stat">
        <BeerIcon />
        <span>
          <span className="tap-champions-stat-value">{formatLiters(stats.totalMl)}</span>{' '}
          <span className="tap-champions-stat-label">consumidos</span>
        </span>
      </span>,
    );

    if (stats.leaderMl > 0) {
      items.push(<span key="d2" className="tap-champions-stat-divider hidden sm:block" aria-hidden />);
      items.push(
        <span key="leader" className="tap-champions-stat">
          <CrownIcon />
          <span>
            <span className="tap-champions-stat-label">Líder</span>{' '}
            <span className="tap-champions-stat-value tap-champions-stat-value--accent">
              {formatLiters(stats.leaderMl)}
            </span>
          </span>
        </span>,
      );
    }

    if (stats.gapMl != null && stats.gapMl > 0) {
      items.push(<span key="d3" className="tap-champions-stat-divider hidden md:block" aria-hidden />);
      items.push(
        <span key="gap" className="tap-champions-stat hidden md:inline-flex">
          <TrendIcon />
          <span>
            <span className="tap-champions-stat-label">Diferença p/ 2º</span>{' '}
            <span className="tap-champions-stat-value tap-champions-stat-value--accent">
              {formatLiters(stats.gapMl)}
            </span>
          </span>
        </span>,
      );
    }
  }

  return (
    <div className="tap-champions-stats-bar">
      <div className="tap-champions-stats" role="region" aria-label="Indicadores do ranking">
        {items}
      </div>
      <RankingToolbarActions
        exitTo={exitTo}
        isNativeFullscreen={isNativeFullscreen}
        onToggleNativeFullscreen={onToggleNativeFullscreen}
      />
    </div>
  );
}
