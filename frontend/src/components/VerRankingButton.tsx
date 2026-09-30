import { Link } from 'react-router-dom';
import { IconTrophy } from './NavIcons';

interface VerRankingButtonProps {
  eventoId: string;
  className?: string;
  fullWidth?: boolean;
  iconOnly?: boolean;
  primary?: boolean;
}

export function VerRankingButton({
  eventoId,
  className = '',
  fullWidth = true,
  iconOnly = false,
  primary = false,
}: VerRankingButtonProps) {
  if (iconOnly) {
    return (
      <Link
        to={`/ranking/${eventoId}`}
        title="Ver ranking"
        aria-label="Ver ranking"
        className={`icon-btn-ghost h-12 w-12 border border-line bg-surface ${className}`}
      >
        <IconTrophy />
      </Link>
    );
  }

  const btnClass = primary
    ? `touch-btn-primary inline-flex items-center justify-center gap-2 ${
        fullWidth ? 'w-full min-h-12 text-base' : 'touch-btn-sm px-4'
      }`
    : `touch-btn-secondary touch-btn-sm inline-flex items-center justify-center gap-2 ${
        fullWidth ? 'w-full' : ''
      }`;

  return (
    <Link
      to={`/ranking/${eventoId}`}
      className={`${btnClass} ${className}`}
    >
      <IconTrophy className="w-4 h-4" />
      Ver ranking
    </Link>
  );
}
