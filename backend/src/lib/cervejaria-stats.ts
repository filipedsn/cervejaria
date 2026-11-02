import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import { getZonedParts, zonedTimeToUtc } from './event-datetime.js';

export interface MetricasMes {
  /** Chave YYYY-MM do mês consultado (horário de Brasília). */
  chave: string;
  mes: string;
  faturamento: number;
  comandasAtendidas: number;
  tiposProduto: number;
  produtoMaisVende: string | null;
}

export interface MesAdmin {
  chave: string;
  ano: number;
  mes: number;
  label: string;
  inicio: Date;
  /** Primeiro instante do mês seguinte; o intervalo é [inicio, fimExclusivo). */
  fimExclusivo: Date;
}

const MAX_MESES_SELETOR = 60;

function chaveMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

export function labelMes(ano: number, mes: number): string {
  return new Date(Date.UTC(ano, mes - 1, 15)).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function construirMes(ano: number, mes: number): MesAdmin {
  const proximo = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return {
    chave: chaveMes(ano, mes),
    ano,
    mes,
    label: labelMes(ano, mes),
    inicio: zonedTimeToUtc(ano, mes, 1, 0, 0),
    fimExclusivo: zonedTimeToUtc(proximo.ano, proximo.mes, 1, 0, 0),
  };
}

/** Mês civil de Brasília; sem chave usa o mês corrente. Retorna null para chave inválida ou mês futuro. */
export function resolverMesAdmin(chave: string | undefined, now: Date = new Date()): MesAdmin | null {
  const hoje = getZonedParts(now);
  if (!chave) return construirMes(hoje.year, hoje.month);

  const match = /^(\d{4})-(\d{2})$/.exec(chave.trim());
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) return null;
  if (ano > hoje.year || (ano === hoje.year && mes > hoje.month)) return null;
  return construirMes(ano, mes);
}

