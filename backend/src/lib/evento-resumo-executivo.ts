import { prisma } from './prisma.js';

import { toNumber } from './utils.js';

import { isBebidaChope } from './produto-utils.js';

import { getReportFechadoPorContext, resolveFechadoPorForReport } from './fechado-por-report.js';

import { buildVendasPorIntervalo, sumVendasPorIntervalo } from './evento-vendas-intervalo.js';

import { buildFluxoPorIntervalo, sumFluxoFechado, type FluxoRemocaoInput } from './evento-fluxo-intervalo.js';

import { buildTempoComandaStats } from './evento-comanda-tempo.js';



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



  const comandasFluxo = await prisma.comanda.findMany({

    where: { eventoId, status: { not: 'CANCELADA' } },

    select: {

      id: true,

      status: true,

      tipo: true,

      createdAt: true,

      clienteId: true,

      updatedAt: true,

      fechadaEm: true,

      total: true,

      fechadoPorId: true,

      cliente: { select: { id: true, nome: true } },

      itens: { include: { produto: true } },

      pagamentos: { select: { forma: true, valor: true, pagoEm: true } },

      fechadoPor: { select: { id: true, nome: true } },

    },

    orderBy: { updatedAt: 'asc' },

  });



  const remocoesRaw = await prisma.transacaoLog.findMany({

    where: { eventoId, tipo: 'COMANDA_ITEM_REMOVIDO' },

    select: { comandaId: true, createdAt: true, metadata: true },

  });

  const remocoes: FluxoRemocaoInput[] = remocoesRaw

    .filter((r) => r.comandaId)

    .map((r) => {

      const m = (r.metadata ?? {}) as Record<string, unknown>;

      const precoUnit = typeof m.precoUnit === 'number' ? m.precoUnit : Number(m.precoUnit ?? 0);

      const quantidade = typeof m.quantidade === 'number' ? m.quantidade : Number(m.quantidade ?? 1);

      return {

        comandaId: r.comandaId!,

        createdAt: r.createdAt,

        valor: precoUnit * quantidade,

      };

    });



  const comandasFechadas = comandasFluxo.filter((c) => c.status === 'FECHADA');



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



  for (const comanda of comandasFechadas) {

    const valor = toNumber(comanda.total);

    receitaTotal += valor;

    const isAvulsa = comanda.tipo === 'AVULSA';

    if (!isAvulsa) {
      clientes.add(comanda.clienteId);
    }



    if (!isAvulsa) {
      const topCliente = topClientesMap.get(comanda.clienteId) ?? {

        clienteId: comanda.clienteId,

        nome: comanda.cliente.nome,

        receita: 0,

        comandas: 0,

      };

      topCliente.receita += valor;

      topCliente.comandas += 1;

      topClientesMap.set(comanda.clienteId, topCliente);
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



        if (!isAvulsa) {
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

    }



    for (const pag of comanda.pagamentos) {

      porPagamento.set(pag.forma, (porPagamento.get(pag.forma) ?? 0) + toNumber(pag.valor));

    }

  }



  const comandasAtendidas = comandasFechadas.length;

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



  const vendasPorIntervalo = buildVendasPorIntervalo(evento, comandasFechadas);

  const fluxoPorIntervalo = buildFluxoPorIntervalo(evento, comandasFluxo, remocoes);

  const tempoComanda = buildTempoComandaStats(comandasFechadas);



  if (process.env.NODE_ENV !== 'production') {

    const chartTotal = sumVendasPorIntervalo(vendasPorIntervalo);

    const fluxoFechado = sumFluxoFechado(fluxoPorIntervalo);

    if (Math.abs(chartTotal - receitaTotal) > 0.01) {

      console.warn(

        `[resumo-executivo] vendasPorIntervalo (${chartTotal}) != receitaTotal (${receitaTotal}) evento=${eventoId}`,

      );

    }

    if (Math.abs(fluxoFechado - receitaTotal) > 0.01) {

      console.warn(

        `[resumo-executivo] fluxoPorIntervalo.fechado (${fluxoFechado}) != receitaTotal (${receitaTotal}) evento=${eventoId}`,

      );

    }

  }



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

    fluxoPorIntervalo,

    tempoComanda,

    porPagamento: porPagamentoArr,

    porProduto: porProdutoArr,

    porFuncionario: Array.from(porFuncionario.values()).sort((a, b) => b.receita - a.receita),

    rankingTop,

    temOutrosProdutos,

    topClientes,

  };

}

