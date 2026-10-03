import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';
import { decimalToScaledInteger, planPdvMigration } from './pdv-unico-migration-planner.js';

// Validate before importing prisma.ts, which instantiates the client at module load.
validateInventoryEnvironment(process.env);
const { prisma } = await import('../src/lib/prisma.js');

const cents = (value: unknown) => decimalToScaledInteger(String(value), 2).toString();
const milli = (value: unknown) => decimalToScaledInteger(String(value), 3).toString();
const focusNames = /CIA Maritima|Churrasquinho do Thiago/i;

try {
  const snapshotData = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const companies = await tx.cervejaria.findMany({ select: { id: true, nome: true }, orderBy: { id: 'asc' } });
    const unattachedCommands = await tx.comanda.findMany({ where: { eventoId: null, pontoVendaId: null }, select: { id: true, origem: true, status: true, total: true, createdAt: true }, orderBy: { id: 'asc' } });
    const output = [];
    for (const company of companies) {
      const companyId = company.id;
      const commandScope = { OR: [{ evento: { cervejariaId: companyId } }, { pontoVenda: { cervejariaId: companyId } }] };
      const [pdvs, trailers, events, commands, operationalConfig, moduleConfig, eventSessions, operationalSessions, receivables, balances, stockMovements, orders, tapSetups, products, menus, taps, optionals, clients, customerCount] = await Promise.all([
        tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
        tx.trailer.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
        tx.evento.findMany({ where: { cervejariaId: companyId }, select: { id: true, trailerId: true, serieId: true, recorrencia: true }, orderBy: { id: 'asc' } }),
        tx.comanda.findMany({ where: commandScope, select: { id: true, origem: true, status: true, total: true, desconto: true, eventoId: true, pontoVendaId: true, diaOperacional: true, createdAt: true, evento: { select: { cervejariaId: true, data: true } }, pontoVenda: { select: { cervejariaId: true } }, itens: { select: { id: true, opcionais: { select: { id: true, precoAdicional: true, quantidade: true } } } }, _count: { select: { pagamentos: true, pedidosOperacao: true } } }, orderBy: { id: 'asc' } }),
        tx.configuracaoOperacional.findUnique({ where: { cervejariaId: companyId }, select: { directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } }),
        tx.configuracaoOperacao.findUnique({ where: { cervejariaId: companyId }, select: { ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: true } }),
        tx.sessaoCaixaEvento.findMany({ where: { evento: { cervejariaId: companyId } }, select: { id: true, eventoId: true, status: true, abertoEm: true, fechadoEm: true, movimentos: { select: { id: true, tipo: true, valor: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
        tx.sessaoCaixaOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, pontoVendaId: true, trailerId: true, pontoVenda: { select: { cervejariaId: true } }, trailer: { select: { cervejariaId: true } }, status: true, abertoEm: true, fechadoEm: true, movimentos: { select: { id: true, tipo: true, valor: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
        tx.contaReceber.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, valorOriginal: true, createdAt: true, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true } }, pagamentos: { select: { id: true, valor: true, forma: true, pagoEm: true } } }, orderBy: { id: 'asc' } }),
        tx.inventoryBalance.findMany({ where: { cervejariaId: companyId }, select: { id: true, pontoVendaId: true, produtoId: true, quantidade: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
        tx.inventoryMovement.findMany({ where: { cervejariaId: companyId }, select: { id: true, pontoVendaId: true, produtoId: true, tipo: true, quantidade: true, pedidoId: true, createdAt: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
        tx.pedidoOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, status: true, comandaId: true, pontoVendaId: true, itensComanda: { select: { id: true, opcionais: { select: { id: true } } } } }, orderBy: { id: 'asc' } }),
        tx.tapMontagem.findMany({ where: { OR: [{ evento: { cervejariaId: companyId } }, { sessaoCaixa: { cervejariaId: companyId } }] }, select: { id: true, eventoId: true, sessaoCaixaId: true, tapId: true, produtoId: true, evento: { select: { cervejariaId: true } }, sessaoCaixa: { select: { cervejariaId: true } }, tap: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
        tx.produto.findMany({ where: { cervejariaId: companyId }, select: { id: true, tipo: true, formato: true, categoria: true, ativo: true, controlaEstoque: true, exigePreparo: true, precos: { select: { id: true, volumeMl: true, preco: true }, orderBy: { volumeMl: 'asc' } }, gruposOpcionais: { select: { id: true, obrigatorio: true, maximo: true, ativo: true, opcoes: { select: { id: true, ativo: true, precoAdicional: true } } }, orderBy: { ordem: 'asc' } } }, orderBy: { id: 'asc' } }),
        tx.cardapio.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, chopeVolumesConfigurados: true, produtos: { select: { id: true, produtoId: true, volumeMl: true, precoUnit: true, produto: { select: { cervejariaId: true } } }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }] } }, orderBy: { id: 'asc' } }),
        tx.tap.findMany({ where: { cervejariaId: companyId }, select: { id: true, trailerId: true, numero: true, produtoId: true, ativo: true, trailer: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
        tx.opcional.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, preco: true, produtos: { select: { produtoId: true, ordem: true } } }, orderBy: { id: 'asc' } }),
        tx.cliente.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
        tx.cliente.count({ where: { cervejariaId: companyId } }),
      ]);
      const payments = await tx.pagamento.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, forma: true, valor: true, pagoEm: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true, comanda: { select: { origem: true } } }, orderBy: { id: 'asc' } });
      const commandTotals = new Map<string, { count: number; totalCents: bigint; discountCents: bigint }>();
      const commandByOperationDay = new Map<string, { count: number; totalCents: bigint }>();
      for (const command of commands) {
        const key = `${command.origem}:${command.status}`;
        const aggregate = commandTotals.get(key) ?? { count: 0, totalCents: 0n, discountCents: 0n };
        aggregate.count++;
        aggregate.totalCents += BigInt(cents(command.total));
        aggregate.discountCents += BigInt(cents(command.desconto));
        commandTotals.set(key, aggregate);
        const operationDate = command.diaOperacional?.toISOString().slice(0, 10) ?? command.evento?.data?.toISOString().slice(0, 10) ?? command.createdAt.toISOString().slice(0, 10);
        const dayKey = `${command.origem}:${operationDate}`;
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
      const eventCommandLinks = commands.filter((command) => command.eventoId && command.pontoVendaId).map((command) => ({ id: command.id, origin: command.origem, eventId: command.eventoId, pontoVendaId: command.pontoVendaId, itemCount: command._count.itens }));
      const tenantConflicts = commands.filter((command) => (command.evento && command.evento.cervejariaId !== companyId) || (command.pontoVenda && command.pontoVenda.cervejariaId !== companyId)).map((command) => ({ id: command.id, origin: command.origem, eventId: command.eventoId, pontoVendaId: command.pontoVendaId }));
      const operationalSessionIds = new Set(operationalSessions.map((session) => session.id));
      const eventSessionIds = new Set(eventSessions.map((session) => session.id));
      const paymentLinkConflicts = payments.filter((payment) => Boolean(payment.sessaoCaixaId && payment.sessaoCaixaEventoId) || Boolean(payment.sessaoCaixaId && !operationalSessionIds.has(payment.sessaoCaixaId)) || Boolean(payment.sessaoCaixaEventoId && !eventSessionIds.has(payment.sessaoCaixaEventoId))).map((payment) => ({ id: payment.id, commandId: payment.comandaId, operationalSessionId: payment.sessaoCaixaId, eventSessionId: payment.sessaoCaixaEventoId, issue: payment.sessaoCaixaId && payment.sessaoCaixaEventoId ? 'both-session-links' : payment.sessaoCaixaId && !operationalSessionIds.has(payment.sessaoCaixaId) ? 'missing-or-cross-tenant-operational-session' : 'missing-or-cross-tenant-event-session' }));
      const identitySources = [
        ...(operationalConfig ? [{ sourceType: 'CONFIG_OPERACIONAL' as const, sourceId: companyId, linkValid: true, evidence: 'Operational config belongs to this company.' }] : []),
        ...(moduleConfig ? [{ sourceType: 'CONFIG_OPERACAO' as const, sourceId: companyId, linkValid: true, evidence: 'Operation module config belongs to this company.' }] : []),
        ...clients.map((client) => ({ sourceType: 'CLIENTE' as const, sourceId: client.id, linkValid: true, evidence: 'Client ID retained under source company.' })),
        ...products.flatMap((product) => [
          { sourceType: 'PRODUTO' as const, sourceId: product.id, linkValid: true, evidence: 'Product ID retained under source company.' },
          ...product.precos.map((price) => ({ sourceType: 'PRECO' as const, sourceId: price.id, linkValid: true, evidence: 'Price and volume remain attached to product ID.' })),
          ...product.gruposOpcionais.flatMap((group) => [{ sourceType: 'GRUPO_OPCIONAL' as const, sourceId: group.id, linkValid: true, evidence: 'Optional group remains attached to product ID.' }, ...group.opcoes.map((option) => ({ sourceType: 'OPCAO_PRODUTO' as const, sourceId: option.id, linkValid: true, evidence: 'Option remains attached to its group ID.' }))]),
        ]),
        ...menus.flatMap((menu) => [{ sourceType: 'CARDAPIO' as const, sourceId: menu.id, linkValid: true, evidence: 'Menu belongs to source company.' }, ...menu.produtos.map((row) => ({ sourceType: 'CARDAPIO_PRODUTO' as const, sourceId: row.id, linkValid: row.produto.cervejariaId === companyId, evidence: row.produto.cervejariaId === companyId ? 'Menu row and product share tenant.' : 'Menu row links to a product from another tenant.' }))]),
        ...optionals.map((optional) => ({ sourceType: 'OPCIONAL_CATALOGO' as const, sourceId: optional.id, linkValid: true, evidence: 'Optional catalog entry belongs to source company.' })),
        ...taps.map((tap) => ({ sourceType: 'TAP' as const, sourceId: tap.id, linkValid: tap.trailer.cervejariaId === companyId, evidence: tap.trailer.cervejariaId === companyId ? 'Tap and trailer share tenant.' : 'Tap links to a trailer from another tenant.' })),
        ...tapSetups.map((setup) => { const linkValid = (setup.evento?.cervejariaId ?? setup.sessaoCaixa?.cervejariaId) === companyId && setup.tap.cervejariaId === companyId && setup.produto.cervejariaId === companyId; return { sourceType: 'TAP_MONTAGEM' as const, sourceId: setup.id, linkValid, evidence: linkValid ? 'Tap setup event/session, tap and product share tenant.' : 'Tap setup contains a cross-tenant or missing parent link.' }; }),
        ...eventSessions.flatMap((session) => [{ sourceType: 'SESSAO_EVENTO' as const, sourceId: session.id, linkValid: true, evidence: 'Event cash session keeps source event ID.' }, ...session.movimentos.map((movement) => ({ sourceType: 'MOVIMENTO_EVENTO' as const, sourceId: movement.id, linkValid: true, evidence: 'Cash movement keeps original session ID.' }))]),
        ...operationalSessions.flatMap((session) => { const linkValid = session.pontoVenda.cervejariaId === companyId && (!session.trailer || session.trailer.cervejariaId === companyId); return [{ sourceType: 'SESSAO_CAIXA' as const, sourceId: session.id, linkValid, evidence: linkValid ? 'Operational session point/trailer belong to source tenant.' : 'Operational session point or trailer has another tenant.' }, ...session.movimentos.map((movement) => ({ sourceType: 'MOVIMENTO_CAIXA' as const, sourceId: movement.id, linkValid, evidence: linkValid ? 'Cash movement keeps original session ID.' : 'Cash movement belongs to cross-tenant session.' }))]; }),
        ...commands.flatMap((command) => command.itens.flatMap((item) => [{ sourceType: 'ITEM_COMANDA' as const, sourceId: item.id, linkValid: true, evidence: 'Command item keeps parent and historical snapshots.' }, ...item.opcionais.map((optional) => ({ sourceType: 'ITEM_OPCIONAL' as const, sourceId: optional.id, linkValid: true, evidence: 'Sold optional keeps its historical snapshot.' }))])),
        ...orders.flatMap((order) => [{ sourceType: 'PEDIDO' as const, sourceId: order.id, linkValid: true, evidence: 'Kitchen order keeps command, point and status.' }, ...order.itensComanda.map((item) => ({ sourceType: 'PEDIDO_ITEM_LINK' as const, sourceId: item.id, linkValid: true, evidence: 'Existing command item link to kitchen order is preserved.' }))]),
        ...stockMovements.map((movement) => ({ sourceType: 'MOVIMENTO_ESTOQUE' as const, sourceId: movement.id, linkValid: movement.pontoVenda.cervejariaId === companyId && movement.produto.cervejariaId === companyId, evidence: movement.pontoVenda.cervejariaId === companyId && movement.produto.cervejariaId === companyId ? 'Stock movement point and product share tenant.' : 'Stock movement point or product has another tenant.' })),
      ];
      const mapping = planPdvMigration({
        companyId,
        pdvIds: pdvs.map((item) => item.id),
        trailerIds: trailers.map((item) => item.id),
        events: events.map((event) => ({ id: event.id, trailerId: event.trailerId, seriesId: event.serieId, recurrence: event.recorrencia })),
        commands: commands.map((command) => ({ id: command.id, origin: command.origem, eventId: command.eventoId, pdvId: command.pontoVendaId, eventTenantId: command.evento?.cervejariaId, pdvTenantId: command.pontoVenda?.cervejariaId })),
        balances: balances.map((balance) => ({ id: balance.id, pdvId: balance.pontoVendaId, tenantValid: balance.pontoVenda.cervejariaId === companyId && balance.produto.cervejariaId === companyId })),
        payments: payments.map((payment) => ({ id: payment.id, commandId: payment.comandaId, linkedCommandOrigin: payment.comanda.origem })),
        receivables: receivables.map((account) => ({ id: account.id, commandId: account.comandaId, origin: account.comanda.origem, eventId: account.comanda.eventoId, pdvId: account.comanda.pontoVendaId })),
        identitySources,
      });
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
        companyId, companyName: company.nome, clientCount: customerCount,
        units: { pointOfSaleIds: pdvs.map((x) => x.id), trailerIds: trailers.map((x) => x.id), configurations: { operational: operationalConfig, operation: moduleConfig } },
        eventSources: { agendas: events.filter((x) => x.recorrencia === 'SEMANAL' && !x.serieId).map((x) => x.id), occurrences: events.filter((x) => x.serieId).map((x) => ({ id: x.id, seriesId: x.serieId })), oneOffEvents: events.filter((x) => x.recorrencia === 'NENHUMA' && !x.serieId).map((x) => x.id) },
        catalog: { products: products.map((p) => ({ id: p.id, type: p.tipo, category: p.categoria, active: p.ativo, controlsInventory: p.controlaEstoque, requiresKitchen: p.exigePreparo, prices: p.precos.map((price) => ({ id: price.id, volumeMl: price.volumeMl, cents: cents(price.preco) })), optionalGroups: p.gruposOpcionais.map((g) => ({ id: g.id, required: g.obrigatorio, max: g.maximo, active: g.ativo, optionIds: g.opcoes.map((o) => ({ id: o.id, active: o.ativo, cents: cents(o.precoAdicional) })) })) })), menus: menus.map((m) => ({ id: m.id, active: m.ativo, explicitTapVolumes: m.chopeVolumesConfigurados, rows: m.produtos.map((row) => ({ id: row.id, productId: row.produtoId, volumeMl: row.volumeMl, cents: cents(row.precoUnit) })) })), optionalCatalog: optionals.map((o) => ({ id: o.id, active: o.ativo, cents: cents(o.preco), linkedProductIds: o.produtos.map((link) => link.produtoId) })), taps: taps.map((tap) => ({ id: tap.id, trailerId: tap.trailerId, productId: tap.produtoId, active: tap.ativo })), tapSetups: tapSetups.map((x) => ({ id: x.id, eventId: x.eventoId, operationalSessionId: x.sessaoCaixaId, tapId: x.tapId, productId: x.produtoId })) },
        commands: { byOriginStatus: [...commandTotals].sort(([a], [b]) => a.localeCompare(b)).map(([originStatus, value]) => ({ originStatus, count: value.count, totalCents: value.totalCents.toString(), discountsCents: value.discountCents.toString() })), byOriginOperationDate: [...commandByOperationDay].sort(([a], [b]) => a.localeCompare(b)).map(([originDate, value]) => ({ originDate, count: value.count, totalCents: value.totalCents.toString() })), commandEntries: commands.map((command) => ({ id: command.id, origin: command.origem, status: command.status, eventId: command.eventoId, pointOfSaleId: command.pontoVendaId, operationDay: command.diaOperacional?.toISOString().slice(0, 10) ?? command.evento?.data?.toISOString().slice(0, 10) ?? command.createdAt.toISOString().slice(0, 10), createdAt: command.createdAt.toISOString(), totalCents: cents(command.total), discountCents: cents(command.desconto), items: command.itens.map((item) => ({ id: item.id, optionals: item.opcionais.map((optional) => ({ id: optional.id, centsEach: cents(optional.precoAdicional), quantity: optional.quantidade })) })) })), orderEntries: orders.map((order) => ({ id: order.id, commandId: order.comandaId, pointOfSaleId: order.pontoVendaId, status: order.status, items: order.itensComanda.map((item) => ({ id: item.id, optionalIds: item.opcionais.map((optional) => optional.id) })) })), orderCountsByStatus: [...orders.reduce((map, order) => map.set(order.status, (map.get(order.status) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })), itemCount: commands.reduce((sum, x) => sum + x.itens.length, 0), optionalCount: commands.reduce((sum, x) => sum + x.itens.reduce((inner, item) => inner + item.opcionais.length, 0), 0) },
        finance: { paymentPeriodBasis: 'pagoEm date, separate from command/event/operational day', paymentsByOriginFormAndPaymentDate: [...paymentTotals].sort(([a], [b]) => a.localeCompare(b)).map(([originFormDate, value]) => ({ originFormDate, count: value.count, cents: value.cents.toString() })), paymentEntries: payments.map((payment) => ({ id: payment.id, commandId: payment.comandaId, origin: payment.comanda.origem, form: payment.forma, cents: cents(payment.valor), paidAt: payment.pagoEm.toISOString(), receivableId: payment.contaReceberId, operationalSessionId: payment.sessaoCaixaId, eventSessionId: payment.sessaoCaixaEventoId })), receivables: receivableRows, eventCashSessions: eventSessions.map((s) => ({ id: s.id, eventId: s.eventoId, status: s.status, openedAt: s.abertoEm.toISOString(), closedAt: s.fechadoEm?.toISOString() ?? null, movements: s.movimentos.map((m) => ({ id: m.id, type: m.tipo, cents: cents(m.valor), createdAt: m.createdAt.toISOString() })) })), operationalCashSessions: operationalSessions.map((s) => ({ id: s.id, pointOfSaleId: s.pontoVendaId, trailerId: s.trailerId, status: s.status, openedAt: s.abertoEm.toISOString(), closedAt: s.fechadoEm?.toISOString() ?? null, movements: s.movimentos.map((m) => ({ id: m.id, type: m.tipo, cents: cents(m.valor), createdAt: m.createdAt.toISOString() })) })), paymentLinkConflicts },
        inventory: { balances: balances.map((balance) => ({ id: balance.id, pointOfSaleId: balance.pontoVendaId, productId: balance.produtoId, unit: products.find((product) => product.id === balance.produtoId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === balance.produtoId) ? 'UNIDADE' : 'NAO_COMPROVADA', milliUnits: milli(balance.quantidade) })), movements: stockMovements.map((movement) => ({ id: movement.id, pointOfSaleId: movement.pontoVendaId, productId: movement.produtoId, unit: products.find((product) => product.id === movement.produtoId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === movement.produtoId) ? 'UNIDADE' : 'NAO_COMPROVADA', type: movement.tipo, milliUnits: milli(movement.quantidade), orderId: movement.pedidoId, createdAt: movement.createdAt.toISOString() })), byProduct: [...inventoryByProduct.values()].sort((a, b) => `${a.pointOfSaleId}:${a.productId}`.localeCompare(`${b.pointOfSaleId}:${b.productId}`)).map((x) => ({ pointOfSaleId: x.pointOfSaleId, productId: x.productId, unit: products.find((product) => product.id === x.productId)?.formato === 'CHOPE' ? 'LITRO' : products.some((product) => product.id === x.productId) ? 'UNIDADE' : 'NAO_COMPROVADA', balanceMilliUnits: x.balance.toString(), movementCount: x.movementCount, movementByTypeMilliUnits: Object.fromEntries(Object.entries(x.movementByType).sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => [key, amount.toString()])) })) },
        conflicts: { eventAndPdvCommandLinks: eventCommandLinks, tenantDivergentCommands: tenantConflicts, mappingBlocked: mapping.filter((x) => x.action === 'BLOQUEADO'), mapping },
      });
    }
    return { companies: output, unattachedCommands: unattachedCommands.map((command) => ({ id: command.id, origin: command.origem, status: command.status, totalCents: cents(command.total), createdAt: command.createdAt.toISOString() })) };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
  const snapshot = snapshotData.companies;
  const focus = snapshot.filter((item) => focusNames.test(item.companyName));
  const detailed = process.argv.includes('--detail') || process.argv.includes('--all');
  const summarizeCash = (sessions: Array<{ status: string; movements: Array<{ type: string; cents: string }> }>) => sessions.reduce((sum, session) => {
    sum.sessions++;
    sum[session.status]++;
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
    companyName: company.companyName,
    clientCount: company.clientCount,
    units: company.units,
    eventSources: { agendas: company.eventSources.agendas.length, occurrences: company.eventSources.occurrences.length, oneOffEvents: company.eventSources.oneOffEvents.length },
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
    ...snapshot.flatMap((company) => company.conflicts.mappingBlocked.map((row) => ({ companyId: company.companyId, sourceType: row.sourceType, sourceId: row.sourceId, evidence: row.evidence }))),
    ...snapshotData.unattachedCommands.map((command) => ({ companyId: null, sourceType: 'COMANDA', sourceId: command.id, evidence: `Unattached command: origin=${command.origin}, status=${command.status}; tenant and destination not proven.` })),
  ];
  console.log(JSON.stringify({
    environment: 'DEV local; READ ONLY RepeatableRead snapshot',
    coverage: 'IDs only; no credentials or customer PII',
    totals: { companies: snapshot.length, withoutPdv: snapshot.filter((x) => x.units.pointOfSaleIds.length === 0).length, multiplePdv: snapshot.filter((x) => x.units.pointOfSaleIds.length > 1).length, blockedAssociations: globalBlocks.length, unattachedCommands: snapshotData.unattachedCommands.length, paymentLinkConflicts: snapshot.reduce((sum, x) => sum + x.finance.paymentLinkConflicts.length, 0), tenantDivergentCommands: snapshot.reduce((sum, x) => sum + x.conflicts.tenantDivergentCommands.length, 0) },
    unattachedCommandBreakdown: [...snapshotData.unattachedCommands.reduce((map, command) => map.set(`${command.origin}:${command.status}`, (map.get(`${command.origin}:${command.status}`) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).map(([originStatus, count]) => ({ originStatus, count })),
    globalBlocks,
    companies: detailed ? (process.argv.includes('--all') ? snapshot : focus) : summarizedFocus,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
