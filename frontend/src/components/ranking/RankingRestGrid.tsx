import { memo, useEffect, useRef } from 'react';
import { formatLiters } from '../../lib/api';
import { leaderPercent } from '../../lib/ranking-tv-stats';
import type { RankingEntry } from '../../types';

const RestCard = memo(function RestCard({
  entry,
  leaderMl,
}: {
  entry: RankingEntry;
  leaderMl: number;
}) {
  const pct = leaderPercent(entry.totalMl, leaderMl);

  return (
    <article className="tap-champions-rest-card" aria-label={`${entry.posicao}º lugar: ${entry.nome}`}>
      <div className="tap-champions-rest-row">
        <span className="tap-champions-rest-pos" aria-hidden>
          <span className="tap-champions-rest-pos-hash">#</span>
          {entry.posicao}
        </span>
        <span className="tap-champions-rest-name">{entry.nome}</span>
        <span className="tap-champions-rest-volume">{formatLiters(entry.totalMl)}</span>
      </div>
      <div className="tap-champions-progress mt-2">
        <div className="tap-champions-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="tap-champions-progress-pct">{pct}% do líder</p>
    </article>
  );
});

interface RankingRestGridProps {
  entries: RankingEntry[];
  leaderMl: number;
}

function hasScrollOverflow(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 8;
}

export function RankingRestGrid({ entries, leaderMl }: RankingRestGridProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const rest = entries.filter((e) => e.posicao > 3);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    let direction = 1;
    let pauseUntil = 0;
    let intervalId: number | null = null;

    const stop = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const tick = () => {
      if (Date.now() < pauseUntil) return;
      if (!hasScrollOverflow(el)) return;

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

    const syncAutoScroll = () => {
      stop();

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!hasScrollOverflow(el)) return;
          intervalId = window.setInterval(tick, 30);
        });
      });
    };

    const pauseScroll = () => {
      pauseUntil = Date.now() + 8000;
    };

    el.addEventListener('mouseenter', pauseScroll);
    el.addEventListener('touchstart', pauseScroll, { passive: true });
    document.addEventListener('fullscreenchange', syncAutoScroll);

    const resizeObserver = new ResizeObserver(syncAutoScroll);
    resizeObserver.observe(el);

    syncAutoScroll();

    return () => {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('fullscreenchange', syncAutoScroll);
      el.removeEventListener('mouseenter', pauseScroll);
      el.removeEventListener('touchstart', pauseScroll);
    };
  }, [rest.length]);

  if (rest.length === 0) return null;

  return (
    <section className="tap-champions-rest-section">
      <h2 className="tap-champions-rest-title">Demais colocações</h2>
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden ranking-tv-scroll pr-1"
      >
        <div className="tap-champions-rest-grid pb-4">
          {rest.map((entry) => (
            <RestCard key={entry.clienteId} entry={entry} leaderMl={leaderMl} />
          ))}
        </div>
      </div>
    </section>
  );
}
