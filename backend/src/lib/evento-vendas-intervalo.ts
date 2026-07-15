import { toNumber } from './utils.js';
import {
  BRAZIL_TZ,
  floorTo15MinUtc,
  formatIntervalLabel,
  parseTimeOnEventDate,
} from './event-datetime.js';

export const INTERVAL_MS = 15 * 60 * 1000;

type EventoWindowInput = {
  data: Date | null;
  horaInicio: string;
  horaFim: string | null;
};

export type ComandaCloseInput = {
  fechadaEm: Date | null;
  updatedAt: Date;
  total: unknown;
  pagamentos: Array<{ pagoEm: Date }>;
};

export function getCloseTime(comanda: ComandaCloseInput): Date {
  if (comanda.fechadaEm) return comanda.fechadaEm;

  if (comanda.pagamentos.length > 0) {
    return comanda.pagamentos.reduce(
      (max, p) => (p.pagoEm > max ? p.pagoEm : max),
      comanda.pagamentos[0].pagoEm,
    );
  }

  return comanda.updatedAt;
}

export function getScheduledEventWindow(evento: EventoWindowInput) {
  const baseDate = evento.data ?? new Date();
  const start = parseTimeOnEventDate(baseDate, evento.horaInicio);
  let end: Date;

  if (evento.horaFim) {
    end = parseTimeOnEventDate(baseDate, evento.horaFim);
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

export function buildVendasPorIntervalo(
  evento: EventoWindowInput,
  comandas: ComandaCloseInput[],
) {
  const scheduled = getScheduledEventWindow(evento);
  const closeBuckets = comandas.map((c) => floorTo15MinUtc(getCloseTime(c), BRAZIL_TZ).getTime());

  let startMs = floorTo15MinUtc(scheduled.start, BRAZIL_TZ).getTime();
  let endMs = scheduled.end.getTime();

  if (closeBuckets.length > 0) {
    startMs = Math.min(startMs, ...closeBuckets);
    endMs = Math.max(endMs, ...closeBuckets) + INTERVAL_MS;
  }

  const statsMap = new Map<number, { receita: number; comandas: number }>();

  for (let t = startMs; t < endMs; t += INTERVAL_MS) {
    statsMap.set(t, { receita: 0, comandas: 0 });
  }

  for (const comanda of comandas) {
    const bucketTime = floorTo15MinUtc(getCloseTime(comanda), BRAZIL_TZ).getTime();

    if (!statsMap.has(bucketTime)) {
      statsMap.set(bucketTime, { receita: 0, comandas: 0 });
    }

    const stats = statsMap.get(bucketTime)!;
    stats.receita += toNumber(comanda.total);
    stats.comandas += 1;
  }

  return Array.from(statsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, stats]) => ({
      intervalo: formatIntervalLabel(new Date(t), BRAZIL_TZ),
      inicio: new Date(t).toISOString(),
      receita: stats.receita,
      comandas: stats.comandas,
    }));
}

export function sumVendasPorIntervalo(
  buckets: Array<{ receita: number }>,
): number {
  return buckets.reduce((sum, b) => sum + b.receita, 0);
}
