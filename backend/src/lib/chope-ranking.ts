import type { FormatoBebida, ProdutoTipo } from '@prisma/client';
import { toNumber } from './utils.js';
import { isBebidaChope } from './produto-utils.js';
import { itemContaNaVendaLiquida } from './venda-liquida.js';

export interface ChopeRankingRow {
  clienteId: string;
  nome: string;
  telefone: string | null;
  totalMl: number;
  totalValor: number;
  pedidos: number;
}

export interface ChopeRankingEntry extends ChopeRankingRow {
  posicao: number;
}

type ComandaForRanking = {
  clienteId: string | null;
  cliente: { nome: string; telefone: string | null } | null;
  itens: Array<{
    volumeMl: number;
    quantidade: number;
    precoUnit: unknown;
    canceladoEm?: unknown;
    cancelamentoPendenteEm?: unknown;
    produto: { tipo: ProdutoTipo; formato: FormatoBebida | null } | null;
  }>;
};

export function aggregateChopeRanking(comandas: ComandaForRanking[]): ChopeRankingRow[] {
  const rankingMap = new Map<string, ChopeRankingRow>();

  for (const comanda of comandas) {
    if (!comanda.clienteId || !comanda.cliente) continue;
    const key = comanda.clienteId;
    const current = rankingMap.get(key) ?? {
      clienteId: comanda.clienteId,
      nome: comanda.cliente.nome,
      telefone: comanda.cliente.telefone,
      totalMl: 0,
      totalValor: 0,
      pedidos: 0,
    };

    for (const item of comanda.itens) {
      if (!item.produto || !itemContaNaVendaLiquida(item)) continue;
      if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
        current.totalMl += item.volumeMl * item.quantidade;
        current.pedidos += item.quantidade;
        current.totalValor += toNumber(item.precoUnit) * item.quantidade;
      }
    }

    rankingMap.set(key, current);
  }

  return Array.from(rankingMap.values())
    .filter((r) => r.totalMl > 0)
    .sort((a, b) => b.totalMl - a.totalMl || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function withRankingPosicao(rows: ChopeRankingRow[]): ChopeRankingEntry[] {
  return rows.map((r, index) => ({ posicao: index + 1, ...r }));
}

export function mesToDateRange(mes: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const gte = new Date(Date.UTC(year, month - 1, 1));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lt = new Date(Date.UTC(nextYear, nextMonth - 1, 1));
  return { gte, lt };
}

export function dateToMesKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function mesesDisponiveisFromDates(datas: Array<Date | null | undefined>): string[] {
  const set = new Set<string>();
  for (const data of datas) {
    if (!data) continue;
    set.add(dateToMesKey(data));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}
