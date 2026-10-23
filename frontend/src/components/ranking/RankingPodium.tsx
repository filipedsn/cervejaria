import { memo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatLiters } from '../../lib/api';
import { leaderPercent } from '../../lib/ranking-tv-stats';
import type { RankingEntry } from '../../types';

interface PodiumCardProps {
  entry: RankingEntry;
  leaderMl: number;
  variant: 'first' | 'second' | 'third';
  orderClass: string;
  linkToClientHistory: boolean;
}

const MEDAL_LABELS = { first: '1', second: '2', third: '3' } as const;
const MEDAL_CLASS = {
  first: 'tap-champions-medal--gold',
  second: 'tap-champions-medal--silver',
  third: 'tap-champions-medal--bronze',
} as const;
const CARD_CLASS = {
  first: 'tap-champions-podium-card--first',
  second: 'tap-champions-podium-card--second',
  third: 'tap-champions-podium-card--third',
} as const;

const PodiumCard = memo(function PodiumCard({
  entry,
  leaderMl,
  variant,
  orderClass,
  linkToClientHistory,
}: PodiumCardProps) {
  const pct = leaderPercent(entry.totalMl, leaderMl);
  const isLeader = variant === 'first';

  return (
    <article
      className={`tap-champions-podium-card ${CARD_CLASS[variant]} ${orderClass}`}
      aria-label={`${entry.posicao}º lugar: ${entry.nome}`}
    >
      {isLeader && <span className="tap-champions-crown" aria-hidden>👑</span>}
      <div className={`tap-champions-medal ${MEDAL_CLASS[variant]}`}>{MEDAL_LABELS[variant]}</div>
      {linkToClientHistory ? (
        <Link className="tap-champions-podium-name ranking-client-link" to={`/clientes/${entry.clienteId}`} title={`Ver histórico de ${entry.nome}`}>
          {entry.nome}
        </Link>
      ) : (
        <p className="tap-champions-podium-name" title={entry.nome}>{entry.nome}</p>
      )}
      <p className="tap-champions-podium-volume">{formatLiters(entry.totalMl)}</p>
      {isLeader ? (
        <p className="tap-champions-podium-label">Líder do ranking</p>
      ) : (
        <p className="tap-champions-podium-label">{pct}% do líder</p>
      )}
      <div className="tap-champions-progress tap-champions-progress--podium">
        <div className="tap-champions-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {isLeader && <p className="tap-champions-progress-pct">100%</p>}
    </article>
  );
});

interface RankingPodiumProps {
  entries: RankingEntry[];
  leaderMl: number;
  linkToClientHistory?: boolean;
}

export function RankingPodium({ entries, leaderMl, linkToClientHistory = false }: RankingPodiumProps) {
  const top3 = entries.filter((e) => e.posicao <= 3);
  if (top3.length === 0) return null;

  const layoutClass =
    top3.length === 1
      ? 'tap-champions-podium tap-champions-podium--single'
      : top3.length === 2
        ? 'tap-champions-podium tap-champions-podium--double'
        : 'tap-champions-podium';

  const byPos = new Map(top3.map((e) => [e.posicao, e]));

  const cards: ReactNode[] = [];

  if (byPos.has(2)) {
    cards.push(
      <PodiumCard
        key={byPos.get(2)!.clienteId}
        entry={byPos.get(2)!}
        leaderMl={leaderMl}
        variant="second"
        orderClass="tap-champions-podium-order-2"
        linkToClientHistory={linkToClientHistory}
      />,
    );
  }
  if (byPos.has(1)) {
    cards.push(
      <PodiumCard
        key={byPos.get(1)!.clienteId}
        entry={byPos.get(1)!}
        leaderMl={leaderMl}
        variant="first"
        orderClass="tap-champions-podium-order-1"
        linkToClientHistory={linkToClientHistory}
      />,
    );
  }
  if (byPos.has(3)) {
    cards.push(
      <PodiumCard
        key={byPos.get(3)!.clienteId}
        entry={byPos.get(3)!}
        leaderMl={leaderMl}
        variant="third"
        orderClass="tap-champions-podium-order-3"
        linkToClientHistory={linkToClientHistory}
      />,
    );
  }

  return <section className={layoutClass}>{cards}</section>;
}
