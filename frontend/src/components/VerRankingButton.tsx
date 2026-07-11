import { Link } from 'react-router-dom';
import { IconTrophy } from './NavIcons';

interface VerRankingButtonProps {
  eventoId: string;
  className?: string;
  fullWidth?: boolean;
  iconOnly?: boolean;
}

export function VerRankingButton({
  eventoId,
  className = '',
  fullWidth = true,
  iconOnly = false,
}: VerRankingButtonProps) {
  if (iconOnly) {
    return (
      <Link
        to={`/ranking/${eventoId}`}
        title="Ver ranking"
        aria-label="Ver ranking"
        className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white transition hover:bg-white/20 ${className}`}
      >
        <IconTrophy />
      </Link>
    );
  }

  return (
    <Link
      to={`/ranking/${eventoId}`}
      className={`touch-btn-secondary touch-btn-sm inline-flex items-center justify-center gap-2 ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      <IconTrophy className="w-4 h-4" />
      Ver ranking
    </Link>
  );
}
