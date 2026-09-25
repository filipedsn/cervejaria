import type { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import { totaisPorForma } from './caixa.js';
import { pedidoContaNaComanda } from './cozinha.js';

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
  return `${start}–${end} ${MESES[mes - 1]}`;
}

function totalComanda(comanda: {
  pagamentos: Array<{ valor: unknown }>;
}): number {
  return comanda.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0);
}

type ClosedComanda = Awaited<ReturnType<typeof fetchClosedComandas>>[number];

async function fetchClosedComandas(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  pontoVendaId?: string,
) {
  return prisma.comanda.findMany({
    where: {
      origem: 'QUIOSQUE',
      pontoVenda: { cervejariaId },
      status: 'FECHADA',
      fechadaEm: { gte: inicio, lte: fim },
      ...(pontoVendaId ? { pontoVendaId } : {}),
    },
    include: {
      pagamentos: true,
      itens: true,
      pontoVenda: { select: { id: true, nome: true } },
    },
  });
}

async function fetchUsuariosNomes(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  });
  return new Map(usuarios.map((usuario) => [usuario.id, usuario.nome]));
}

function aggregateComandas(comandas: ClosedComanda[], nomesPorId: Map<string, string>) {
  let receitaTotal = 0;
  let vendasAvulsas = 0;
  let receitaAvulsa = 0;
  let itensVendidos = 0;
  const porPagamento = new Map<PaymentMethod, number>();
  const porProduto = new Map<string, { produtoId: string; nome: string; quantidade: number; receita: number }>();
  const porFuncionario = new Map<string, { usuarioId: string | null; nome: string; comandas: number; receita: number }>();

  for (const comanda of comandas) {
    const valor = totalComanda(comanda);
    receitaTotal += valor;

    if (comanda.tipo === 'AVULSA') {
      vendasAvulsas += 1;
      receitaAvulsa += valor;
    }

    const funcKey = comanda.fechadoPorId ?? '__sem__';
    const func = porFuncionario.get(funcKey) ?? {
      usuarioId: comanda.fechadoPorId,
      nome: comanda.fechadoPorId ? (nomesPorId.get(comanda.fechadoPorId) ?? 'Operador') : 'Sem registro',
      comandas: 0,
      receita: 0,
    };
    func.comandas += 1;
    func.receita += valor;
    porFuncionario.set(funcKey, func);

    for (const pagamento of comanda.pagamentos) {
      const atual = porPagamento.get(pagamento.forma) ?? 0;
      porPagamento.set(pagamento.forma, atual + toNumber(pagamento.valor));
    }

    for (const item of comanda.itens) {
      if (!item.produtoId) continue;
      itensVendidos += item.quantidade;
      const itemValor = toNumber(item.precoUnit) * item.quantidade;
      const prod = porProduto.get(item.produtoId) ?? {
        produtoId: item.produtoId,
        nome: item.nome ?? 'Item',
        quantidade: 0,
        receita: 0,
      };
      prod.quantidade += item.quantidade;
      prod.receita += itemValor;
      porProduto.set(item.produtoId, prod);
    }
  }

  const comandasAtendidas = comandas.filter((comanda) => comanda.tipo !== 'AVULSA').length;
  const ticketMedio = comandas.length > 0 ? receitaTotal / comandas.length : 0;

  const pagamentoTotal = Array.from(porPagamento.values()).reduce((s, v) => s + v, 0);
  const porPagamentoArr = Array.from(porPagamento.entries())
    .map(([forma, valor]) => ({
      forma,
      valor,
      percentual: pagamentoTotal > 0 ? Math.round((valor / pagamentoTotal) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  const porProdutoArr = Array.from(porProduto.values())
    .map((produto) => ({
      ...produto,
      percentual: receitaTotal > 0 ? Math.round((produto.receita / receitaTotal) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15);

  const porFuncionarioArr = Array.from(porFuncionario.values()).sort((a, b) => b.receita - a.receita);

  return {
    receitaTotal,
    vendasAvulsas,
    receitaAvulsa,
    comandasAtendidas,
    ticketMedio,
    itensVendidos,
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
    if (!comanda.fechadaEm) continue;
    const w = weekOfMonth(comanda.fechadaEm) - 1;
    if (w >= 0 && w < weeks.length) {
      weeks[w].receita += totalComanda(comanda);
      weeks[w].comandas += 1;
    }
  }

  return weeks;
}

async function pagamentosDoTurno(
  sessao: Prisma.SessaoCaixaQuiosqueGetPayload<{ include: { movimentos: true } }>,
  cervejariaId: string,
) {
  const fechadaAte = sessao.fechadoEm ?? undefined;
  return prisma.pagamento.findMany({
    where: {
      comanda: {
        origem: 'QUIOSQUE',
        pontoVenda: { cervejariaId },
        pontoVendaId: sessao.pontoVendaId,
        diaOperacional: sessao.diaOperacional,
        status: 'FECHADA',
        fechadaEm: {
          gte: sessao.abertoEm,
          ...(fechadaAte ? { lte: fechadaAte } : {}),
        },
      },
    },
    select: { forma: true, valor: true, comandaId: true },
  });
}

async function buildTurnosRecentes(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
  pontoVendaId?: string,
) {
  const sessoes = await prisma.sessaoCaixaQuiosque.findMany({
    where: {
      cervejariaId,
      status: 'FECHADO',
      fechadoEm: { gte: inicio, lte: fim },
      ...(pontoVendaId ? { pontoVendaId } : {}),
    },
    include: { movimentos: true, pontoVenda: { select: { id: true, nome: true } } },
    orderBy: [{ diaOperacional: 'asc' }, { abertoEm: 'asc' }],
  });

  const turnosPorDia = new Map<string, number>();
  for (const sessao of sessoes) {
    const chaveDia = `${sessao.pontoVendaId}:${sessao.diaOperacional.toISOString().slice(0, 10)}`;
    turnosPorDia.set(chaveDia, (turnosPorDia.get(chaveDia) ?? 0) + 1);
  }

  const indiceTurnoDia = new Map<string, number>();
  const abertoPorIds = [...new Set(sessoes.map((sessao) => sessao.abertoPorId))];
  const nomesAbertura = await fetchUsuariosNomes(abertoPorIds);

  const resultados = [];
  for (const sessao of sessoes) {
    if (!sessao.fechadoEm) continue;
    const chaveDia = `${sessao.pontoVendaId}:${sessao.diaOperacional.toISOString().slice(0, 10)}`;
    const turnoDoDia = (indiceTurnoDia.get(chaveDia) ?? 0) + 1;
    indiceTurnoDia.set(chaveDia, turnoDoDia);
    const turnosNoDia = turnosPorDia.get(chaveDia) ?? 1;

    const pagamentos = await pagamentosDoTurno(sessao, cervejariaId);
    const totais = totaisPorForma(pagamentos);
    const comandaIds = new Set(pagamentos.map((pagamento) => pagamento.comandaId));
    const duracaoHoras = Math.max(
      Math.round(((sessao.fechadoEm.getTime() - sessao.abertoEm.getTime()) / MS_HOUR) * 100) / 100,
      0.25,
    );

    resultados.push({
      sessaoId: sessao.id,
      pontoVendaId: sessao.pontoVendaId,
      pontoNome: sessao.pontoVenda.nome,
      diaOperacional: sessao.diaOperacional,
      turnoDoDia,
      turnosNoDia,
      abertoPorNome: nomesAbertura.get(sessao.abertoPorId) ?? '—',
      abertoEm: sessao.abertoEm,
      fechadoEm: sessao.fechadoEm,
      receitaTotal: totais.totalVendas,
      comandasAtendidas: comandaIds.size,
      vendasAvulsas: 0,
      receitaAvulsa: 0,
      ticketMedio: comandaIds.size > 0 ? totais.totalVendas / comandaIds.size : 0,
      duracaoHoras,
      receitaPorHora:
        duracaoHoras > 0 ? Math.round((totais.totalVendas / duracaoHoras) * 100) / 100 : 0,
    });
  }

  for (const turno of resultados) {
    const avulsas = await prisma.comanda.count({
      where: {
        origem: 'QUIOSQUE',
        pontoVenda: { cervejariaId },
        pontoVendaId: turno.pontoVendaId,
        tipo: 'AVULSA',
        status: 'FECHADA',
        fechadaEm: { gte: turno.abertoEm, lte: turno.fechadoEm },
      },
    });
    turno.vendasAvulsas = avulsas;
  }

  return resultados;
}

async function buildComparativoPontos(
  cervejariaId: string,
  inicio: Date,
  fim: Date,
) {
  const pontos = await prisma.pontoVenda.findMany({
    where: { cervejariaId, ativo: true },
    orderBy: { createdAt: 'asc' },
  });
  if (pontos.length <= 1) return [];

  const grupos = [];
  for (const ponto of pontos) {
    const comandas = await fetchClosedComandas(cervejariaId, inicio, fim, ponto.id);
    const ids = [...new Set(comandas.map((comanda) => comanda.fechadoPorId).filter(Boolean) as string[])];
    const nomes = await fetchUsuariosNomes(ids);
    const resumo = aggregateComandas(comandas, nomes);
    const turnos = await prisma.sessaoCaixaQuiosque.count({
      where: {
        cervejariaId,
        pontoVendaId: ponto.id,
        status: 'FECHADO',
        fechadoEm: { gte: inicio, lte: fim },
      },
    });

    grupos.push({
      pontoVendaId: ponto.id,
      nome: ponto.nome,
      turnos,
      receitaTotal: Math.round(resumo.receitaTotal * 100) / 100,
      mediaPorTurno: turnos > 0 ? Math.round((resumo.receitaTotal / turnos) * 100) / 100 : 0,
      ticketMedio: Math.round(resumo.ticketMedio * 100) / 100,
      comandasAtendidas: resumo.comandasAtendidas,
      vendasAvulsas: resumo.vendasAvulsas,
    });
  }

  return grupos.sort((a, b) => b.receitaTotal - a.receitaTotal);
}

export async function buildQuiosqueDashboard(
  cervejariaId: string,
  ano: number,
  mes: number,
  pontoVendaId?: string,
) {
  const now = new Date();
  const anoVigente = now.getFullYear();
  const { inicio, fim } = monthBounds(ano, mes);

  const [comandasMes, comandasAno, turnosRecentes, comparativoPontos] = await Promise.all([
    fetchClosedComandas(cervejariaId, inicio, fim, pontoVendaId),
    fetchClosedComandas(cervejariaId, yearBounds(anoVigente).inicio, yearBounds(anoVigente).fim, pontoVendaId),
    buildTurnosRecentes(cervejariaId, inicio, fim, pontoVendaId),
    pontoVendaId ? Promise.resolve([]) : buildComparativoPontos(cervejariaId, inicio, fim),
  ]);

  const fechadoPorIds = [
    ...new Set(comandasMes.map((comanda) => comanda.fechadoPorId).filter(Boolean) as string[]),
  ];
  const nomesPorId = await fetchUsuariosNomes(fechadoPorIds);

  const resumo = aggregateComandas(comandasMes, nomesPorId);
  const evolucaoSemanal = weeklyEvolution(comandasMes, ano, mes);

  const receitaAnual = MESES.map((label, i) => ({
    mes: i + 1,
    label,
    receita: 0,
    comandas: 0,
  }));

  for (const comanda of comandasAno) {
    if (!comanda.fechadaEm) continue;
    const m = comanda.fechadaEm.getMonth();
    receitaAnual[m].receita += totalComanda(comanda);
    receitaAnual[m].comandas += 1;
  }

  const mesAnterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const boundsAnterior = monthBounds(mesAnterior.ano, mesAnterior.mes);
  const comandasMesAnterior = await fetchClosedComandas(
    cervejariaId,
    boundsAnterior.inicio,
    boundsAnterior.fim,
    pontoVendaId,
  );
  const resumoAnterior = aggregateComandas(
    comandasMesAnterior,
    await fetchUsuariosNomes(
      [...new Set(comandasMesAnterior.map((c) => c.fechadoPorId).filter(Boolean) as string[])],
    ),
  );

  const variacaoReceita =
    resumoAnterior.receitaTotal > 0
      ? Math.round(((resumo.receitaTotal - resumoAnterior.receitaTotal) / resumoAnterior.receitaTotal) * 100)
      : null;

  const turnosNoMes = await prisma.sessaoCaixaQuiosque.count({
    where: {
      cervejariaId,
      status: 'FECHADO',
      fechadoEm: { gte: inicio, lte: fim },
      ...(pontoVendaId ? { pontoVendaId } : {}),
    },
  });

  return {
    periodo: {
      ano,
      mes,
      label: `${MESES[mes - 1]} ${ano}`,
    },
    resumo: {
      receitaTotal: resumo.receitaTotal,
      comandasAtendidas: resumo.comandasAtendidas,
      vendasAvulsas: resumo.vendasAvulsas,
      receitaAvulsa: resumo.receitaAvulsa,
      ticketMedio: resumo.ticketMedio,
      itensVendidos: resumo.itensVendidos,
      turnosCaixa: turnosNoMes,
      variacaoReceitaMesAnterior: variacaoReceita,
    },
    evolucaoSemanal,
    porPagamento: resumo.porPagamento,
    porProduto: resumo.porProduto,
    porFuncionario: resumo.porFuncionario,
    turnosRecentes,
    comparativoPontos,
    receitaAnual: receitaAnual.map((item) => ({
      ...item,
      receita: Math.round(item.receita * 100) / 100,
    })),
    anoVigente,
  };
}
