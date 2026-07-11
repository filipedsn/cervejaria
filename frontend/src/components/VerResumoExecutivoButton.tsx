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
      className={`touch-btn-secondary touch-btn-sm inline-flex items-center justify-center gap-2 ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      <span aria-hidden>📊</span>
      Resumo executivo
    </Link>
  );
}
