import type { RankingEntry } from '../types';

export interface RankingTvStats {
  participants: number;
  totalMl: number;
  leaderMl: number;
  gapMl: number | null;
}

export function computeRankingStats(entries: RankingEntry[]): RankingTvStats {
  const totalMl = entries.reduce((sum, e) => sum + e.totalMl, 0);
  const leaderMl = entries[0]?.totalMl ?? 0;
  const gapMl = entries.length >= 2 ? leaderMl - entries[1].totalMl : null;

  return {
    participants: entries.length,
    totalMl,
    leaderMl,
    gapMl,
  };
}

export function leaderPercent(entryMl: number, leaderMl: number): number {
  if (leaderMl <= 0) return 0;
  return Math.min(100, Math.round((entryMl / leaderMl) * 100));
}
