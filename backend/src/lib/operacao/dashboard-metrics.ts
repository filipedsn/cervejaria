import type { Prisma } from '@prisma/client';

export type DashboardItem = {
  produtoId: string | null;
  nome: string | null;
  quantidade: number;
  precoUnit: unknown;
  canceladoEm?: Date | null;
  cancelamentoPendenteEm?: Date | null;
};

export type DashboardProductSale = {
  produtoId: string;
  nome: string;
  quantidade: number;
  receita: number;
};

/**
 * Allocate each closed sale's net total across its active product lines in cents.
 * This keeps the product chart on the same discounted revenue basis as the KPIs.
 */
export function aggregateDashboardProducts(
  comandas: Array<{ total: unknown; itens: DashboardItem[] }>,
): DashboardProductSale[] {
  const products = new Map<string, DashboardProductSale>();

  for (const comanda of comandas) {
    const lines = comanda.itens
      .filter((item) => item.produtoId && !item.canceladoEm && !item.cancelamentoPendenteEm)
      .map((item) => ({
        item,
        grossCents: Math.max(0, Math.round(Number(item.precoUnit) * 100)) * item.quantidade,
      }))
      .filter(({ grossCents }) => grossCents > 0);
    const grossTotal = lines.reduce((sum, line) => sum + line.grossCents, 0);
    if (!grossTotal) continue;

    const netCents = Math.max(0, Math.round(Number(comanda.total) * 100));
    const grouped = new Map<string, { item: DashboardItem; grossCents: number; quantity: number }>();
    for (const { item, grossCents } of lines) {
      const current = grouped.get(item.produtoId!) ?? { item, grossCents: 0, quantity: 0 };
      current.grossCents += grossCents;
      current.quantity += item.quantidade;
      grouped.set(item.produtoId!, current);
    }

    const shares = [...grouped.entries()].map(([produtoId, line]) => {
      const exactCents = (netCents * line.grossCents) / grossTotal;
      return { produtoId, ...line, cents: Math.floor(exactCents), remainder: exactCents % 1 };
    });
    let centsToAllocate = netCents - shares.reduce((sum, share) => sum + share.cents, 0);
    for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.produtoId.localeCompare(b.produtoId))) {
      if (centsToAllocate <= 0) break;
      share.cents += 1;
      centsToAllocate -= 1;
    }

    for (const share of shares) {
      const current = products.get(share.produtoId) ?? {
        produtoId: share.produtoId,
        nome: share.item.nome ?? 'Item',
        quantidade: 0,
        receita: 0,
      };
      current.quantidade += share.quantity;
      current.receita += share.cents / 100;
      products.set(share.produtoId, current);
    }
  }

  return [...products.values()];
}

export function projectDashboardTurnMetrics(args: {
  totalVendas: number;
  transacoes: Array<{ id: string; tipo: string }>;
  abertoEm: Date;
  fechadoEm: Date;
  administrativo: boolean;
}) {
  const comandasAtendidas = new Set(args.transacoes.filter((row) => row.tipo !== 'AVULSA').map((row) => row.id)).size;
  const vendasAvulsas = new Set(args.transacoes.filter((row) => row.tipo === 'AVULSA').map((row) => row.id)).size;
  const duracaoHoras = args.administrativo
    ? null
    : Math.max(Math.round(((args.fechadoEm.getTime() - args.abertoEm.getTime()) / 3_600_000) * 100) / 100, 0.25);

  return {
    comandasAtendidas,
    vendasAvulsas,
    ticketMedio: args.transacoes.length ? args.totalVendas / args.transacoes.length : 0,
    duracaoHoras,
    receitaPorHora: duracaoHoras ? Math.round((args.totalVendas / duracaoHoras) * 100) / 100 : null,
  };
}

/**
 * Debt from this turn's sales that was settled outside the turn (later turn or no session).
 * Informational only: it never changes the turn's received total or cash conference.
 */
export function sumDebtSettledAfterTurn(
  sessaoId: string,
  comandas: Array<{ pagamentos: Array<{ valor: unknown; sessaoCaixaId: string | null; contaReceberId: string | null }> }>,
): number {
  let totalCents = 0;
  for (const comanda of comandas) {
    for (const pagamento of comanda.pagamentos) {
      if (pagamento.contaReceberId === null || pagamento.sessaoCaixaId === sessaoId) continue;
      totalCents += Math.round(Number(pagamento.valor ?? 0) * 100);
    }
  }
  return totalCents / 100;
}

