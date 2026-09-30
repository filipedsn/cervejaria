import type { Prisma } from '@prisma/client';
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

export type EventoTipoFiltro = 'todos' | 'agendado' | 'avulso' | 'caixa';

function eventoTipoWhere(tipo: EventoTipoFiltro) {
  if (tipo === 'agendado') return { serieId: { not: null } };
  if (tipo === 'avulso') return { serieId: null, recorrencia: 'NENHUMA' as const };
  return {};
}

async function fetchPosicaoFinanceira(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId: string | undefined,
  tipo: EventoTipoFiltro,
) {
  let comandasCaixaIds: string[] | undefined;
  if (trailerId && (tipo === 'todos' || tipo === 'caixa')) {
    const sessoes = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId, trailerId },
      select: { pontoVendaId: true, diaOperacional: true, abertoEm: true, fechadoEm: true },
    });
    const comandas = sessoes.length
      ? await prisma.comanda.findMany({
          where: {
            origem: 'CAIXA', status: 'FECHADA', pontoVenda: { cervejariaId },
            OR: sessoes.map((sessao) => ({
              pontoVendaId: sessao.pontoVendaId,
              diaOperacional: sessao.diaOperacional,
              fechadaEm: { gte: sessao.abertoEm, ...(sessao.fechadoEm ? { lte: sessao.fechadoEm } : {}) },
            })),
          },
          select: { id: true },
        })
      : [];
    comandasCaixaIds = comandas.map((comanda) => comanda.id);
  }

  const escopos: Prisma.ComandaWhereInput[] = [];
  if (tipo !== 'caixa') {
    escopos.push({
      origem: 'EVENTO', status: 'FECHADA',
      evento: { cervejariaId, ...(trailerId ? { trailerId } : {}), ...eventoTipoWhere(tipo) },
    });
  }
  if (tipo === 'todos' || tipo === 'caixa') {
    escopos.push({
      origem: 'CAIXA', status: 'FECHADA', pontoVenda: { cervejariaId },
      ...(comandasCaixaIds ? { id: { in: comandasCaixaIds } } : {}),
    });
  }
  const comanda: Prisma.ComandaWhereInput = { OR: escopos };
  const [pagamentos, contas] = await Promise.all([
    prisma.pagamento.findMany({
      where: { pagoEm: { gte: inicio, lte: fim }, comanda },
      select: { forma: true, valor: true },
    }),
    prisma.contaReceber.findMany({
      where: { comanda },
      select: { valorOriginal: true, pagamentos: { select: { valor: true } } },
    }),
  ]);
  const porForma = new Map<string, number>();
  let totalRecebido = 0;
  for (const pagamento of pagamentos) {
    const valor = toNumber(pagamento.valor);
    totalRecebido += valor;
    porForma.set(pagamento.forma, (porForma.get(pagamento.forma) ?? 0) + valor);
  }
  const totalPendente = contas.reduce((soma, conta) => {
    const recebido = conta.pagamentos.reduce((total, pagamento) => total + toNumber(pagamento.valor), 0);
    return soma + Math.max(0, toNumber(conta.valorOriginal) - recebido);
  }, 0);
  return {
    totalRecebido,
    totalPendente,
    porPagamento: [...porForma.entries()].map(([forma, valor]) => ({
      forma, valor, percentual: totalRecebido > 0 ? Math.round((valor / totalRecebido) * 100) : 0,
    })).sort((a, b) => b.valor - a.valor),
  };
}

type EventoFechado = Awaited<ReturnType<typeof fetchClosedComandas>>[number];

