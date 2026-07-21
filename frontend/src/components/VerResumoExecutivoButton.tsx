import { Link } from 'react-router-dom';

interface VerResumoExecutivoButtonProps {
  eventoId: string;
  className?: string;
  fullWidth?: boolean;
}

export function VerResumoExecutivoButton({
  eventoId,
  className = '',
  fullWidth = true,
}: VerResumoExecutivoButtonProps) {
  return (
    <Link
      to={`/eventos/${eventoId}/resumo`}
      className={`touch-btn-orange inline-flex items-center justify-center gap-2 ${
        fullWidth ? 'w-full min-h-12 text-base' : 'touch-btn-sm px-4'
      } ${className}`}
    >
      <span aria-hidden>📊</span>
      Resumo executivo
    </Link>
  );
}
