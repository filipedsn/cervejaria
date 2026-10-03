import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';
import { decimalToScaledInteger, planPdvMigration } from './pdv-unico-migration-planner.js';
import { buildPdvPlanningGraph, readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { serializeCommandSnapshot } from './pdv-unico-snapshot.js';

// Validate before importing prisma.ts, which instantiates the client at module load.
validateInventoryEnvironment(process.env);
const { prisma } = await import('../src/lib/prisma.js');

const cents = (value: unknown) => decimalToScaledInteger(String(value), 2).toString();
const milli = (value: unknown) => decimalToScaledInteger(String(value), 3).toString();
const focusCompanyIds = new Set(['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo']);

try {
  const snapshotData = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const companies = await tx.cervejaria.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    const unattachedCommands = await tx.comanda.findMany({ where: { eventoId: null, pontoVendaId: null }, select: { id: true, origem: true, status: true, total: true, createdAt: true }, orderBy: { id: 'asc' } });
    const output = [];
    for (const company of companies) {
      const companyId = company.id;
      const sourceRows = await readPdvPlanningSourceSnapshot(tx, companyId);
      const { pdvs, trailers, events, commands, operationalConfig, moduleConfig, eventSessions, operationalSessions, receivables, balances, stockMovements, orders, tapSetups, products, menus, taps, optionals, clients, customerCount, eventExclusions, eventProducts, portalOrders, customerStatistics, transactionLogs, payments } = sourceRows;
      const commandTotals = new Map<string, { count: number; totalCents: bigint; discountCents: bigint }>();
      const commandByOperationDay = new Map<string, { count: number; totalCents: bigint }>();
      for (const command of commands) {
        const key = `${command.origem}:${command.status}`;
        const aggregate = commandTotals.get(key) ?? { count: 0, totalCents: 0n, discountCents: 0n };
        aggregate.count++;
        aggregate.totalCents += BigInt(cents(command.total));
        aggregate.discountCents += BigInt(cents(command.desconto));
        commandTotals.set(key, aggregate);
        const operationDate = command.diaOperacional?.toISOString().slice(0, 10)
          ?? command.evento?.data?.toISOString().slice(0, 10)
          ?? command.createdAt.toISOString().slice(0, 10);
        const operationDateRule = command.diaOperacional ? 'STORED_OPERATIONAL_DATE'
          : command.evento?.data ? 'INHERITED_EVENT_DATE'
          : 'UTC_FALLBACK_UNVERIFIED';
        const dayKey = `${command.origem}:${operationDateRule}:${operationDate}`;
        const byDay = commandByOperationDay.get(dayKey) ?? { count: 0, totalCents: 0n };
        byDay.count++;
        byDay.totalCents += BigInt(cents(command.total));
        commandByOperationDay.set(dayKey, byDay);
      }
      const paymentTotals = new Map<string, { count: number; cents: bigint }>();
      for (const payment of payments) {
        const key = `${payment.comanda.origem}:${payment.forma}:${payment.pagoEm.toISOString().slice(0, 10)}`;
        const aggregate = paymentTotals.get(key) ?? { count: 0, cents: 0n };
        aggregate.count++;
        aggregate.cents += BigInt(cents(payment.valor));
        paymentTotals.set(key, aggregate);
      }
      const receivableRows = receivables.map((account) => {
        const original = BigInt(cents(account.valorOriginal));
        const received = account.pagamentos.reduce((sum, item) => sum + BigInt(cents(item.valor)), 0n);
        return { id: account.id, commandId: account.comandaId, origin: account.comanda.origem, eventId: account.comanda.eventoId, pointOfSaleId: account.comanda.pontoVendaId, createdAt: account.createdAt.toISOString(), originalCents: original.toString(), receiptsCents: received.toString(), balanceCents: (original - received).toString(), receiptCount: account.pagamentos.length, receiptForms: account.pagamentos.reduce<Record<string, { count: number; cents: string }>>((acc, item) => { const prior = acc[item.forma] ?? { count: 0, cents: '0' }; acc[item.forma] = { count: prior.count + 1, cents: (BigInt(prior.cents) + BigInt(cents(item.valor))).toString() }; return acc; }, {}) };
      });
      const eventCommandLinks = commands.filter((command) => command.eventoId && command.pontoVendaId).map((command) => ({ id: command.id, origin: command.origem, eventId: command.eventoId, pontoVendaId: command.pontoVendaId, itemCount: command.itens.length }));
      const tenantConflicts = commands.filter((command) => (command.evento && command.evento.cervejariaId !== companyId) || (command.pontoVenda && command.pontoVenda.cervejariaId !== companyId)).map((command) => ({ id: command.id, origin: command.origem, eventId: command.eventoId, pontoVendaId: command.pontoVendaId }));
      const graph = buildPdvPlanningGraph({ companyId, pdvs, trailers, operationalConfig, moduleConfig, clients, customerStatistics, products, menus, optionals, events, portalOrders, transactionLogs, eventExclusions, eventProducts, taps, eventSessions, operationalSessions, commands, orders, payments, receivables, tapSetups, balances, stockMovements });
      const records = graph.records;
      const paymentLinkConflicts = graph.paymentLinkConflicts;
      const mapping = planPdvMigration({
        companyId,
        pdvIds: pdvs.map((item) => item.id),
        trailerIds: trailers.map((item) => item.id),
        records,
      });
      const mappingByKey = new Map(mapping.map((planned) => [`${planned.sourceType}:${planned.sourceId}`, planned]));
      const eventCommandLinkResults = eventCommandLinks.map((link) => {
        const planned = mappingByKey.get(`COMANDA:${link.id}`);
        return { ...link, destinationPdvId: planned?.sourceValidation.canonicalPdvId ?? null, sourceValidation: planned?.sourceValidation.status ?? 'BLOCKED', targetMapping: planned?.targetMapping.status ?? 'INCOMPLETE', targetEntity: planned?.targetMapping.destinationEntity ?? null, targetBlockerCode: planned?.targetMapping.blockerCode ?? 'COMMAND_NOT_IN_SOURCE_GRAPH', sourceBlockerCode: planned?.sourceValidation.blocker?.code ?? null, evidence: planned?.sourceValidation.evidence ?? 'Comanda não consta no grafo fotografado.' };
      });
      const commandSnapshots = commands.map((command) => serializeCommandSnapshot({
        id: command.id, origem: command.origem, status: command.status, tipo: command.tipo,
        numero: command.numero, eventoId: command.eventoId, clienteId: command.clienteId,
        pontoVendaId: command.pontoVendaId, abertaPorId: command.abertaPorId,
        fechadoPorId: command.fechadoPorId, fechadaEm: command.fechadaEm,
        diaOperacional: command.diaOperacional, eventoData: command.evento?.data ?? null,
        createdAt: command.createdAt, updatedAt: command.updatedAt,
        total: command.total, desconto: command.desconto,
        itens: command.itens.map((item) => ({
          id: item.id, produtoId: item.produtoId, tapId: item.tapId, volumeMl: item.volumeMl,
          quantidade: item.quantidade, precoUnit: item.precoUnit, exigePreparo: item.exigePreparo,
          paraViagem: item.paraViagem, cancelamentoPendenteEm: item.cancelamentoPendenteEm,
          canceladoEm: item.canceladoEm, pedidoCozinhaId: item.pedidoCozinhaId, createdAt: item.createdAt,
          opcionais: item.opcionais.map((optional) => ({ id: optional.id, opcionalId: optional.opcionalId,
            opcionalCatalogoId: optional.opcionalCatalogoId, precoAdicional: optional.precoAdicional,
            quantidade: optional.quantidade })),
        })),
      }));
      const inventoryByProduct = new Map<string, { pointOfSaleId: string; productId: string; balance: bigint; movementByType: Record<string, bigint>; movementCount: number }>();
      for (const balance of balances) {
        const key = `${balance.pontoVendaId}:${balance.produtoId}`;
        inventoryByProduct.set(key, { pointOfSaleId: balance.pontoVendaId, productId: balance.produtoId, balance: BigInt(milli(balance.quantidade)), movementByType: {}, movementCount: 0 });
      }
      for (const movement of stockMovements) {
        const key = `${movement.pontoVendaId}:${movement.produtoId}`;
        const aggregate = inventoryByProduct.get(key) ?? { pointOfSaleId: movement.pontoVendaId, productId: movement.produtoId, balance: 0n, movementByType: {}, movementCount: 0 };
        aggregate.movementByType[movement.tipo] = (aggregate.movementByType[movement.tipo] ?? 0n) + BigInt(milli(movement.quantidade));
        aggregate.movementCount++;
        inventoryByProduct.set(key, aggregate);
      }
      output.push({
        companyId, clientCount: customerCount,
        units: { pointOfSaleIds: pdvs.map((x) => x.id), trailerIds: trailers.map((x) => x.id), configurations: { operational: operationalConfig, operation: moduleConfig, effective: graph.effectiveConfiguration } },
        eventSources: {
          agendas: events.filter((x) => x.recorrencia === 'SEMANAL' && !x.serieId).map((x) => ({ id: x.id, trailerId: x.trailerId, startDate: x.data?.toISOString().slice(0, 10) ?? null, startTime: x.horaInicio, endTime: x.horaFim, weekday: x.diaSemana, status: x.status, closedAt: x.encerradoEm?.toISOString() ?? null, sequenceResetAt: x.comandasContadorDesde.toISOString(), createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString() })),
          occurrences: events.filter((x) => x.serieId).map((x) => ({ id: x.id, seriesId: x.serieId, trailerId: x.trailerId, date: x.data?.toISOString().slice(0, 10) ?? null, startTime: x.horaInicio, endTime: x.horaFim, status: x.status, closedAt: x.encerradoEm?.toISOString() ?? null, createdAt: x.createdAt.toISOString() })),
          oneOffEvents: events.filter((x) => x.recorrencia === 'NENHUMA' && !x.serieId).map((x) => ({ id: x.id, trailerId: x.trailerId, date: x.data?.toISOString().slice(0, 10) ?? null, startTime: x.horaInicio, endTime: x.horaFim, status: x.status, closedAt: x.encerradoEm?.toISOString() ?? null, createdAt: x.createdAt.toISOString() })),
          exclusions: eventExclusions.map((x) => ({ id: x.id, seriesId: x.serieId, date: x.data.toISOString().slice(0, 10), createdAt: x.createdAt.toISOString() })),
          eventProducts: eventProducts.map((x) => ({ id: x.id, eventId: x.eventoId, productId: x.produtoId, createdAt: x.createdAt.toISOString() })),
          portalOrders: portalOrders.map((x) => ({ id: x.id, eventId: x.eventoId, commandId: x.comandaId, clientId: x.clienteId, status: x.status, confirmedById: x.confirmadoPorId, confirmedAt: x.confirmadoEm?.toISOString() ?? null, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString(), items: x.itens.map((item) => ({ id: item.id, productId: item.produtoId, tapId: item.tapId, volumeMl: item.volumeMl, quantity: item.quantidade, unitPriceCents: cents(item.precoUnit) })) })),
          clientStatistics: customerStatistics.map((x) => ({ clientId: x.clienteId, closedCommandCount: x.totalComandasFechadas, spentCents: cents(x.totalGasto), beerVolumeMl: x.totalMlChope, firstVisitAt: x.primeiraVisitaEm?.toISOString() ?? null, lastVisitAt: x.ultimaVisitaEm?.toISOString() ?? null, updatedAt: x.updatedAt.toISOString() })),
          auditHistory: transactionLogs.map((x) => ({ id: x.id, type: x.tipo, userId: x.usuarioId, eventId: x.eventoId, commandId: x.comandaId, entityType: x.entidadeTipo, entityId: x.entidadeId, createdAt: x.createdAt.toISOString() })),
        },
        catalog: { products: products.map((p) => ({ id: p.id, type: p.tipo, category: p.categoria, active: p.ativo, controlsInventory: p.controlaEstoque, requiresKitchen: p.exigePreparo, prices: p.precos.map((price) => ({ id: price.id, volumeMl: price.volumeMl, cents: cents(price.preco) })), optionalGroups: p.gruposOpcionais.map((g) => ({ id: g.id, required: g.obrigatorio, max: g.maximo, active: g.ativo, optionIds: g.opcoes.map((o) => ({ id: o.id, active: o.ativo, cents: cents(o.precoAdicional) })) })) })), menus: menus.map((m) => ({ id: m.id, active: m.ativo, explicitTapVolumes: m.chopeVolumesConfigurados, rows: m.produtos.map((row) => ({ id: row.id, productId: row.produtoId, volumeMl: row.volumeMl, cents: cents(row.precoUnit) })) })), optionalCatalog: optionals.map((o) => ({ id: o.id, active: o.ativo, cents: cents(o.preco), linkedProductIds: o.produtos.map((link) => link.produtoId) })), taps: taps.map((tap) => ({ id: tap.id, trailerId: tap.trailerId, productId: tap.produtoId, active: tap.ativo })), tapSetups: tapSetups.map((x) => ({ id: x.id, eventId: x.eventoId, operationalSessionId: x.sessaoCaixaId, tapId: x.tapId, productId: x.produtoId })) },
        commands: { byOriginStatus: [...commandTotals].sort(([a], [b]) => a.localeCompare(b)).map(([originStatus, value]) => ({ originStatus, count: value.count, totalCents: value.totalCents.toString(), discountsCents: value.discountCents.toString() })), byOriginOperationDate: [...commandByOperationDay].sort(([a], [b]) => a.localeCompare(b)).map(([originDate, value]) => ({ originDate, count: value.count, totalCents: value.totalCents.toString() })), commandEntries: commandSnapshots, orderEntries: orders.map((order) => ({ id: order.id, commandId: order.comandaId, pointOfSaleId: order.pontoVendaId, status: order.status, number: order.numero, operationDay: order.diaOperacional.toISOString().slice(0, 10), takeAway: order.paraViagem, createdById: order.criadoPorId, statusSince: order.statusDesde.toISOString(), deliveredAt: order.entregueEm?.toISOString() ?? null, customerNotifiedAt: order.clienteAvisadoEm?.toISOString() ?? null, createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(), transitions: order.historicoStatus.map((h) => ({ id: h.id, status: h.status, at: h.registradoEm.toISOString() })), items: order.itensComanda.map((item) => ({ id: item.id, commandItemId: item.id, productId: item.produtoId, volumeMl: item.volumeMl, quantity: item.quantidade, unitPriceCents: cents(item.precoUnit), optionalIds: item.opcionais.map((optional) => optional.id) })) })), orderCountsByStatus: [...orders.reduce((map, order) => map.set(order.status, (map.get(order.status) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })), itemCount: commands.reduce((sum, x) => sum + x.itens.length, 0), optionalCount: commands.reduce((sum, x) => sum + x.itens.reduce((inner, item) => inner + item.opcionais.length, 0), 0) },
        finance: { paymentPeriodBasis: 'pagoEm date, separate from command/event/operational day', paymentsByOriginFormAndPaymentDate: [...paymentTotals].sort(([a], [b]) => a.localeCompare(b)).map(([originFormDate, value]) => ({ originFormDate, count: value.count, cents: value.cents.toString() })), paymentEntries: payments.map((payment) => ({ id: payment.id, commandId: payment.comandaId, origin: payment.comanda.origem, form: payment.forma, cents: cents(payment.valor), receivedCents: payment.valorRecebido == null ? null : cents(payment.valorRecebido), changeCents: payment.troco == null ? null : cents(payment.troco), registeredById: payment.registradoPorId, paidAt: payment.pagoEm.toISOString(), receivableId: payment.contaReceberId, operationalSessionId: payment.sessaoCaixaId, eventSessionId: payment.sessaoCaixaEventoId })), receivables: receivables.map((account) => ({ ...receivableRows.find((row) => row.id === account.id)!, clientId: account.clienteId, createdById: account.criadoPorId, paymentIds: account.pagamentos.map((payment) => payment.id), originHistoricallyFromCommand: account.comanda.origem })), eventCashSessions: eventSessions.map((s) => ({ id: s.id, eventId: s.eventoId, status: s.status, initialChangeCents: cents(s.trocoInicial), openedById: s.abertoPorId, openedAt: s.abertoEm.toISOString(), closedById: s.fechadoPorId, closedAt: s.fechadoEm?.toISOString() ?? null, countsCents: { cash: s.contadoDinheiro == null ? null : cents(s.contadoDinheiro), pix: s.contadoPix == null ? null : cents(s.contadoPix), debit: s.contadoDebito == null ? null : cents(s.contadoDebito), credit: s.contadoCredito == null ? null : cents(s.contadoCredito), card: s.contadoCartao == null ? null : cents(s.contadoCartao) }, movements: s.movimentos.map((m) => ({ id: m.id, type: m.tipo, cents: cents(m.valor), registeredById: m.registradoPorId, createdAt: m.createdAt.toISOString() })) })), operationalCashSessions: operationalSessions.map((s) => ({ id: s.id, pointOfSaleId: s.pontoVendaId, trailerId: s.trailerId, status: s.status, operationDay: s.diaOperacional.toISOString().slice(0, 10), initialChangeCents: cents(s.trocoInicial), openedById: s.abertoPorId, openedAt: s.abertoEm.toISOString(), closedById: s.fechadoPorId, closedAt: s.fechadoEm?.toISOString() ?? null, countsCents: { cash: s.contadoDinheiro == null ? null : cents(s.contadoDinheiro), pix: s.contadoPix == null ? null : cents(s.contadoPix), debit: s.contadoCartaoDebito == null ? null : cents(s.contadoCartaoDebito), credit: s.contadoCartaoCredito == null ? null : cents(s.contadoCartaoCredito) }, menuId: s.cardapioId, menuOverrides: s.produtos.map((p) => ({ id: p.id, productId: p.produtoId, volumeMl: p.volumeMl, unitPriceCents: p.precoUnit == null ? null : cents(p.precoUnit), createdAt: p.createdAt.toISOString() })), movements: s.movimentos.map((m) => ({ id: m.id, type: m.tipo, cents: cents(m.valor), registeredById: m.registradoPorId, correctionOfId: m.correcaoDeId, correctionNature: m.naturezaCorrecao, authorizedById: m.autorizadoPorId, requestedById: m.solicitadoPorId, correctedAt: m.corrigidoEm?.toISOString() ?? null, createdAt: m.createdAt.toISOString() })) })), paymentLinkConflicts },
        inventory: { balances: balances.map((balance) => ({ id: balance.id, pointOfSaleId: balance.pontoVendaId, productId: balance.produtoId, unit: products.find((product) => product.id === balance.produtoId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === balance.produtoId) ? 'UNIDADE' : 'NAO_COMPROVADA', milliUnits: milli(balance.quantidade) })), movements: stockMovements.map((movement) => ({ id: movement.id, pointOfSaleId: movement.pontoVendaId, productId: movement.produtoId, unit: products.find((product) => product.id === movement.produtoId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === movement.produtoId) ? 'UNIDADE' : 'NAO_COMPROVADA', type: movement.tipo, milliUnits: milli(movement.quantidade), orderId: movement.pedidoId, createdAt: movement.createdAt.toISOString() })), byProduct: [...inventoryByProduct.values()].sort((a, b) => `${a.pointOfSaleId}:${a.productId}`.localeCompare(`${b.pointOfSaleId}:${b.productId}`)).map((x) => ({ pointOfSaleId: x.pointOfSaleId, productId: x.productId, unit: products.find((product) => product.id === x.productId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === x.productId) ? 'UNIDADE' : 'NAO_COMPROVADA', balanceMilliUnits: x.balance.toString(), movementCount: x.movementCount, movementByTypeMilliUnits: Object.fromEntries(Object.entries(x.movementByType).sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => [key, amount.toString()])) })) },
        conflicts: { eventAndPdvCommandLinks: eventCommandLinkResults, tenantDivergentCommands: tenantConflicts, mappingBlocked: mapping.filter((x) => x.action === 'BLOQUEADO'), mapping },
      });
    }
    return { companies: output, unattachedCommands: unattachedCommands.map((command) => ({ id: command.id, origin: command.origem, status: command.status, totalCents: cents(command.total), createdAt: command.createdAt.toISOString() })) };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
  const snapshot = snapshotData.companies;
  const focus = snapshot.filter((item) => focusCompanyIds.has(item.companyId));
  const detailed = process.argv.includes('--detail') || process.argv.includes('--all');
  const summarizeCash = (sessions: Array<{ status: string; movements: Array<{ type: string; cents: string }> }>) => sessions.reduce<{ sessions: number; ABERTO: number; FECHADO: number; movementCount: number; movementCentsByType: Record<string, string> }>((sum, session) => {
    sum.sessions++;
    if (session.status === 'ABERTO') sum.ABERTO++;
    else if (session.status === 'FECHADO') sum.FECHADO++;
    for (const movement of session.movements) {
      sum.movementCount++;
      sum.movementCentsByType[movement.type] = (BigInt(sum.movementCentsByType[movement.type] ?? '0') + BigInt(movement.cents)).toString();
    }
    return sum;
  }, { sessions: 0, ABERTO: 0, FECHADO: 0, movementCount: 0, movementCentsByType: {} as Record<string, string> });
  const summarizePayments = (rows: Array<{ originFormDate: string; count: number; cents: string }>) => {
    const groups = new Map<string, { count: number; cents: bigint; dates: number }>();
    for (const row of rows) {
      const [origin, form] = row.originFormDate.split(':');
      const key = `${origin}:${form}`;
      const group = groups.get(key) ?? { count: 0, cents: 0n, dates: 0 };
      group.count += row.count;
      group.cents += BigInt(row.cents);
      group.dates++;
      groups.set(key, group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([originForm, group]) => ({ originForm, count: group.count, cents: group.cents.toString(), paymentDates: group.dates }));
  };
  const summarizedFocus = focus.map((company) => ({
    companyId: company.companyId,
    clientCount: company.clientCount,
    units: company.units,
    eventSources: { agendas: company.eventSources.agendas.length, occurrences: company.eventSources.occurrences.length, oneOffEvents: company.eventSources.oneOffEvents.length, portalOrders: company.eventSources.portalOrders.length, auditHistory: company.eventSources.auditHistory.length, clientStatistics: company.eventSources.clientStatistics.length },
    catalogCounts: { products: company.catalog.products.length, menus: company.catalog.menus.length, optionalGroups: company.catalog.products.reduce((sum, p) => sum + p.optionalGroups.length, 0), taps: company.catalog.taps.length, tapSetups: company.catalog.tapSetups.length },
    commands: { byOriginStatus: company.commands.byOriginStatus, ordersByStatus: company.commands.orderCountsByStatus, itemCount: company.commands.itemCount, optionalCount: company.commands.optionalCount },
    financeSummary: {
      paymentsByOriginAndForm: summarizePayments(company.finance.paymentsByOriginFormAndPaymentDate),
      receivables: company.finance.receivables.reduce((sum, account) => ({ count: sum.count + 1, originalCents: (BigInt(sum.originalCents) + BigInt(account.originalCents)).toString(), receiptCents: (BigInt(sum.receiptCents) + BigInt(account.receiptsCents)).toString(), balanceCents: (BigInt(sum.balanceCents) + BigInt(account.balanceCents)).toString() }), { count: 0, originalCents: '0', receiptCents: '0', balanceCents: '0' }),
      eventCash: summarizeCash(company.finance.eventCashSessions),
      operationalCash: summarizeCash(company.finance.operationalCashSessions),
      paymentLinkConflicts: company.finance.paymentLinkConflicts,
    },
    inventorySummary: company.inventory.balances.reduce((sum, item) => {
      const row = sum[item.pointOfSaleId] ?? { balanceRows: 0, movementRows: 0 };
      row.balanceRows++;
      row.movementRows = company.inventory.movements.filter((movement) => movement.pointOfSaleId === item.pointOfSaleId).length;
      sum[item.pointOfSaleId] = row;
      return sum;
    }, {} as Record<string, { balanceRows: number; movementRows: number }>),
    conflicts: { eventAndPdvCommandLinks: company.conflicts.eventAndPdvCommandLinks, tenantDivergentCommands: company.conflicts.tenantDivergentCommands, mappingBlocked: company.conflicts.mappingBlocked },
    mappingActionCounts: company.conflicts.mapping.reduce((sum, row) => ({ ...sum, [row.action]: sum[row.action] + 1 }), { MANTER: 0, CRIAR_DESTINO: 0, REASSOCIAR: 0, BLOQUEADO: 0 }),
  }));
  const globalBlocks = [
    ...snapshot.flatMap((company) => company.conflicts.mappingBlocked.map((row) => ({ companyId: company.companyId, sourceType: row.sourceType, sourceId: row.sourceId, category: row.sourceValidation.blocker?.category ?? 'INFORMACAO_INSUFICIENTE', code: row.sourceValidation.blocker?.code ?? 'UNKNOWN', evidence: row.sourceValidation.evidence }))),
    ...snapshotData.unattachedCommands.map((command) => ({ companyId: null, sourceType: 'COMANDA', sourceId: command.id, category: 'INFORMACAO_INSUFICIENTE', code: 'COMMAND_WITHOUT_TENANT_LINK', evidence: `Comanda sem relação Evento/PDV: origem=${command.origin}, estado=${command.status}; tenant e destino não comprovados.` })),
  ];
  const countBy = (key: 'category' | 'code') => [...globalBlocks.reduce((map, row) => map.set(row[key], (map.get(row[key]) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ [key]: name, count }));
  console.log(JSON.stringify({
    environment: 'DEV local; READ ONLY RepeatableRead snapshot',
    coverage: 'IDs and exact decimal snapshots; diagnostic output excludes customer names, contacts and observations; no credentials',
    totals: { companies: snapshot.length, withoutPdv: snapshot.filter((x) => x.units.pointOfSaleIds.length === 0).length, multiplePdv: snapshot.filter((x) => x.units.pointOfSaleIds.length > 1).length, blockedEntityRows: snapshot.reduce((sum, x) => sum + x.conflicts.mappingBlocked.length, 0), unattachedCommands: snapshotData.unattachedCommands.length, blockedRowsByCategory: countBy('category'), blockedRowsByCode: countBy('code'), paymentLinkConflicts: snapshot.reduce((sum, x) => sum + x.finance.paymentLinkConflicts.length, 0), tenantDivergentCommands: snapshot.reduce((sum, x) => sum + x.conflicts.tenantDivergentCommands.length, 0) },
    unattachedCommandBreakdown: [...snapshotData.unattachedCommands.reduce((map, command) => map.set(`${command.origin}:${command.status}`, (map.get(`${command.origin}:${command.status}`) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([originStatus, count]) => ({ originStatus, count })),
    globalBlocks,
    companies: detailed ? (process.argv.includes('--all') ? snapshot : focus) : summarizedFocus,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
