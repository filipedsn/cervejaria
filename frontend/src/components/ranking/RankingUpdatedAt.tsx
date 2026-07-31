import { useRelativeUpdatedAt } from '../../hooks/useRelativeUpdatedAt';

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4.19l-2.22 2.22a.75.75 0 101.06 1.06l2.5-2.5A.75.75 0 0010.75 10V6.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface RankingUpdatedAtProps {
  lastUpdatedAt?: number;
}

export function RankingUpdatedAt({ lastUpdatedAt }: RankingUpdatedAtProps) {
  const updatedLabel = useRelativeUpdatedAt(lastUpdatedAt);

  return (
    <p className="tap-champions-updated tap-champions-footer-updated" aria-live="polite">
      <ClockIcon />
      <span>Atualizado {updatedLabel}</span>
    </p>
  );
}
