type Escopo = 'mensal' | 'geral';

export function rankingSerieTvUrl(serieId: string, escopo: Escopo, mes?: string): string {
  const params = new URLSearchParams({ escopo });
  if (escopo === 'mensal' && mes) params.set('mes', mes);
  return `/ranking/tv/serie/${serieId}?${params.toString()}`;
}

export function rankingPeriodoTvUrl(eventoId: string, escopo: Escopo, mes?: string): string {
  const params = new URLSearchParams({ escopo });
  if (escopo === 'mensal' && mes) params.set('mes', mes);
  return `/ranking/tv/periodo/${eventoId}?${params.toString()}`;
}

export function rankingSeriePageUrl(serieId: string, escopo: Escopo): string {
  return `/ranking/serie/${serieId}?escopo=${escopo}`;
}

export function rankingPeriodoPageUrl(eventoId: string, escopo: Escopo): string {
  return `/ranking/periodo/${eventoId}?escopo=${escopo}`;
}
