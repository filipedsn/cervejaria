import { getCloseTime, type ComandaCloseInput } from './evento-vendas-intervalo.js';

const FAIXAS = [
  { label: 'Até 15 min', min: 0, max: 15 },
  { label: '15–30 min', min: 15, max: 30 },
  { label: '30–60 min', min: 30, max: 60 },
  { label: '1–2 h', min: 60, max: 120 },
  { label: 'Mais de 2 h', min: 120, max: Infinity },
] as const;

type ComandaTempoInput = ComandaCloseInput & {
  itens: Array<{ createdAt: Date }>;
};

function minutosAberta(comanda: ComandaTempoInput): number | null {
  if (comanda.itens.length === 0) return null;
  const firstAt = comanda.itens.reduce(
    (min, item) => (item.createdAt < min ? item.createdAt : min),
    comanda.itens[0].createdAt,
  );
  const diffMs = getCloseTime(comanda).getTime() - firstAt.getTime();
  if (diffMs < 0) return null;
  return diffMs / 60_000;
}

export function buildTempoComandaStats(comandas: ComandaTempoInput[]) {
  const minutos = comandas
    .map(minutosAberta)
    .filter((m): m is number => m != null);

  const mediaMinutos =
    minutos.length > 0 ? Math.round(minutos.reduce((sum, m) => sum + m, 0) / minutos.length) : 0;

  const distribuicao = FAIXAS.map((faixa) => ({
    faixa: faixa.label,
    comandas: minutos.filter((m) => m >= faixa.min && m < faixa.max).length,
  }));

  return { mediaMinutos, distribuicao };
}
