import type { TipoMovimentoEstoqueOperacao } from '@prisma/client';
import type { DashboardPeriodoResolvido } from '../cervejaria-dashboard-periodo.js';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../canonical-pdv-operational-config.js';
import { itemContaNaVendaLiquida } from '../venda-liquida.js';

export type MovimentoAgg = {
  entradas: number;
  saidasVenda: number;
  estornos: number;
  perdas: number;
  cortesias: number;
  consumoInterno: number;
  ajustes: number;
};

export type ProdutoListaRow = {
  produtoId: string;
  nome: string;
  quantidadeVendida: number;
  receita: number;
  entradas: number;
  saidasVenda: number;
  outros: number;
  ajustes: number;
  saldoAtual: number | null;
};

export type ProdutoDiaRow = {
  dia: string;
  label: string;
  quantidadeVendida: number;
  receita: number;
  entradas: number;
  saidasVenda: number;
  estornos: number;
  outros: number;
  ajustes: number;
  deltaEstoque: number;
  movimentos: Array<{
    id: string;
    tipo: TipoMovimentoEstoqueOperacao;
    quantidade: number;
    createdAt: string;
    observacao: string | null;
    pontoVendaId: string;
  }>;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Local calendar day key (same convention as Quadro evolucao diaria). */
export function dayKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayLabelPt(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  if (!y || !m || !d) return isoDay;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function emptyMovimentoAgg(): MovimentoAgg {
  return {
    entradas: 0,
    saidasVenda: 0,
    estornos: 0,
    perdas: 0,
    cortesias: 0,
    consumoInterno: 0,
    ajustes: 0,
  };
}

/** Fold one movement into buckets. Quantities are always stored positive. */
export function applyMovimento(agg: MovimentoAgg, tipo: TipoMovimentoEstoqueOperacao, quantidade: number): MovimentoAgg {
  const q = Math.abs(quantidade);
  switch (tipo) {
    case 'ENTRADA':
      agg.entradas = round3(agg.entradas + q);
      break;
    case 'SAIDA_VENDA':
      agg.saidasVenda = round3(agg.saidasVenda + q);
      break;
    case 'ESTORNO_VENDA':
      agg.estornos = round3(agg.estornos + q);
      break;
    case 'PERDA':
      agg.perdas = round3(agg.perdas + q);
      break;
    case 'CORTESIA':
      agg.cortesias = round3(agg.cortesias + q);
      break;
    case 'CONSUMO_INTERNO':
      agg.consumoInterno = round3(agg.consumoInterno + q);
      break;
    case 'AJUSTE':
      agg.ajustes = round3(agg.ajustes + q);
      break;
    default:
      break;
  }
  return agg;
}

export function outrosFromAgg(agg: MovimentoAgg): number {
  return round3(agg.perdas + agg.cortesias + agg.consumoInterno);
}

/** Stock delta ignoring AJUSTE (sign of AJUSTE is not stored). */
export function deltaEstoqueFromAgg(agg: MovimentoAgg): number {
  return round3(agg.entradas + agg.estornos - agg.saidasVenda - outrosFromAgg(agg));
}

export function eachDayKeys(inicio: Date, fim: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const end = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 400) {
    keys.push(dayKeyLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}

type SaleItem = {
  produtoId: string;
  nome: string;
  quantidade: number;
  receita: number;
  day: string;
};

export function aggregateSalesByProduct(
  items: SaleItem[],
): Map<string, { nome: string; quantidade: number; receita: number }> {
  const map = new Map<string, { nome: string; quantidade: number; receita: number }>();
  for (const item of items) {
    const row = map.get(item.produtoId) ?? { nome: item.nome, quantidade: 0, receita: 0 };
    row.quantidade += item.quantidade;
    row.receita += item.receita;
    if (item.nome) row.nome = item.nome;
    map.set(item.produtoId, row);
  }
  return map;
}

export function mergeListaRows(params: {
  sales: Map<string, { nome: string; quantidade: number; receita: number }>;
  movimentos: Map<string, MovimentoAgg>;
  nomes: Map<string, string>;
  saldos: Map<string, number>;
  controlaEstoque: boolean;
  incluirZerados: boolean;
}): ProdutoListaRow[] {
  const ids = new Set<string>([
    ...params.sales.keys(),
    ...params.movimentos.keys(),
    ...(params.controlaEstoque ? params.saldos.keys() : []),
  ]);

  const rows: ProdutoListaRow[] = [];
  for (const produtoId of ids) {
    const sale = params.sales.get(produtoId);
    const mov = params.movimentos.get(produtoId) ?? emptyMovimentoAgg();
    const outros = outrosFromAgg(mov);
    const quantidadeVendida = sale?.quantidade ?? 0;
    const receita = sale?.receita ?? 0;
    const hasActivity =
      quantidadeVendida > 0 ||
      mov.entradas > 0 ||
      mov.saidasVenda > 0 ||
      mov.estornos > 0 ||
      outros > 0 ||
      mov.ajustes > 0;
    if (!params.incluirZerados && !hasActivity) continue;

    rows.push({
      produtoId,
      nome: sale?.nome ?? params.nomes.get(produtoId) ?? 'Produto',
      quantidadeVendida: round3(quantidadeVendida),
      receita: roundMoney(receita),
      entradas: mov.entradas,
      saidasVenda: mov.saidasVenda,
      outros,
      ajustes: mov.ajustes,
      saldoAtual: params.controlaEstoque ? round3(params.saldos.get(produtoId) ?? 0) : null,
    });
  }

  return rows.sort((a, b) => b.receita - a.receita || b.quantidadeVendida - a.quantidadeVendida || a.nome.localeCompare(b.nome));
}

async function fetchClosedSaleItems(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  pontoVendaId: string | undefined,
  canonicalPdvEnabled: boolean,
  produtoId?: string,
) {
  const comandas = await prisma.comanda.findMany({
    where: {
      ...(canonicalPdvEnabled
        ? { origem: { in: ['CAIXA', 'EVENTO'] }, pontoVendaId: { not: null } }
        : { origem: 'CAIXA' }),
      pontoVenda: { cervejariaId },
      status: 'FECHADA',
      fechadaEm: { gte: inicio, lte: fim },
      ...(pontoVendaId ? { pontoVendaId } : {}),
    },
    select: {
      fechadaEm: true,
      itens: {
        where: produtoId ? { produtoId } : undefined,
        select: {
          produtoId: true,
          nome: true,
          quantidade: true,
          precoUnit: true,
          canceladoEm: true,
          cancelamentoPendenteEm: true,
        },
      },
    },
  });

  const items: SaleItem[] = [];
  for (const comanda of comandas) {
    if (!comanda.fechadaEm) continue;
    const day = dayKeyLocal(comanda.fechadaEm);
    for (const item of comanda.itens) {
      if (!item.produtoId || !itemContaNaVendaLiquida(item)) continue;
      items.push({
        produtoId: item.produtoId,
        nome: item.nome ?? 'Item',
        quantidade: item.quantidade,
        receita: toNumber(item.precoUnit) * item.quantidade,
        day,
      });
    }
  }
  return items;
}

async function fetchMovimentos(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  pontoVendaId: string | undefined,
  produtoId?: string,
) {
  return prisma.inventoryMovement.findMany({
    where: {
      cervejariaId,
      createdAt: { gte: inicio, lte: fim },
      ...(pontoVendaId ? { pontoVendaId } : {}),
      ...(produtoId ? { produtoId } : {}),
    },
    select: {
      id: true,
      produtoId: true,
      pontoVendaId: true,
      tipo: true,
      quantidade: true,
      observacao: true,
      createdAt: true,
      produto: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function buildDashboardProdutosLista(
  cervejariaId: string,
  periodo: DashboardPeriodoResolvido,
  options: {
    pontoVendaId?: string;
    controlaEstoque: boolean;
    incluirZerados?: boolean;
  },
) {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId);
  const canonicalPdvEnabled = canonical !== null;
  const incluirZerados = options.incluirZerados === true;

  const [saleItems, movimentos] = await Promise.all([
    fetchClosedSaleItems(
      cervejariaId,
      periodo.inicio,
      periodo.fim,
      options.pontoVendaId,
      canonicalPdvEnabled,
    ),
    options.controlaEstoque
      ? fetchMovimentos(cervejariaId, periodo.inicio, periodo.fim, options.pontoVendaId)
      : Promise.resolve([]),
  ]);

  const sales = aggregateSalesByProduct(saleItems);
  const movMap = new Map<string, MovimentoAgg>();
  const nomes = new Map<string, string>();
  for (const mov of movimentos) {
    nomes.set(mov.produtoId, mov.produto.nome);
    const agg = movMap.get(mov.produtoId) ?? emptyMovimentoAgg();
    applyMovimento(agg, mov.tipo, toNumber(mov.quantidade));
    movMap.set(mov.produtoId, agg);
  }

  const saldos = new Map<string, number>();
  if (options.controlaEstoque) {
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        cervejariaId,
        ...(options.pontoVendaId ? { pontoVendaId: options.pontoVendaId } : {}),
      },
      select: { produtoId: true, quantidade: true, produto: { select: { nome: true } } },
    });
    for (const bal of balances) {
      nomes.set(bal.produtoId, bal.produto.nome);
      saldos.set(bal.produtoId, round3((saldos.get(bal.produtoId) ?? 0) + toNumber(bal.quantidade)));
    }
  }

  const produtos = mergeListaRows({
    sales,
    movimentos: movMap,
    nomes,
    saldos,
    controlaEstoque: options.controlaEstoque,
    incluirZerados,
  });

  return {
    periodo: {
      tipo: periodo.tipo,
      label: periodo.label,
      inicio: periodo.inicio.toISOString(),
      fim: periodo.fim.toISOString(),
      ...(periodo.tipo === 'mes' ? { ano: periodo.ano, mes: periodo.mes } : { de: periodo.de, ate: periodo.ate }),
    },
    controlaEstoque: options.controlaEstoque,
    pontoVendaId: options.pontoVendaId ?? null,
    escopoEstoque: options.pontoVendaId ? 'ponto' : 'todas_unidades',
    produtos,
  };
}

export async function buildDashboardProdutoDetalhe(
  cervejariaId: string,
  produtoId: string,
  periodo: DashboardPeriodoResolvido,
  options: {
    pontoVendaId?: string;
    controlaEstoque: boolean;
  },
) {
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, cervejariaId },
    select: { id: true, nome: true },
  });
  if (!produto) return null;

  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId);
  const canonicalPdvEnabled = canonical !== null;

  const [saleItems, movimentos] = await Promise.all([
    fetchClosedSaleItems(
      cervejariaId,
      periodo.inicio,
      periodo.fim,
      options.pontoVendaId,
      canonicalPdvEnabled,
      produtoId,
    ),
    options.controlaEstoque
      ? fetchMovimentos(cervejariaId, periodo.inicio, periodo.fim, options.pontoVendaId, produtoId)
      : Promise.resolve([]),
  ]);

  const dayKeys = eachDayKeys(periodo.inicio, periodo.fim);
  const byDay = new Map<
    string,
    {
      quantidadeVendida: number;
      receita: number;
      mov: MovimentoAgg;
      movimentos: ProdutoDiaRow['movimentos'];
    }
  >();
  for (const key of dayKeys) {
    byDay.set(key, {
      quantidadeVendida: 0,
      receita: 0,
      mov: emptyMovimentoAgg(),
      movimentos: [],
    });
  }

  for (const item of saleItems) {
    const bucket = byDay.get(item.day);
    if (!bucket) continue;
    bucket.quantidadeVendida += item.quantidade;
    bucket.receita += item.receita;
  }

  for (const mov of movimentos) {
    const key = dayKeyLocal(mov.createdAt);
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = {
        quantidadeVendida: 0,
        receita: 0,
        mov: emptyMovimentoAgg(),
        movimentos: [],
      };
      byDay.set(key, bucket);
    }
    applyMovimento(bucket.mov, mov.tipo, toNumber(mov.quantidade));
    bucket.movimentos.push({
      id: mov.id,
      tipo: mov.tipo,
      quantidade: round3(toNumber(mov.quantidade)),
      createdAt: mov.createdAt.toISOString(),
      observacao: mov.observacao,
      pontoVendaId: mov.pontoVendaId,
    });
  }

  const dias: ProdutoDiaRow[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, bucket]) => {
      const outros = outrosFromAgg(bucket.mov);
      return {
        dia,
        label: dayLabelPt(dia),
        quantidadeVendida: round3(bucket.quantidadeVendida),
        receita: roundMoney(bucket.receita),
        entradas: bucket.mov.entradas,
        saidasVenda: bucket.mov.saidasVenda,
        estornos: bucket.mov.estornos,
        outros,
        ajustes: bucket.mov.ajustes,
        deltaEstoque: deltaEstoqueFromAgg(bucket.mov),
        movimentos: bucket.movimentos,
      };
    })
    .filter(
      (row) =>
        row.quantidadeVendida > 0 ||
        row.entradas > 0 ||
        row.saidasVenda > 0 ||
        row.estornos > 0 ||
        row.outros > 0 ||
        row.ajustes > 0,
    );

  const totais = dias.reduce(
    (acc, row) => {
      acc.quantidadeVendida += row.quantidadeVendida;
      acc.receita += row.receita;
      acc.entradas += row.entradas;
      acc.saidasVenda += row.saidasVenda;
      acc.estornos += row.estornos;
      acc.outros += row.outros;
      acc.ajustes += row.ajustes;
      return acc;
    },
    {
      quantidadeVendida: 0,
      receita: 0,
      entradas: 0,
      saidasVenda: 0,
      estornos: 0,
      outros: 0,
      ajustes: 0,
    },
  );

  let saldoAtual: number | null = null;
  if (options.controlaEstoque) {
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        cervejariaId,
        produtoId,
        ...(options.pontoVendaId ? { pontoVendaId: options.pontoVendaId } : {}),
      },
      select: { quantidade: true },
    });
    saldoAtual = round3(balances.reduce((sum, bal) => sum + toNumber(bal.quantidade), 0));
  }

  return {
    periodo: {
      tipo: periodo.tipo,
      label: periodo.label,
      inicio: periodo.inicio.toISOString(),
      fim: periodo.fim.toISOString(),
      ...(periodo.tipo === 'mes' ? { ano: periodo.ano, mes: periodo.mes } : { de: periodo.de, ate: periodo.ate }),
    },
    controlaEstoque: options.controlaEstoque,
    pontoVendaId: options.pontoVendaId ?? null,
    escopoEstoque: options.pontoVendaId ? 'ponto' : 'todas_unidades',
    produto: { id: produto.id, nome: produto.nome },
    totais: {
      quantidadeVendida: round3(totais.quantidadeVendida),
      receita: roundMoney(totais.receita),
      entradas: round3(totais.entradas),
      saidasVenda: round3(totais.saidasVenda),
      estornos: round3(totais.estornos),
      outros: round3(totais.outros),
      ajustes: round3(totais.ajustes),
      saldoAtual,
    },
    dias,
  };
}
