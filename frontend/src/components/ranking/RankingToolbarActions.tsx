import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

function ExitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TvIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="5" width="18" height="13" rx="2" />
      <path d="M8 22h8M12 18v4M8 2l4 3 4-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M9 3H5a2 2 0 00-2 2v4M15 3h4a2 2 0 012 2v4M9 21H5a2 2 0 01-2-2v-4M15 21h4a2 2 0 002-2v-4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" strokeLinecap="round" />
    </svg>
  );
}

interface RankingToolbarActionsProps {
  exitTo?: string;
  tvTo?: string;
  exitLabel?: string;
  isNativeFullscreen?: boolean;
  onToggleNativeFullscreen?: () => void;
  leading?: ReactNode;
}

export function RankingToolbarActions({
  exitTo,
  tvTo,
  exitLabel = 'Sair da tela cheia',
  isNativeFullscreen = false,
  onToggleNativeFullscreen,
  leading,
}: RankingToolbarActionsProps) {
  return (
    <div className="tap-champions-stats-actions">
      {leading}
      {tvTo && (
        <Link to={tvTo} className="tap-champions-icon-btn" aria-label="Abrir modo TV" title="Modo TV">
          <TvIcon />
        </Link>
      )}
      {onToggleNativeFullscreen && (
        <button
          type="button"
          className="tap-champions-icon-btn"
          onClick={onToggleNativeFullscreen}
          aria-label={isNativeFullscreen ? 'Sair da tela cheia do navegador' : 'Tela cheia do navegador'}
          title={isNativeFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          <FullscreenIcon active={isNativeFullscreen} />
        </button>
      )}
      {exitTo && (
        <Link
          to={exitTo}
          className="tap-champions-icon-btn"
          aria-label={exitLabel}
          title={exitLabel}
        >
          <ExitIcon />
        </Link>
      )}
    </div>
  );
}