export type DashboardSalesReconciliationCommand = {
  id: string;
  tipo: string;
  pontoVendaId: string | null;
  fechadaEm: Date;
  total: unknown;
  sessaoCaixaRealizacaoId: string | null;
  pagamentos: Array<{
    id: string;
    valor: unknown;
    pagoEm: Date;
    sessaoCaixaId: string | null;
    sessaoCaixaEventoId?: string | null;
    contaReceberId: string | null;
  }>;
};

export type DashboardSalesReconciliationTurn = {
  sessaoId: string;
  pontoVendaId: string;
  receitaTotal: number;
};

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/**
 * Reconcile closed-sale totals to the exact operational sessions already
 * listed in the dashboard. Receivable payments can explain a collection but
 * never create, replace, or assign a sale to a session.
 */
export function reconcileDashboardSalesToTurns(args: {
  comandas: DashboardSalesReconciliationCommand[];
  turnos: DashboardSalesReconciliationTurn[];
  inicio: Date;
  fim: Date;
}) {
  const turnoPorId = new Map(args.turnos.map((turno) => [turno.sessaoId, turno]));
  const comandasPorTurno = new Map(args.turnos.map((turno) => [turno.sessaoId, new Set<string>()]));
  const comandasNoPeriodo = args.comandas.filter(
    (comanda) => comanda.fechadaEm >= args.inicio && comanda.fechadaEm <= args.fim,
  );

  for (const turno of args.turnos) {
    for (const comanda of comandasNoPeriodo) {
      if (comanda.pontoVendaId !== turno.pontoVendaId) continue;
      const vendaRealizadaNoTurno = comanda.sessaoCaixaRealizacaoId === turno.sessaoId;
      const recebimentoDeVendaNoTurno = comanda.pagamentos.some(
        (pagamento) => pagamento.sessaoCaixaId === turno.sessaoId && pagamento.contaReceberId === null,
      );
      if (vendaRealizadaNoTurno || recebimentoDeVendaNoTurno) {
        comandasPorTurno.get(turno.sessaoId)!.add(comanda.id);
      }
    }
  }

  const contagemTurnosPorComanda = new Map<string, number>();
  for (const ids of comandasPorTurno.values()) {
    for (const id of ids) contagemTurnosPorComanda.set(id, (contagemTurnosPorComanda.get(id) ?? 0) + 1);
  }
  const idsEmTurnos = new Set(contagemTurnosPorComanda.keys());
  const foraDosTurnos = comandasNoPeriodo.filter((comanda) => !idsEmTurnos.has(comanda.id));
  const grupos = {
    quitadasPorRecebimentoEmTurno: [] as DashboardSalesReconciliationCommand[],
    semSessaoComprovada: [] as DashboardSalesReconciliationCommand[],
    outroVinculoForaDaLista: [] as DashboardSalesReconciliationCommand[],
  };

  for (const comanda of foraDosTurnos) {
    const temVinculoDiretoDeVenda = Boolean(comanda.sessaoCaixaRealizacaoId)
      || comanda.pagamentos.some((pagamento) => pagamento.sessaoCaixaId !== null && pagamento.contaReceberId === null);
    if (temVinculoDiretoDeVenda) {
      grupos.outroVinculoForaDaLista.push(comanda);
      continue;
    }

    const temQuitacaoEmTurnoListada = comanda.pagamentos.some((pagamento) =>
      pagamento.contaReceberId !== null && pagamento.sessaoCaixaId !== null && turnoPorId.has(pagamento.sessaoCaixaId),
    );
    if (temQuitacaoEmTurnoListada) {
      grupos.quitadasPorRecebimentoEmTurno.push(comanda);
      continue;
    }

    const temAlgumVinculoDeSessao = comanda.pagamentos.some(
      (pagamento) => pagamento.sessaoCaixaId !== null || pagamento.sessaoCaixaEventoId != null,
    );
    if (!comanda.sessaoCaixaRealizacaoId && !temAlgumVinculoDeSessao) {
      grupos.semSessaoComprovada.push(comanda);
      continue;
    }

    grupos.outroVinculoForaDaLista.push(comanda);
  }

  const somaVendas = (comandas: DashboardSalesReconciliationCommand[]) =>
    comandas.reduce((sum, comanda) => sum + cents(comanda.total), 0);
  const somaRecebimentosNoPeriodo = (
    comandas: DashboardSalesReconciliationCommand[],
    predicate: (pagamento: DashboardSalesReconciliationCommand['pagamentos'][number]) => boolean,
  ) => {
    const pagamentosVistos = new Set<string>();
    let total = 0;
    let count = 0;
    for (const comanda of comandas) {
      for (const pagamento of comanda.pagamentos) {
        if (pagamentosVistos.has(pagamento.id)) continue;
        if (pagamento.pagoEm < args.inicio || pagamento.pagoEm > args.fim || !predicate(pagamento)) continue;
        pagamentosVistos.add(pagamento.id);
        total += cents(pagamento.valor);
        count += 1;
      }
    }
    return { count, cents: total };
  };
  const vendasDasComandasVinculadasAosTurnosCents = args.comandas
    .filter((comanda) => idsEmTurnos.has(comanda.id))
    .reduce((sum, comanda) => sum + cents(comanda.total), 0);
  const vendasExibidasNosTurnosCents = args.turnos.reduce((sum, turno) => sum + cents(turno.receitaTotal), 0);
  const vendasDoMesCents = somaVendas(comandasNoPeriodo);
  const vendasForaDosTurnosCents = somaVendas(foraDosTurnos);
  const porTipoForaDosTurnos = new Map<string, { comandas: number; vendasCents: number }>();
  for (const comanda of foraDosTurnos) {
    const grupo = porTipoForaDosTurnos.get(comanda.tipo) ?? { comandas: 0, vendasCents: 0 };
    grupo.comandas += 1;
    grupo.vendasCents += cents(comanda.total);
    porTipoForaDosTurnos.set(comanda.tipo, grupo);
  }
  const sobreposicoes = [...contagemTurnosPorComanda]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ comandaId: id, turnos: count }));
  const quitacoesEmTurnos = somaRecebimentosNoPeriodo(
    grupos.quitadasPorRecebimentoEmTurno,
    (pagamento) => pagamento.contaReceberId !== null
      && pagamento.sessaoCaixaId !== null
      && turnoPorId.has(pagamento.sessaoCaixaId),
  );
  const recebimentosSemSessao = somaRecebimentosNoPeriodo(
    grupos.semSessaoComprovada,
    (pagamento) => pagamento.sessaoCaixaId === null && pagamento.sessaoCaixaEventoId == null,
  );
  const isReconciled = sobreposicoes.length === 0
    && vendasExibidasNosTurnosCents === vendasDasComandasVinculadasAosTurnosCents
    && vendasDoMesCents === vendasExibidasNosTurnosCents + vendasForaDosTurnosCents
    && grupos.quitadasPorRecebimentoEmTurno.length
      + grupos.semSessaoComprovada.length
      + grupos.outroVinculoForaDaLista.length === foraDosTurnos.length;

  return {
    vendasDoMesCents,
    vendasExibidasNosTurnosCents,
    vendasDasComandasVinculadasAosTurnosCents,
    vendasForaDosTurnosCents,
    comandasForaDosTurnos: foraDosTurnos.length,
    porTipoForaDosTurnos: [...porTipoForaDosTurnos.entries()]
      .map(([tipo, valores]) => ({ tipo, ...valores }))
      .sort((a, b) => a.tipo.localeCompare(b.tipo)),
    quitadasPorRecebimentoEmTurno: {
      comandas: grupos.quitadasPorRecebimentoEmTurno.length,
      vendasCents: somaVendas(grupos.quitadasPorRecebimentoEmTurno),
      recebimentosNoPeriodoCount: quitacoesEmTurnos.count,
      recebimentosNoPeriodoCents: quitacoesEmTurnos.cents,
    },
    semSessaoComprovada: {
      comandas: grupos.semSessaoComprovada.length,
      vendasCents: somaVendas(grupos.semSessaoComprovada),
      recebimentosNoPeriodoCount: recebimentosSemSessao.count,
      recebimentosNoPeriodoCents: recebimentosSemSessao.cents,
    },
    outroVinculoForaDaLista: {
      comandas: grupos.outroVinculoForaDaLista.length,
      vendasCents: somaVendas(grupos.outroVinculoForaDaLista),
    },
    sobreposicoes,
    reconciliado: isReconciled,
  };
}

/** Open receivables filter; with `periodo`, only debts whose comanda closed in that window. */
export function contasPendentesWhere(
  cervejariaId: string,
  pontoVendaId: string | undefined,
  canonicalPdvEnabled: boolean,
  periodo?: { inicio: Date; fim: Date },
): Prisma.ContaReceberWhereInput {
  return {
    cliente: { cervejariaId },
    comanda: {
      ...(canonicalPdvEnabled
        ? { origem: { in: ['CAIXA', 'EVENTO'] }, pontoVendaId: { not: null }, pontoVenda: { cervejariaId } }
        : { origem: 'CAIXA' }),
      status: 'FECHADA',
      ...(pontoVendaId ? { pontoVendaId } : {}),
      ...(periodo ? { fechadaEm: { gte: periodo.inicio, lte: periodo.fim } } : {}),
    },
  };
}
