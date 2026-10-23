import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRankingStats, leaderPercent } from '../src/lib/ranking-tv-stats';
import type { RankingEntry } from '../src/types';

function entry(posicao: number, clienteId: string, totalMl: number): RankingEntry {
  return { posicao, clienteId, nome: `Cliente ${posicao}`, totalMl, totalValor: totalMl / 100, pedidos: 1 };
}

test('resumo do ranking mantém zero participantes e volume zero', () => {
  assert.deepEqual(computeRankingStats([]), { participants: 0, totalMl: 0, leaderMl: 0, gapMl: null });
});

test('resumo do ranking corresponde aos totais da API para 1, 2 e muitos participantes', () => {
  assert.deepEqual(computeRankingStats([entry(1, 'a', 1250)]), { participants: 1, totalMl: 1250, leaderMl: 1250, gapMl: null });
  assert.deepEqual(computeRankingStats([entry(1, 'a', 1250), entry(2, 'b', 1000)]), { participants: 2, totalMl: 2250, leaderMl: 1250, gapMl: 250 });
  const many = [entry(1, 'a', 1250), entry(2, 'b', 1250), ...Array.from({ length: 8 }, (_, i) => entry(i + 3, `c${i}`, 1000 - i * 100))];
  assert.deepEqual(computeRankingStats(many), { participants: 10, totalMl: 7700, leaderMl: 1250, gapMl: 0 });
  assert.equal(leaderPercent(1250, 1250), 100);
  assert.equal(leaderPercent(0, 0), 0);
});
