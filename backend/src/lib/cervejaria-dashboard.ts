import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import { isBebidaChope } from './produto-utils.js';
import {
  getReportFechadoPorContext,
  resolveFechadoPorForReport,
  type ReportFechadoPorContext,
} from './fechado-por-report.js';
import { getScheduledEventWindow } from './evento-vendas-intervalo.js';

const MS_HOUR = 3_600_000;

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
] as const;

function monthBounds(ano: number, mes: number) {
  const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const fim = new Date(ano, mes, 0, 23, 59, 59, 999);
  return { inicio, fim };
}

function yearBounds(ano: number) {
  return {
    inicio: new Date(ano, 0, 1, 0, 0, 0, 0),
    fim: new Date(ano, 11, 31, 23, 59, 59, 999),
  };
}

function weekOfMonth(date: Date): number {
  return Math.min(5, Math.ceil(date.getDate() / 7));
}

function weekLabel(ano: number, mes: number, semana: number): string {
  const lastDay = new Date(ano, mes, 0).getDate();
  const start = (semana - 1) * 7 + 1;
  const end = Math.min(semana * 7, lastDay);
  const mesAbrev = MESES[mes - 1];
  return `${start}–${end} ${mesAbrev}`;
}

type ClosedComanda = Awaited<ReturnType<typeof fetchClosedComandas>>[number];

async function fetchClosedComandas(cervejariaId: string, inicio: Date, fim: Date, trailerId?: string) {
  return prisma.comanda.findMany({
    where: {
      status: 'FECHADA',
      updatedAt: { gte: inicio, lte: fim },
      evento: {
        cervejariaId,
        ...(trailerId ? { trailerId } : {}),
      },
    },
    include: {
      itens: { include: { produto: true } },
      pagamentos: true,
      fechadoPor: { select: { id: true, nome: true } },
    },
  });
}

