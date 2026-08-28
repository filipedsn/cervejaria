import type { Evento } from '../types';

type RankingSerieSource = Pick<Evento, 'id' | 'serieId' | 'serie'> &
  Partial<Pick<Evento, 'recorrencia'>>;

export function resolveRankingSerieId(
  eventoId: string,
  sources: Array<RankingSerieSource | null | undefined>,
): string | null {
  for (const source of sources) {
    if (!source) continue;
    if (source.serieId) return source.serieId;
    if (source.serie?.id) return source.serie.id;
    if (source.id === eventoId && source.recorrencia === 'SEMANAL' && !source.serieId) {
      return source.id;
    }
  }
  return null;
}