async function fetchClosedCaixaComandas(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
) {
  const sessoes = trailerId
    ? await prisma.sessaoCaixaOperacao.findMany({
        where: {
          cervejariaId,
          trailerId,
          abertoEm: { lte: fim },
          OR: [{ fechadoEm: null }, { fechadoEm: { gte: inicio } }],
        },
        select: { pontoVendaId: true, abertoEm: true, fechadoEm: true },
      })
    : [];
  if (trailerId && sessoes.length === 0) return [];

  const pontoVendaIds = trailerId ? [...new Set(sessoes.map((sessao) => sessao.pontoVendaId))] : undefined;
  const comandas = await prisma.comanda.findMany({
    where: {
      origem: 'CAIXA',
      status: 'FECHADA',
      fechadaEm: { gte: inicio, lte: fim },
      pontoVenda: {
        cervejariaId,
        ...(pontoVendaIds ? { id: { in: pontoVendaIds } } : {}),
      },
    },
    include: {
      itens: { include: { produto: true } },
      pagamentos: true,
      fechadoPor: { select: { id: true, nome: true } },
    },
  });

  if (!trailerId) return comandas;
  return comandas.filter((comanda) =>
    sessoes.some((sessao) =>
      sessao.pontoVendaId === comanda.pontoVendaId &&
      comanda.fechadaEm != null &&
      comanda.fechadaEm >= sessao.abertoEm &&
      (sessao.fechadoEm == null || comanda.fechadaEm <= sessao.fechadoEm),
    ),
  );
}

async function buildTurnosCaixaRecentes(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
) {
  const sessoes = await prisma.sessaoCaixaOperacao.findMany({
    where: {
      cervejariaId,
      ...(trailerId ? { trailerId } : {}),
      OR: [
        { status: 'FECHADO', fechadoEm: { gte: inicio, lte: fim } },
        { status: 'ABERTO', abertoEm: { gte: inicio, lte: fim } },
      ],
    },
    include: {
      movimentos: { select: { id: true } },
      pontoVenda: { select: { id: true, nome: true } },
    },
    orderBy: [{ diaOperacional: 'desc' }, { abertoEm: 'desc' }],
    take: 20,
  });

  const agora = new Date();
  const turnos = [];
  for (const sessao of sessoes) {
    const comandas = await prisma.comanda.findMany({
      where: {
        origem: 'CAIXA',
        pontoVenda: { cervejariaId },
        pontoVendaId: sessao.pontoVendaId,
        diaOperacional: sessao.diaOperacional,
        status: 'FECHADA',
        fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm ?? agora },
      },
      include: { itens: { include: { produto: true } } },
    });

    // Turnos sem vendas e sem movimentações de caixa não representam atividade operacional.
    if (comandas.length === 0 && sessao.movimentos.length === 0) continue;

    let chopeMl = 0;
    for (const comanda of comandas) {
      for (const item of comanda.itens) {
        if (item.produto && isBebidaChope(item.produto.tipo, item.produto.formato)) {
          chopeMl += item.volumeMl * item.quantidade;
        }
      }
    }

    const receitaTotal = comandas.reduce((soma, comanda) => soma + toNumber(comanda.total), 0);
    turnos.push({
      sessaoId: sessao.id,
      pontoVendaId: sessao.pontoVendaId,
      pontoNome: sessao.pontoVenda.nome,
      diaOperacional: sessao.diaOperacional,
      status: sessao.status,
      abertoEm: sessao.abertoEm,
      fechadoEm: sessao.fechadoEm,
      receitaTotal,
      comandasAtendidas: comandas.length,
      ticketMedio: comandas.length > 0 ? receitaTotal / comandas.length : 0,
      chopeMl,
      movimentosCaixa: sessao.movimentos.length,
    });
  }

  return turnos.slice(0, 8);
}

type CaixaFechado = Awaited<ReturnType<typeof fetchClosedCaixaComandas>>[number];
type ClosedComanda = EventoFechado | CaixaFechado;

async function fetchClosedDashboardComandas(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
  tipo: EventoTipoFiltro = 'todos',
): Promise<ClosedComanda[]> {
  if (tipo === 'caixa') return fetchClosedCaixaComandas(cervejariaId, inicio, fim, trailerId);
  if (tipo === 'agendado' || tipo === 'avulso') {
    return fetchClosedComandas(cervejariaId, inicio, fim, trailerId, tipo);
  }
  const [eventos, caixa] = await Promise.all([
    fetchClosedComandas(cervejariaId, inicio, fim, trailerId, 'todos'),
    fetchClosedCaixaComandas(cervejariaId, inicio, fim, trailerId),
  ]);
  return [...eventos, ...caixa];
}