/** Do mês corrente (primeiro) até o mês da primeira venda, limitado a cinco anos. */
export function listarMesesAdmin(
  primeiraVenda: Date | null,
  now: Date = new Date(),
): Array<{ chave: string; label: string }> {
  const hoje = getZonedParts(now);
  const limite = primeiraVenda ? getZonedParts(primeiraVenda) : hoje;
  const meses: Array<{ chave: string; label: string }> = [];
  let ano = hoje.year;
  let mes = hoje.month;
  while (meses.length < MAX_MESES_SELETOR) {
    meses.push({ chave: chaveMes(ano, mes), label: labelMes(ano, mes) });
    if (ano < limite.year || (ano === limite.year && mes <= limite.month)) break;
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return meses;
}

export function metricasVazias(mes: Pick<MesAdmin, 'chave' | 'label'>): MetricasMes {
  return {
    chave: mes.chave,
    mes: mes.label,
    faturamento: 0,
    comandasAtendidas: 0,
    tiposProduto: 0,
    produtoMaisVende: null,
  };
}

export type ComandaFechadaResumo = { id: string; total: unknown; cervejariaId: string | null };
export type ItemVendidoResumo = { comandaId: string; produtoId: string; quantidade: number };

export function agregarMetricasMes(
  mes: Pick<MesAdmin, 'chave' | 'label'>,
  comandas: ComandaFechadaResumo[],
  itens: ItemVendidoResumo[],
  nomesProduto: Map<string, string>,
): Map<string, MetricasMes> {
  const empresaDaComanda = new Map<string, string>();
  const totais = new Map<string, { faturamentoCentavos: number; comandas: number; produtos: Map<string, number> }>();

  for (const comanda of comandas) {
    if (!comanda.cervejariaId) continue;
    empresaDaComanda.set(comanda.id, comanda.cervejariaId);
    const atual = totais.get(comanda.cervejariaId) ?? { faturamentoCentavos: 0, comandas: 0, produtos: new Map() };
    atual.faturamentoCentavos += Math.round(toNumber(comanda.total) * 100);
    atual.comandas += 1;
    totais.set(comanda.cervejariaId, atual);
  }

  for (const item of itens) {
    const cervejariaId = empresaDaComanda.get(item.comandaId);
    if (!cervejariaId || item.quantidade <= 0) continue;
    const produtos = totais.get(cervejariaId)!.produtos;
    produtos.set(item.produtoId, (produtos.get(item.produtoId) ?? 0) + item.quantidade);
  }

  const resultado = new Map<string, MetricasMes>();
  for (const [cervejariaId, dados] of totais) {
    let maisVendido: { nome: string; quantidade: number } | null = null;
    for (const [produtoId, quantidade] of dados.produtos) {
      const nome = nomesProduto.get(produtoId) ?? 'Produto removido';
      if (
        !maisVendido ||
        quantidade > maisVendido.quantidade ||
        (quantidade === maisVendido.quantidade && nome.localeCompare(maisVendido.nome, 'pt-BR') < 0)
      ) {
        maisVendido = { nome, quantidade };
      }
    }
    resultado.set(cervejariaId, {
      chave: mes.chave,
      mes: mes.label,
      faturamento: dados.faturamentoCentavos / 100,
      comandasAtendidas: dados.comandas,
      tiposProduto: dados.produtos.size,
      produtoMaisVende: maisVendido?.nome ?? null,
    });
  }
  return resultado;
}

function whereComandasFechadasNoMes(mes: MesAdmin, cervejariaId?: string): Prisma.ComandaWhereInput {
  return {
    status: 'FECHADA',
    OR: [
      { fechadaEm: { gte: mes.inicio, lt: mes.fimExclusivo } },
      { fechadaEm: null, updatedAt: { gte: mes.inicio, lt: mes.fimExclusivo } },
    ],
    ...(cervejariaId
      ? { AND: [{ OR: [{ evento: { cervejariaId } }, { pontoVenda: { cervejariaId } }] }] }
      : {}),
  };
}

/** Comandas fechadas no mês, vindas de evento ou de ponto de venda (caixa/quiosque). */
export async function getMetricasMesPorCervejaria(mes: MesAdmin, cervejariaId?: string): Promise<Map<string, MetricasMes>> {
  const where = whereComandasFechadasNoMes(mes, cervejariaId);
  const [comandas, itens] = await Promise.all([
    prisma.comanda.findMany({
      where,
      select: {
        id: true,
        total: true,
        evento: { select: { cervejariaId: true } },
        pontoVenda: { select: { cervejariaId: true } },
      },
    }),
    prisma.itemComanda.groupBy({
      by: ['comandaId', 'produtoId'],
      where: {
        comanda: where,
        produtoId: { not: null },
        canceladoEm: null,
        cancelamentoPendenteEm: null,
      },
      _sum: { quantidade: true },
    }),
  ]);

  const produtoIds = [...new Set(itens.map((item) => item.produtoId).filter((id): id is string => Boolean(id)))];
  const produtos = produtoIds.length
    ? await prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, nome: true } })
    : [];

  return agregarMetricasMes(
    mes,
    comandas.map((comanda) => ({
      id: comanda.id,
      total: comanda.total,
      cervejariaId: comanda.evento?.cervejariaId ?? comanda.pontoVenda?.cervejariaId ?? null,
    })),
    itens.flatMap((item) => item.produtoId
      ? [{ comandaId: item.comandaId, produtoId: item.produtoId, quantidade: item._sum.quantidade ?? 0 }]
      : []),
    new Map(produtos.map((produto) => [produto.id, produto.nome])),
  );
}

export async function getPrimeiraVendaFechada(): Promise<Date | null> {
  const primeira = await prisma.comanda.findFirst({
    where: { status: 'FECHADA', fechadaEm: { not: null } },
    orderBy: { fechadaEm: 'asc' },
    select: { fechadaEm: true },
  });
  return primeira?.fechadaEm ?? null;
}