function aggregateComandas(comandas: ClosedComanda[], fechadoPorCtx: ReportFechadoPorContext) {
  let receitaTotal = 0;
  let chopeMl = 0;
  const porPagamento = new Map<string, number>();
  const porProduto = new Map<string, { produtoId: string; nome: string; quantidade: number; receita: number }>();
  const porFuncionario = new Map<string, { usuarioId: string | null; nome: string; comandas: number; receita: number }>();

  for (const comanda of comandas) {
    const valor = toNumber(comanda.total);
    receitaTotal += valor;

    const resolved = resolveFechadoPorForReport(comanda, fechadoPorCtx);
    const funcKey = resolved.groupKey;
    const func = porFuncionario.get(funcKey) ?? {
      usuarioId: resolved.usuarioId,
      nome: resolved.nome,
      comandas: 0,
      receita: 0,
    };
    func.comandas += 1;
    func.receita += valor;
    porFuncionario.set(funcKey, func);

    for (const item of comanda.itens) {
      const itemValor = toNumber(item.precoUnit) * item.quantidade;
      const prod = porProduto.get(item.produtoId) ?? {
        produtoId: item.produtoId,
        nome: item.produto.nome,
        quantidade: 0,
        receita: 0,
      };
      prod.quantidade += item.quantidade;
      prod.receita += itemValor;
      porProduto.set(item.produtoId, prod);

      if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
        chopeMl += item.volumeMl * item.quantidade;
      }
    }

    for (const pag of comanda.pagamentos) {
      porPagamento.set(pag.forma, (porPagamento.get(pag.forma) ?? 0) + toNumber(pag.valor));
    }
  }

  const comandasAtendidas = comandas.length;
  const ticketMedio = comandasAtendidas > 0 ? receitaTotal / comandasAtendidas : 0;

  const pagamentoTotal = Array.from(porPagamento.values()).reduce((s, v) => s + v, 0);
  const porPagamentoArr = Array.from(porPagamento.entries())
    .map(([forma, valor]) => ({
      forma,
      valor,
      percentual: pagamentoTotal > 0 ? Math.round((valor / pagamentoTotal) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  const porProdutoArr = Array.from(porProduto.values())
    .map((p) => ({
      ...p,
      percentual: receitaTotal > 0 ? Math.round((p.receita / receitaTotal) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15);

  const porFuncionarioArr = Array.from(porFuncionario.values())
    .sort((a, b) => b.receita - a.receita);

  return {
    receitaTotal,
    chopeMl,
    comandasAtendidas,
    ticketMedio,
    porPagamento: porPagamentoArr,
    porProduto: porProdutoArr,
    porFuncionario: porFuncionarioArr,
  };
}

function weeklyEvolution(comandas: ClosedComanda[], ano: number, mes: number) {
  const weeks = [1, 2, 3, 4, 5].map((semana) => ({
    semana,
    label: weekLabel(ano, mes, semana),
    receita: 0,
    comandas: 0,
  }));

  for (const comanda of comandas) {
    const w = weekOfMonth(comanda.updatedAt) - 1;
    if (w >= 0 && w < weeks.length) {
      weeks[w].receita += toNumber(comanda.total);
      weeks[w].comandas += 1;
    }
  }

  return weeks;
}

function eventDurationHours(evento: {
  data: Date | null;
  horaInicio: string;
  horaFim: string | null;
}): number {
  const { start, end } = getScheduledEventWindow(evento);
  const hours = (end.getTime() - start.getTime()) / MS_HOUR;
  return Math.max(Math.round(hours * 100) / 100, 0.25);
}

async function buildEventosRecentes(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
) {
  const eventos = await prisma.evento.findMany({
    where: {
      cervejariaId,
      status: 'FECHADO',
      data: { gte: inicio, lte: fim },
      ...(trailerId ? { trailerId } : {}),
    },
    select: {
      id: true,
      nome: true,
      local: true,
      data: true,
      horaInicio: true,
      horaFim: true,
    },
    orderBy: [{ data: 'desc' }, { horaInicio: 'desc' }],
    take: 8,
  });

  if (eventos.length === 0) return [];

  const comandas = await prisma.comanda.findMany({
    where: {
      eventoId: { in: eventos.map((e) => e.id) },
      status: 'FECHADA',
    },
    include: { itens: { include: { produto: true } } },
  });

  const comandasByEvento = new Map<string, typeof comandas>();
  for (const comanda of comandas) {
    const list = comandasByEvento.get(comanda.eventoId) ?? [];
    list.push(comanda);
    comandasByEvento.set(comanda.eventoId, list);
  }

  return eventos.map((evento) => {
    const evComandas = comandasByEvento.get(evento.id) ?? [];
    let receitaTotal = 0;
    let chopeMl = 0;

    for (const comanda of evComandas) {
      receitaTotal += toNumber(comanda.total);
      for (const item of comanda.itens) {
        if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
          chopeMl += item.volumeMl * item.quantidade;
        }
      }
    }

    const comandasAtendidas = evComandas.length;
    const ticketMedio = comandasAtendidas > 0 ? receitaTotal / comandasAtendidas : 0;
    const duracaoHoras = eventDurationHours(evento);

    return {
      eventoId: evento.id,
      nome: evento.nome,
      local: evento.local,
      data: evento.data,
      horaInicio: evento.horaInicio,
      receitaTotal,
      comandasAtendidas,
      ticketMedio,
      chopeMl,
      duracaoHoras,
      receitaPorHora: Math.round((receitaTotal / duracaoHoras) * 100) / 100,
      chopeLitrosPorHora: Math.round((chopeMl / 1000 / duracaoHoras) * 100) / 100,
    };
  });
}

export async function buildCervejariaDashboard(
  cervejariaId: string,
  ano: number,
  mes: number,
  trailerId?: string,
) {
  const now = new Date();
  const anoVigente = now.getFullYear();
  const { inicio, fim } = monthBounds(ano, mes);

  const fechadoPorCtx = await getReportFechadoPorContext(cervejariaId);

  const [comandasMes, comandasAno, eventosRecentes] = await Promise.all([
    fetchClosedComandas(cervejariaId, inicio, fim, trailerId),
    fetchClosedComandas(cervejariaId, yearBounds(anoVigente).inicio, yearBounds(anoVigente).fim, trailerId),
    buildEventosRecentes(cervejariaId, inicio, fim, trailerId),
  ]);

  const resumo = aggregateComandas(comandasMes, fechadoPorCtx);
  const evolucaoSemanal = weeklyEvolution(comandasMes, ano, mes);

  const receitaAnual = MESES.map((label, i) => ({
    mes: i + 1,
    label,
    receita: 0,
    comandas: 0,
  }));

  for (const comanda of comandasAno) {
    const m = comanda.updatedAt.getMonth();
    receitaAnual[m].receita += toNumber(comanda.total);
    receitaAnual[m].comandas += 1;
  }

  const mesAnterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const boundsAnterior = monthBounds(mesAnterior.ano, mesAnterior.mes);
  const comandasMesAnterior = await fetchClosedComandas(cervejariaId, boundsAnterior.inicio, boundsAnterior.fim, trailerId);
  const resumoAnterior = aggregateComandas(comandasMesAnterior, fechadoPorCtx);

  const variacaoReceita =
    resumoAnterior.receitaTotal > 0
      ? Math.round(((resumo.receitaTotal - resumoAnterior.receitaTotal) / resumoAnterior.receitaTotal) * 100)
      : null;

  return {
    periodo: {
      ano,
      mes,
      label: `${MESES[mes - 1]} ${ano}`,
    },
    resumo: {
      receitaTotal: resumo.receitaTotal,
      comandasAtendidas: resumo.comandasAtendidas,
      ticketMedio: resumo.ticketMedio,
      chopeMl: resumo.chopeMl,
      variacaoReceitaMesAnterior: variacaoReceita,
    },
    evolucaoSemanal,
    porPagamento: resumo.porPagamento,
    porProduto: resumo.porProduto,
    porFuncionario: resumo.porFuncionario,
    eventosRecentes,
    receitaAnual: receitaAnual.map((m) => ({
      ...m,
      receita: Math.round(m.receita * 100) / 100,
    })),
    anoVigente,
  };
}
