import { prisma } from './prisma.js';

import { toNumber } from './utils.js';

import { isBebidaChope } from './produto-utils.js';

import { getReportFechadoPorContext, resolveFechadoPorForReport } from './fechado-por-report.js';



const INTERVAL_MS = 15 * 60 * 1000;



function parseTimeOnDate(baseDate: Date, time: string): Date {

  const [hours, minutes] = time.split(':').map(Number);

  // evento.data is @db.Date (midnight UTC) — use UTC calendar parts for the local datetime

  const y = baseDate.getUTCFullYear();

  const m = baseDate.getUTCMonth();

  const day = baseDate.getUTCDate();

  return new Date(y, m, day, hours, minutes, 0, 0);

}



function floorTo15Min(date: Date): Date {

  const d = new Date(date);

  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);

  return d;

}



function formatIntervalLabel(date: Date): string {

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

}



function getEventWindow(evento: { data: Date | null; horaInicio: string; horaFim: string | null }) {

  const baseDate = evento.data ?? new Date();

  const start = parseTimeOnDate(baseDate, evento.horaInicio);

  let end: Date;



  if (evento.horaFim) {

    end = parseTimeOnDate(baseDate, evento.horaFim);

    if (end <= start) {

      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    }

  } else {

    end = new Date(start);

    end.setDate(end.getDate() + 1);

    end.setHours(0, 0, 0, 0);

  }



  return { start, end };

}



function buildVendasPorIntervalo(

  evento: { data: Date | null; horaInicio: string; horaFim: string | null },

  comandas: Array<{ updatedAt: Date; total: unknown }>,

) {

  const { start, end } = getEventWindow(evento);

  const statsMap = new Map<number, { receita: number; comandas: number }>();



  for (let t = floorTo15Min(start).getTime(); t < end.getTime(); t += INTERVAL_MS) {

    statsMap.set(t, { receita: 0, comandas: 0 });

  }



  for (const comanda of comandas) {

    const bucketTime = floorTo15Min(comanda.updatedAt).getTime();

    if (bucketTime < start.getTime() || bucketTime >= end.getTime()) continue;



    const stats = statsMap.get(bucketTime);

    if (!stats) continue;



    stats.receita += toNumber(comanda.total);

    stats.comandas += 1;

  }



  return Array.from(statsMap.entries())

    .sort((a, b) => a[0] - b[0])

    .map(([t, stats]) => ({

      intervalo: formatIntervalLabel(new Date(t)),

      inicio: new Date(t).toISOString(),

      receita: stats.receita,

      comandas: stats.comandas,

    }));

}



export async function buildEventoResumoExecutivo(eventoId: string, cervejariaId: string) {

  const evento = await prisma.evento.findFirst({

    where: { id: eventoId, cervejariaId },

    select: {

      id: true,

      nome: true,

      local: true,

      data: true,

      horaInicio: true,

      horaFim: true,

      status: true,

    },

  });



  if (!evento) return null;

  if (evento.status !== 'FECHADO') return { forbidden: true as const, evento };



  const temOutrosProdutos =

    (await prisma.produto.count({

      where: {

        cervejariaId,

        ativo: true,

        OR: [

          { tipo: 'COMIDA' },

          { tipo: 'BEBIDA', formato: { in: ['LATA', 'LONGNECK', 'GARRAFA', 'OUTRO'] } },

        ],

      },

    })) > 0;



  const fechadoPorCtx = await getReportFechadoPorContext(cervejariaId);



  const comandas = await prisma.comanda.findMany({

    where: { eventoId, status: 'FECHADA' },

    include: {

      cliente: { select: { id: true, nome: true } },

      itens: { include: { produto: true } },

      pagamentos: true,

      fechadoPor: { select: { id: true, nome: true } },

    },

    orderBy: { updatedAt: 'asc' },

  });



  let receitaTotal = 0;

  let chopeMl = 0;

  const clientes = new Set<string>();

  const porPagamento = new Map<string, number>();

  const porProduto = new Map<

    string,

    { produtoId: string; nome: string; tipo: string; quantidade: number; receita: number }

  >();

  const porFuncionario = new Map<

    string,

    { usuarioId: string | null; nome: string; comandas: number; receita: number }

  >();

  const rankingMap = new Map<

    string,

    { clienteId: string; nome: string; totalMl: number; totalValor: number; pedidos: number }

  >();

  const topClientesMap = new Map<

    string,

    { clienteId: string; nome: string; receita: number; comandas: number }

  >();



  for (const comanda of comandas) {

    const valor = toNumber(comanda.total);

    receitaTotal += valor;

    clientes.add(comanda.clienteId);



    const topCliente = topClientesMap.get(comanda.clienteId) ?? {

      clienteId: comanda.clienteId,

      nome: comanda.cliente.nome,

      receita: 0,

      comandas: 0,

    };

    topCliente.receita += valor;

    topCliente.comandas += 1;

    topClientesMap.set(comanda.clienteId, topCliente);



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

        tipo: item.produto.tipo,

        quantidade: 0,

        receita: 0,

      };

      prod.quantidade += item.quantidade;

      prod.receita += itemValor;

      porProduto.set(item.produtoId, prod);



      if (isBebidaChope(item.produto.tipo, item.produto.formato)) {

        const ml = item.volumeMl * item.quantidade;

        chopeMl += ml;



        const rank = rankingMap.get(comanda.clienteId) ?? {

          clienteId: comanda.clienteId,

          nome: comanda.cliente.nome,

          totalMl: 0,

          totalValor: 0,

          pedidos: 0,

        };

        rank.totalMl += ml;

        rank.totalValor += itemValor;

        rank.pedidos += item.quantidade;

        rankingMap.set(comanda.clienteId, rank);

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

    .sort((a, b) => b.receita - a.receita);



  const vendasPorIntervalo = buildVendasPorIntervalo(evento, comandas);



  const rankingTop = Array.from(rankingMap.values())

    .sort((a, b) => b.totalMl - a.totalMl || b.totalValor - a.totalValor)

    .slice(0, 5)

    .map((r, i) => ({ posicao: i + 1, ...r }));



  const topClientes = temOutrosProdutos

    ? Array.from(topClientesMap.values())

        .sort((a, b) => b.receita - a.receita || b.comandas - a.comandas)

        .slice(0, 5)

        .map((c, i) => ({ posicao: i + 1, ...c }))

    : [];



  return {

    evento,

    resumo: {

      receitaTotal,

      comandasAtendidas,

      ticketMedio,

      chopeMl,

      clientesUnicos: clientes.size,

    },

    vendasPorIntervalo,

    porPagamento: porPagamentoArr,

    porProduto: porProdutoArr,

    porFuncionario: Array.from(porFuncionario.values()).sort((a, b) => b.receita - a.receita),

    rankingTop,

    temOutrosProdutos,

    topClientes,

  };

}


