import { toNumber } from './utils.js';
import { isBebidaChope } from './produto-utils.js';
import type { FormatoBebida, ProdutoTipo } from '@prisma/client';
import {
  BRAZIL_TZ,
  floorTo15MinUtc,
  formatIntervalLabel,
} from './event-datetime.js';
import {
  getCloseTime,
  getScheduledEventWindow,
  INTERVAL_MS,
  type ComandaCloseInput,
} from './evento-vendas-intervalo.js';

type EventoWindowInput = {
  data: Date | null;
  horaInicio: string;
  horaFim: string | null;
};

export type FluxoComandaInput = ComandaCloseInput & {
  id: string;
  status: string;
  createdAt: Date;
  itens: Array<{
    id: string;
    createdAt: Date;
    precoUnit: unknown;
    quantidade: number;
    volumeMl?: number;
    produto?: { tipo: string; formato: string | null };
  }>;
};

export type FluxoRemocaoInput = {
  comandaId: string;
  createdAt: Date;
  valor: number;
};

function itemValor(item: { precoUnit: unknown; quantidade: number }) {
  return toNumber(item.precoUnit) * item.quantidade;
}

function isComandaOpenAt(comanda: FluxoComandaInput, instant: Date): boolean {
  if (comanda.status === 'CANCELADA') return false;
  if (comanda.createdAt.getTime() > instant.getTime()) return false;

  if (comanda.status === 'FECHADA') {
    const closedAt = getCloseTime(comanda);
    if (closedAt.getTime() <= instant.getTime()) return false;
  }

  return true;
}

function computeOpenAt(
  comandas: FluxoComandaInput[],
  remocoes: FluxoRemocaoInput[],
  instant: Date,
): number {
  let open = 0;

  for (const comanda of comandas) {
    if (!isComandaOpenAt(comanda, instant)) continue;

    for (const item of comanda.itens) {
      if (item.createdAt.getTime() <= instant.getTime()) {
        open += itemValor(item);
      }
    }
  }

  for (const remocao of remocoes) {
    if (remocao.createdAt.getTime() <= instant.getTime()) continue;

    const comanda = comandas.find((c) => c.id === remocao.comandaId);
    if (comanda && isComandaOpenAt(comanda, instant)) {
      open += remocao.valor;
    }
  }

  return open;
}

function computeFluxoWindow(
  evento: EventoWindowInput,
  comandas: FluxoComandaInput[],
  remocoes: FluxoRemocaoInput[],
) {
  const scheduled = getScheduledEventWindow(evento);
  const times: number[] = [
    floorTo15MinUtc(scheduled.start, BRAZIL_TZ).getTime(),
    scheduled.end.getTime(),
  ];

  for (const comanda of comandas) {
    if (comanda.status === 'CANCELADA') continue;
    for (const item of comanda.itens) {
      times.push(floorTo15MinUtc(item.createdAt, BRAZIL_TZ).getTime());
    }
    if (comanda.status === 'FECHADA') {
      times.push(floorTo15MinUtc(getCloseTime(comanda), BRAZIL_TZ).getTime());
    }
  }

  for (const remocao of remocoes) {
    times.push(floorTo15MinUtc(remocao.createdAt, BRAZIL_TZ).getTime());
  }

  let startMs = Math.min(...times);
  let endMs = Math.max(...times) + INTERVAL_MS;

  if (!Number.isFinite(startMs)) {
    startMs = floorTo15MinUtc(scheduled.start, BRAZIL_TZ).getTime();
    endMs = scheduled.end.getTime();
  }

  return { startMs, endMs };
}

export function buildFluxoPorIntervalo(
  evento: EventoWindowInput,
  comandas: FluxoComandaInput[],
  remocoes: FluxoRemocaoInput[] = [],
) {
  const activeComandas = comandas.filter((c) => c.status !== 'CANCELADA');
  const { startMs, endMs } = computeFluxoWindow(evento, activeComandas, remocoes);

  const statsMap = new Map<
    number,
    { pedido: number; fechado: number; aberto: number; chopeMl: number; itens: number; comandasFechadas: number }
  >();

  for (let t = startMs; t < endMs; t += INTERVAL_MS) {
    statsMap.set(t, { pedido: 0, fechado: 0, aberto: 0, chopeMl: 0, itens: 0, comandasFechadas: 0 });
  }

  for (const comanda of activeComandas) {
    for (const item of comanda.itens) {
      const bucketTime = floorTo15MinUtc(item.createdAt, BRAZIL_TZ).getTime();
      if (!statsMap.has(bucketTime)) {
        statsMap.set(bucketTime, { pedido: 0, fechado: 0, aberto: 0, chopeMl: 0, itens: 0, comandasFechadas: 0 });
      }
      const stats = statsMap.get(bucketTime)!;
      stats.pedido += itemValor(item);
      stats.itens += item.quantidade;
      if (
        item.volumeMl != null &&
        item.produto &&
        isBebidaChope(item.produto.tipo as ProdutoTipo, item.produto.formato as FormatoBebida | null)
      ) {
        stats.chopeMl += item.volumeMl * item.quantidade;
      }
    }

    if (comanda.status === 'FECHADA') {
      const bucketTime = floorTo15MinUtc(getCloseTime(comanda), BRAZIL_TZ).getTime();
      if (!statsMap.has(bucketTime)) {
        statsMap.set(bucketTime, { pedido: 0, fechado: 0, aberto: 0, chopeMl: 0, itens: 0, comandasFechadas: 0 });
      }
      const stats = statsMap.get(bucketTime)!;
      stats.fechado += toNumber(comanda.total);
      stats.comandasFechadas += 1;
    }
  }

  for (const [t, stats] of statsMap) {
    const bucketEnd = new Date(t + INTERVAL_MS);
    stats.aberto = computeOpenAt(activeComandas, remocoes, bucketEnd);
  }

  return Array.from(statsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, stats]) => ({
      intervalo: formatIntervalLabel(new Date(t), BRAZIL_TZ),
      inicio: new Date(t).toISOString(),
      pedido: stats.pedido,
      fechado: stats.fechado,
      aberto: stats.aberto,
      chopeMl: stats.chopeMl,
      itens: stats.itens,
      comandasFechadas: stats.comandasFechadas,
    }));
}

export function sumFluxoFechado(buckets: Array<{ fechado: number }>): number {
  return buckets.reduce((sum, b) => sum + b.fechado, 0);
}
