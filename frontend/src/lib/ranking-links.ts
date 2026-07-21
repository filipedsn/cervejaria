import type { Evento } from '../types';
import { isSerieEvento } from '../components/EventoFormFields';

export function resolveRankingSerieId(
  eventoId: string,
  sources: Array<Pick<Evento, 'id' | 'serieId' | 'serie' | 'recorrencia'> | null | undefined>,
): string | null {
  for (const source of sources) {
    if (!source) continue;
    if (source.serieId) return source.serieId;
    if (source.serie?.id) return source.serie.id;
    if (source.id === eventoId && isSerieEvento(source)) return source.id;
  }
  return null;
}