async function fetchClosedComandas(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
  tipo: EventoTipoFiltro = 'todos',
) {
  return prisma.comanda.findMany({
    where: {
      status: 'FECHADA',
      OR: [
        { fechadaEm: { gte: inicio, lte: fim } },
        { fechadaEm: null, updatedAt: { gte: inicio, lte: fim } },
      ],
      evento: {
        cervejariaId,
        status: 'FECHADO',
        ...(trailerId ? { trailerId } : {}),
        ...eventoTipoWhere(tipo),
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
  let vendasAvulsas = 0;
  let receitaAvulsa = 0;
  let chopeMl = 0;
  const porProduto = new Map<string, { produtoId: string; nome: string; quantidade: number; receita: number; chopeMl: number }>();
  const porFuncionario = new Map<string, { usuarioId: string | null; nome: string; comandas: number; receita: number }>();

  for (const comanda of comandas) {
    const valor = toNumber(comanda.total);
    receitaTotal += valor;

    if (comanda.tipo === 'AVULSA') {
      vendasAvulsas += 1;
      receitaAvulsa += valor;
    }

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
      if (!item.produto || !item.produtoId) continue;

      const itemValor = toNumber(item.precoUnit) * item.quantidade;
      const prod = porProduto.get(item.produtoId) ?? {
        produtoId: item.produtoId,
        nome: item.produto.nome,
        quantidade: 0,
        receita: 0,
        chopeMl: 0,
      };
      prod.quantidade += item.quantidade;
      prod.receita += itemValor;

      if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
        const ml = item.volumeMl * item.quantidade;
        chopeMl += ml;
        prod.chopeMl += ml;
      }

      porProduto.set(item.produtoId, prod);
    }

  }

  const comandasAtendidas = comandas.length;
  const ticketMedio = comandasAtendidas > 0 ? receitaTotal / comandasAtendidas : 0;

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
    vendasAvulsas,
    receitaAvulsa,
    chopeMl,
    comandasAtendidas,
    ticketMedio,
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
      const w = weekOfMonth(comanda.fechadaEm ?? comanda.updatedAt) - 1;
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

type EventoDuracaoInput = {
  data: Date | null;
  horaInicio: string;
  horaFim: string | null;
  createdAt: Date;
  encerradoEm: Date | null;
};

/**
 * Busca o instante real de início de cada sessão a partir do TransacaoLog
 * (ação de abertura). Retorna o createdAt mais antigo por evento.
 */
async function fetchSessaoInicios(eventoIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (eventoIds.length === 0) return map;

  const logs = await prisma.transacaoLog.findMany({
    where: {
      eventoId: { in: eventoIds },
      tipo: { in: ['EVENTO_SESSAO_INICIADA', 'EVENTO_CRIADO', 'EVENTO_REABERTO'] },
    },
    select: { eventoId: true, createdAt: true },
  });

  for (const log of logs) {
    if (!log.eventoId) continue;
    const atual = map.get(log.eventoId);
    if (!atual || log.createdAt < atual) map.set(log.eventoId, log.createdAt);
  }

  return map;
}

/**
 * Duração real da sessão: do "Iniciar sessão" (TransacaoLog, com fallback para
 * createdAt do evento) até o "Encerrar evento" (encerradoEm). Se não der para
 * determinar, cai na janela planejada (horaInicio/horaFim).
 */
function eventRealDurationHours(evento: EventoDuracaoInput, sessaoInicio?: Date): number {
  const start = sessaoInicio ?? evento.createdAt ?? null;
  const end = evento.encerradoEm ?? null;

  if (start && end) {
    const hours = (end.getTime() - start.getTime()) / MS_HOUR;
    if (hours > 0) return Math.max(Math.round(hours * 100) / 100, 0.25);
  }

  return eventDurationHours(evento);
}

async function buildEventosRecentes(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  trailerId?: string,
  tipo: EventoTipoFiltro = 'todos',
) {
  const eventos = await prisma.evento.findMany({
    where: {
      cervejariaId,
      status: 'FECHADO',
      data: { gte: inicio, lte: fim },
      ...(trailerId ? { trailerId } : {}),
      ...eventoTipoWhere(tipo),
    },
    select: {
      id: true,
      nome: true,
      local: true,
      data: true,
      horaInicio: true,
      horaFim: true,
      createdAt: true,
      encerradoEm: true,
    },
    orderBy: [{ data: 'desc' }, { horaInicio: 'desc' }],
    take: 8,
  });

  if (eventos.length === 0) return [];

  const eventoIds = eventos.map((e) => e.id);

  const [comandas, sessaoInicios] = await Promise.all([
    prisma.comanda.findMany({
      where: {
        eventoId: { in: eventoIds },
        status: 'FECHADA',
      },
      include: { itens: { include: { produto: true } } },
    }),
    fetchSessaoInicios(eventoIds),
  ]);

  const comandasByEvento = new Map<string, typeof comandas>();
  for (const comanda of comandas) {
    if (!comanda.eventoId) continue;
    const list = comandasByEvento.get(comanda.eventoId) ?? [];
    list.push(comanda);
    comandasByEvento.set(comanda.eventoId, list);
  }

  const rows = eventos.map((evento) => {
    const evComandas = comandasByEvento.get(evento.id) ?? [];
    let receitaTotal = 0;
    let vendasAvulsas = 0;
    let receitaAvulsa = 0;
    let chopeMl = 0;

    for (const comanda of evComandas) {
      const valor = toNumber(comanda.total);
      receitaTotal += valor;
      if (comanda.tipo === 'AVULSA') {
        vendasAvulsas += 1;
        receitaAvulsa += valor;
      }
      for (const item of comanda.itens) {
        if (item.produto && isBebidaChope(item.produto.tipo, item.produto.formato)) {
          chopeMl += item.volumeMl * item.quantidade;
        }
      }
    }

    const comandasAtendidas = evComandas.length;
    const ticketMedio = comandasAtendidas > 0 ? receitaTotal / comandasAtendidas : 0;
    const duracaoHoras = eventRealDurationHours(evento, sessaoInicios.get(evento.id));

    return {
      eventoId: evento.id,
      nome: evento.nome,
      local: evento.local,
      data: evento.data,
      horaInicio: evento.horaInicio,
      receitaTotal,
      comandasAtendidas,
      vendasAvulsas,
      receitaAvulsa,
      ticketMedio,
      chopeMl,
      duracaoHoras,
      receitaPorHora: Math.round((receitaTotal / duracaoHoras) * 100) / 100,
      chopeLitrosPorHora: Math.round((chopeMl / 1000 / duracaoHoras) * 100) / 100,
    };
  });

  return rows.sort((a, b) => {
    const dataA = a.data ? new Date(a.data).getTime() : 0;
    const dataB = b.data ? new Date(b.data).getTime() : 0;
    if (dataA !== dataB) return dataA - dataB;
    return a.horaInicio.localeCompare(b.horaInicio);
  });
}

/**
 * Comparativo de rentabilidade por agenda (série recorrente).
 * Agrupa as ocorrências agendadas (serieId != null) do período pela série-mãe.
 */
async function buildComparativoAgendas(
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
      serieId: { not: null },
      ...(trailerId ? { trailerId } : {}),
    },
    select: {
      id: true,
      serieId: true,
      nome: true,
      local: true,
      data: true,
      horaInicio: true,
      horaFim: true,
      createdAt: true,
      encerradoEm: true,
      serie: { select: { nome: true, local: true } },
    },
  });

  if (eventos.length === 0) return [];

  const eventoIds = eventos.map((e) => e.id);

  const [comandas, sessaoInicios] = await Promise.all([
    prisma.comanda.findMany({
      where: {
        eventoId: { in: eventoIds },
        status: 'FECHADA',
      },
      include: { itens: { include: { produto: true } } },
    }),
    fetchSessaoInicios(eventoIds),
  ]);

  const comandasByEvento = new Map<string, typeof comandas>();
  for (const comanda of comandas) {
    if (!comanda.eventoId) continue;
    const list = comandasByEvento.get(comanda.eventoId) ?? [];
    list.push(comanda);
    comandasByEvento.set(comanda.eventoId, list);
  }

  type Grupo = {
    serieId: string;
    nome: string;
    local: string;
    sessoes: number;
    receitaTotal: number;
    comandasAtendidas: number;
    chopeMl: number;
    horasTotais: number;
  };

  const grupos = new Map<string, Grupo>();

  for (const evento of eventos) {
    if (!evento.serieId) continue;
    const serieId = evento.serieId;
    const grupo = grupos.get(serieId) ?? {
      serieId,
      nome: evento.serie?.nome ?? evento.nome,
      local: evento.serie?.local ?? evento.local,
      sessoes: 0,
      receitaTotal: 0,
      comandasAtendidas: 0,
      chopeMl: 0,
      horasTotais: 0,
    };

    const evComandas = comandasByEvento.get(evento.id) ?? [];
    grupo.sessoes += 1;
    grupo.comandasAtendidas += evComandas.length;
    grupo.horasTotais += eventRealDurationHours(evento, sessaoInicios.get(evento.id));

    for (const comanda of evComandas) {
      grupo.receitaTotal += toNumber(comanda.total);
      for (const item of comanda.itens) {
        if (item.produto && isBebidaChope(item.produto.tipo, item.produto.formato)) {
          grupo.chopeMl += item.volumeMl * item.quantidade;
        }
      }
    }

    grupos.set(serieId, grupo);
  }

  return Array.from(grupos.values())
    .map((g) => ({
      serieId: g.serieId,
      nome: g.nome,
      local: g.local,
      sessoes: g.sessoes,
      receitaTotal: Math.round(g.receitaTotal * 100) / 100,
      mediaPorSessao: g.sessoes > 0 ? Math.round((g.receitaTotal / g.sessoes) * 100) / 100 : 0,
      ticketMedio:
        g.comandasAtendidas > 0 ? Math.round((g.receitaTotal / g.comandasAtendidas) * 100) / 100 : 0,
      receitaPorHora: g.horasTotais > 0 ? Math.round((g.receitaTotal / g.horasTotais) * 100) / 100 : 0,
      comandasAtendidas: g.comandasAtendidas,
      chopeLitros: Math.round((g.chopeMl / 1000) * 10) / 10,
      litrosPorHora:
        g.horasTotais > 0 ? Math.round((g.chopeMl / 1000 / g.horasTotais) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.mediaPorSessao - a.mediaPorSessao);
}

export async function buildCervejariaDashboard(
  cervejariaId: string,
  ano: number,
  mes: number,
  trailerId?: string,
  tipo: EventoTipoFiltro = 'todos',
) {
  const now = new Date();
  const anoVigente = now.getFullYear();
  const { inicio, fim } = monthBounds(ano, mes);

  const fechadoPorCtx = await getReportFechadoPorContext(cervejariaId);

  const [comandasMes, comandasAno, eventosRecentes, comparativoAgendas, turnosCaixaRecentes, financeiro] = await Promise.all([
    fetchClosedDashboardComandas(cervejariaId, inicio, fim, trailerId, tipo),
    fetchClosedDashboardComandas(cervejariaId, yearBounds(anoVigente).inicio, yearBounds(anoVigente).fim, trailerId, tipo),
    tipo === 'caixa' ? [] : buildEventosRecentes(cervejariaId, inicio, fim, trailerId, tipo),
    tipo === 'todos' || tipo === 'agendado' ? buildComparativoAgendas(cervejariaId, inicio, fim, trailerId) : [],
    tipo === 'todos' || tipo === 'caixa' ? buildTurnosCaixaRecentes(cervejariaId, inicio, fim, trailerId) : [],
    fetchPosicaoFinanceira(cervejariaId, inicio, fim, trailerId, tipo),
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
    const m = (comanda.fechadaEm ?? comanda.updatedAt).getMonth();
    receitaAnual[m].receita += toNumber(comanda.total);
    receitaAnual[m].comandas += 1;
  }

  const mesAnterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const boundsAnterior = monthBounds(mesAnterior.ano, mesAnterior.mes);
  const comandasMesAnterior = await fetchClosedDashboardComandas(cervejariaId, boundsAnterior.inicio, boundsAnterior.fim, trailerId, tipo);
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
      totalRecebido: financeiro.totalRecebido,
      totalPendente: financeiro.totalPendente,
      comandasAtendidas: resumo.comandasAtendidas,
      vendasAvulsas: resumo.vendasAvulsas,
      receitaAvulsa: resumo.receitaAvulsa,
      ticketMedio: resumo.ticketMedio,
      chopeMl: resumo.chopeMl,
      variacaoReceitaMesAnterior: variacaoReceita,
    },
    evolucaoSemanal,
    porPagamento: financeiro.porPagamento,
    porProduto: resumo.porProduto,
    porFuncionario: resumo.porFuncionario,
    eventosRecentes,
    turnosCaixaRecentes,
    comparativoAgendas,
    receitaAnual: receitaAnual.map((m) => ({
      ...m,
      receita: Math.round(m.receita * 100) / 100,
    })),
    anoVigente,
  };
}
