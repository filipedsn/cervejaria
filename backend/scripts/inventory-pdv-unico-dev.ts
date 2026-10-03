import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';
import { decimalToScaledInteger, planPdvMigration, type PlanningRecord } from './pdv-unico-migration-planner.js';
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
      const commandScope = { OR: [{ evento: { cervejariaId: companyId } }, { pontoVenda: { cervejariaId: companyId } }] };
      const [pdvs, trailers, events, commands, operationalConfig, moduleConfig, eventSessions, operationalSessions, receivables, balances, stockMovements, orders, tapSetups, products, menus, taps, optionals, clients, customerCount] = await Promise.all([
        tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
        tx.trailer.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
        tx.evento.findMany({ where: { cervejariaId: companyId }, select: { id: true, nome: true, local: true, data: true, horaInicio: true, horaFim: true, recorrencia: true, diaSemana: true, serieId: true, status: true, encerradoEm: true, comandasContadorDesde: true, portalGeneration: true, cervejariaId: true, trailerId: true, cardapioId: true, createdAt: true, updatedAt: true, trailer: { select: { cervejariaId: true } }, cardapio: { select: { cervejariaId: true } }, serie: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
        tx.comanda.findMany({ where: commandScope, select: { id: true, origem: true, status: true, tipo: true, numero: true, total: true, desconto: true, eventoId: true, clienteId: true, pontoVendaId: true, diaOperacional: true, identificador: true, abertaPorId: true, fechadoPorId: true, fechadaEm: true, createdAt: true, updatedAt: true, evento: { select: { cervejariaId: true, data: true } }, pontoVenda: { select: { cervejariaId: true } }, cliente: { select: { cervejariaId: true } }, itens: { select: { id: true, produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, nome: true, observacao: true, exigePreparo: true, paraViagem: true, cancelamentoPendenteEm: true, canceladoEm: true, pedidoCozinhaId: true, createdAt: true, opcionais: { select: { id: true, opcionalId: true, opcionalCatalogoId: true, nome: true, precoAdicional: true, quantidade: true } } } }, _count: { select: { pagamentos: true, pedidosOperacao: true } } }, orderBy: { id: 'asc' } }),
        tx.configuracaoOperacional.findUnique({ where: { cervejariaId: companyId }, select: { directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } }),
        tx.configuracaoOperacao.findUnique({ where: { cervejariaId: companyId }, select: { ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: true } }),
        tx.sessaoCaixaEvento.findMany({ where: { evento: { cervejariaId: companyId } }, select: { id: true, eventoId: true, status: true, trocoInicial: true, abertoPorId: true, abertoEm: true, fechadoPorId: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true, contadoDebito: true, contadoCredito: true, contadoCartao: true, observacaoFechamento: true, evento: { select: { cervejariaId: true } }, movimentos: { select: { id: true, tipo: true, valor: true, observacao: true, registradoPorId: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
        tx.sessaoCaixaOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, trailerId: true, pontoVenda: { select: { cervejariaId: true } }, trailer: { select: { cervejariaId: true } }, status: true, diaOperacional: true, trocoInicial: true, abertoPorId: true, abertoEm: true, fechadoPorId: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true, contadoCartaoCredito: true, observacaoFechamento: true, cardapioId: true, cardapio: { select: { cervejariaId: true } }, produtos: { select: { id: true, produtoId: true, volumeMl: true, precoUnit: true, createdAt: true, produto: { select: { cervejariaId: true } } } }, movimentos: { select: { id: true, tipo: true, valor: true, observacao: true, registradoPorId: true, correcaoDeId: true, naturezaCorrecao: true, motivoCorrecao: true, autorizadoPorId: true, solicitadoPorId: true, corrigidoEm: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
        tx.contaReceber.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, clienteId: true, valorOriginal: true, criadoPorId: true, createdAt: true, cliente: { select: { cervejariaId: true } }, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true, clienteId: true } }, pagamentos: { select: { id: true, comandaId: true, contaReceberId: true, valor: true, forma: true, pagoEm: true, sessaoCaixaId: true, sessaoCaixaEventoId: true } } }, orderBy: { id: 'asc' } }),
        tx.inventoryBalance.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, produtoId: true, quantidade: true, estoqueMinimo: true, updatedAt: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
        tx.inventoryMovement.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, produtoId: true, tipo: true, quantidade: true, observacao: true, registradoPorId: true, pedidoId: true, createdAt: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
        tx.pedidoOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, status: true, comandaId: true, pontoVendaId: true, numero: true, diaOperacional: true, paraViagem: true, observacao: true, criadoPorId: true, statusDesde: true, entregueEm: true, clienteAvisadoEm: true, createdAt: true, updatedAt: true, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true } }, pontoVenda: { select: { cervejariaId: true } }, itensComanda: { select: { id: true, comandaId: true, produtoId: true, volumeMl: true, quantidade: true, precoUnit: true, nome: true, produto: { select: { cervejariaId: true } }, opcionais: { select: { id: true, opcionalId: true, opcionalCatalogoId: true, nome: true, precoAdicional: true, quantidade: true } } } }, historicoStatus: { select: { id: true, status: true, registradoEm: true } } }, orderBy: { id: 'asc' } }),
        tx.tapMontagem.findMany({ where: { OR: [{ evento: { cervejariaId: companyId } }, { sessaoCaixa: { cervejariaId: companyId } }] }, select: { id: true, eventoId: true, sessaoCaixaId: true, tapId: true, produtoId: true, iniciadoEm: true, encerradoEm: true, evento: { select: { cervejariaId: true } }, sessaoCaixa: { select: { cervejariaId: true } }, tap: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
        tx.produto.findMany({ where: { cervejariaId: companyId }, select: { id: true, tipo: true, formato: true, categoria: true, ativo: true, controlaEstoque: true, exigePreparo: true, precos: { select: { id: true, volumeMl: true, preco: true } , orderBy: { volumeMl: 'asc' } }, gruposOpcionais: { select: { id: true, obrigatorio: true, maximo: true, ordem: true, ativo: true, opcoes: { select: { id: true, ativo: true, precoAdicional: true, produtoEstoqueId: true, produtoEstoque: { select: { cervejariaId: true } } } } }, orderBy: { ordem: 'asc' } } }, orderBy: { id: 'asc' } }),
        tx.cardapio.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, chopeVolumesConfigurados: true, produtos: { select: { id: true, produtoId: true, volumeMl: true, precoUnit: true, produto: { select: { cervejariaId: true } } }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }] } }, orderBy: { id: 'asc' } }),
        tx.tap.findMany({ where: { cervejariaId: companyId }, select: { id: true, trailerId: true, numero: true, produtoId: true, ativo: true, trailer: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
        tx.opcional.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, preco: true, produtos: { select: { id: true, produtoId: true, ordem: true } } }, orderBy: { id: 'asc' } }),
        tx.cliente.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, nome: true, telefone: true, email: true, dataNascimento: true, optInMarketing: true, optInEm: true, cadastradoVia: true, observacoes: true, ativo: true, isSistema: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
        tx.cliente.count({ where: { cervejariaId: companyId } }),
      ]);
      const [eventExclusions, eventProducts] = await Promise.all([
        tx.eventoSerieExclusao.findMany({ where: { serie: { cervejariaId: companyId } }, select: { id: true, serieId: true, data: true, cervejariaId: true, createdAt: true }, orderBy: { id: 'asc' } }),
        tx.eventoProduto.findMany({ where: { evento: { cervejariaId: companyId } }, select: { id: true, eventoId: true, produtoId: true, createdAt: true, evento: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
      ]);
      const [portalOrders, customerStatistics, transactionLogs] = await Promise.all([
        tx.pedidoCliente.findMany({ where: { evento: { cervejariaId: companyId } }, select: {
          id: true, eventoId: true, comandaId: true, clienteId: true, status: true, observacao: true,
          recusadoMotivo: true, confirmadoPorId: true, confirmadoEm: true, createdAt: true, updatedAt: true,
          evento: { select: { cervejariaId: true } }, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true, clienteId: true } },
          cliente: { select: { cervejariaId: true } },
          itens: { select: { id: true, pedidoId: true, produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, produto: { select: { cervejariaId: true } } } },
        }, orderBy: { id: 'asc' } }),
        tx.clienteEstatisticas.findMany({ where: { cliente: { cervejariaId: companyId } }, select: { clienteId: true, totalComandasFechadas: true, totalGasto: true, totalMlChope: true, primeiraVisitaEm: true, ultimaVisitaEm: true, updatedAt: true }, orderBy: { clienteId: 'asc' } }),
        tx.transacaoLog.findMany({ where: { cervejariaId: companyId, OR: [{ eventoId: { in: events.map((event) => event.id) } }, { comandaId: { in: commands.map((command) => command.id) } }] }, select: { id: true, tipo: true, usuarioId: true, eventoId: true, comandaId: true, entidadeTipo: true, entidadeId: true, metadata: true, createdAt: true }, orderBy: { id: 'asc' } }),
      ]);
      const payments = await tx.pagamento.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, forma: true, valor: true, valorRecebido: true, troco: true, registradoPorId: true, pagoEm: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true, comanda: { select: { origem: true } } }, orderBy: { id: 'asc' } });
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
      const operationalSessionIds = new Set(operationalSessions.map((session) => session.id));
      const eventSessionIds = new Set(eventSessions.map((session) => session.id));
      const paymentLinkConflicts = payments.filter((payment) => Boolean(payment.sessaoCaixaId && payment.sessaoCaixaEventoId) || Boolean(payment.sessaoCaixaId && !operationalSessionIds.has(payment.sessaoCaixaId)) || Boolean(payment.sessaoCaixaEventoId && !eventSessionIds.has(payment.sessaoCaixaEventoId))).map((payment) => ({ id: payment.id, commandId: payment.comandaId, operationalSessionId: payment.sessaoCaixaId, eventSessionId: payment.sessaoCaixaEventoId, issue: payment.sessaoCaixaId && payment.sessaoCaixaEventoId ? 'both-session-links' : payment.sessaoCaixaId && !operationalSessionIds.has(payment.sessaoCaixaId) ? 'missing-or-cross-tenant-operational-session' : 'missing-or-cross-tenant-event-session' }));
      const records: PlanningRecord[] = [];
      const add = (type: PlanningRecord['type'], id: string, parents: PlanningRecord['parents'] = [], options: Omit<PlanningRecord, 'type' | 'id' | 'tenantId' | 'parents'> & { tenantId?: string } = {}) => {
        records.push({ type, id, tenantId: options.tenantId ?? companyId, parents, ...options });
      };
      for (const pdv of pdvs) add('PDV', pdv.id);
      for (const trailer of trailers) add('TRAILER', trailer.id);
      const configurationConflict = Boolean(operationalConfig && moduleConfig && (
        operationalConfig.inventoryEnabled !== moduleConfig.controlaEstoque
        || operationalConfig.kitchenEnabled !== moduleConfig.temCozinha
      ));
      const configurationBlocker = configurationConflict ? {
        code: 'CONFIGURATION_SOURCE_CONFLICT',
        category: 'DECISAO_MANUAL' as const,
        evidence: 'As flags de estoque/cozinha das duas configurações diferem; o destino exige decisão explícita por recurso.',
      } : undefined;
      if (operationalConfig) add('CONFIG_OPERACIONAL', companyId, [], { blocker: configurationBlocker });
      if (moduleConfig) add('CONFIG_OPERACAO', companyId, [], { blocker: configurationBlocker });
      for (const client of clients) add('CLIENTE', client.id, [], { tenantId: client.cervejariaId });
      for (const statistics of customerStatistics) add('CLIENTE_ESTATISTICA', statistics.clienteId, [{ type: 'CLIENTE', id: statistics.clienteId, relation: 'clienteId' }], { sourceLinks: { clienteId: statistics.clienteId }, requiredLinks: ['clienteId'] });
      for (const product of products) {
        add('PRODUTO', product.id, [], { tenantId: companyId });
        for (const price of product.precos) add('PRECO', price.id, [{ type: 'PRODUTO', id: product.id, relation: 'produtoId' }]);
        for (const group of product.gruposOpcionais) {
          add('GRUPO_OPCIONAL', group.id, [{ type: 'PRODUTO', id: product.id, relation: 'produtoId' }]);
          for (const option of group.opcoes) add('OPCAO_PRODUTO', option.id, [{ type: 'GRUPO_OPCIONAL', id: group.id, relation: 'grupoId' }, ...(option.produtoEstoqueId ? [{ type: 'PRODUTO' as const, id: option.produtoEstoqueId, relation: 'produtoEstoqueId', tenantId: option.produtoEstoque?.cervejariaId }] : [])]);
        }
      }
      for (const menu of menus) {
        add('CARDAPIO', menu.id);
        for (const item of menu.produtos) add('CARDAPIO_PRODUTO', item.id, [{ type: 'CARDAPIO', id: menu.id, relation: 'cardapioId' }, { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId }]);
      }
      for (const optional of optionals) add('OPCIONAL_CATALOGO', optional.id);
      for (const optional of optionals) for (const link of optional.produtos) add('OPCIONAL_VINCULO', link.id, [{ type: 'OPCIONAL_CATALOGO', id: optional.id, relation: 'opcionalId' }, { type: 'PRODUTO', id: link.produtoId, relation: 'produtoId' }]);
      for (const event of events) {
        const parents: NonNullable<PlanningRecord['parents']> = [{ type: 'TRAILER', id: event.trailerId, relation: 'trailerId', tenantId: event.trailer.cervejariaId }];
        if (event.cardapioId) parents.push({ type: 'CARDAPIO', id: event.cardapioId, relation: 'cardapioId', tenantId: event.cardapio?.cervejariaId });
        if (event.serieId) parents.push({ type: 'EVENTO', id: event.serieId, relation: 'serieId', tenantId: event.serie?.cervejariaId });
        add('EVENTO', event.id, parents, { sourceLinks: { trailerId: event.trailerId, cardapioId: event.cardapioId, serieId: event.serieId }, pdvFrom: { type: 'TRAILER', id: event.trailerId, relation: 'trailerId' } });
      }
      for (const request of portalOrders) add('PEDIDO_CLIENTE', request.id, [
        { type: 'EVENTO', id: request.eventoId, relation: 'eventoId', tenantId: request.evento.cervejariaId },
        { type: 'COMANDA', id: request.comandaId, relation: 'comandaId' },
        { type: 'CLIENTE', id: request.clienteId, relation: 'clienteId', tenantId: request.cliente.cervejariaId },
      ], { sourceLinks: { eventoId: request.eventoId, comandaId: request.comandaId, clienteId: request.clienteId }, requiredLinks: ['eventoId', 'comandaId', 'clienteId'], pdvFrom: { type: 'EVENTO', id: request.eventoId, relation: 'eventoId' } });
      for (const request of portalOrders) for (const item of request.itens) add('PEDIDO_CLIENTE_ITEM', item.id, [
        { type: 'PEDIDO_CLIENTE', id: request.id, relation: 'pedidoId' },
        { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId },
      ], { sourceLinks: { pedidoId: request.id, produtoId: item.produtoId }, requiredLinks: ['pedidoId', 'produtoId'], pdvFrom: { type: 'PEDIDO_CLIENTE', id: request.id, relation: 'pedidoId' } });
      for (const log of transactionLogs) {
        const parents: NonNullable<PlanningRecord['parents']> = [];
        if (log.eventoId) parents.push({ type: 'EVENTO', id: log.eventoId, relation: 'eventoId' });
        if (log.comandaId) parents.push({ type: 'COMANDA', id: log.comandaId, relation: 'comandaId' });
        const sourceLinks = { eventoId: log.eventoId, comandaId: log.comandaId };
        const pdvFrom = log.eventoId ? { type: 'EVENTO' as const, id: log.eventoId, relation: 'eventoId' }
          : log.comandaId ? { type: 'COMANDA' as const, id: log.comandaId, relation: 'comandaId' } : undefined;
        add('TRANSACAO_LOG', log.id, parents, { sourceLinks, pdvFrom });
      }
      for (const exclusion of eventExclusions) add('AGENDA_EXCECAO', exclusion.id, [{ type: 'EVENTO', id: exclusion.serieId, relation: 'serieId', tenantId: exclusion.cervejariaId }], { sourceLinks: { serieId: exclusion.serieId } });
      for (const item of eventProducts) add('EVENTO_PRODUTO', item.id, [{ type: 'EVENTO', id: item.eventoId, relation: 'eventoId', tenantId: item.evento.cervejariaId }, { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId }], { sourceLinks: { eventoId: item.eventoId, produtoId: item.produtoId } });
      for (const tap of taps) add('TAP', tap.id, [{ type: 'TRAILER', id: tap.trailerId, relation: 'trailerId', tenantId: tap.trailer.cervejariaId }, ...(tap.produtoId ? [{ type: 'PRODUTO' as const, id: tap.produtoId, relation: 'produtoId' }] : [])], { sourceLinks: { trailerId: tap.trailerId, produtoId: tap.produtoId } });
      for (const session of eventSessions) add('SESSAO_EVENTO', session.id, [{ type: 'EVENTO', id: session.eventoId, relation: 'eventoId', tenantId: session.evento.cervejariaId }], { sourceLinks: { eventoId: session.eventoId }, requiredLinks: ['eventoId'], pdvFrom: { type: 'EVENTO', id: session.eventoId, relation: 'eventoId' } });
      for (const session of operationalSessions) add('SESSAO_CAIXA', session.id, [
        { type: 'PDV', id: session.pontoVendaId, relation: 'pontoVendaId', tenantId: session.pontoVenda.cervejariaId },
        ...(session.trailerId ? [{ type: 'TRAILER' as const, id: session.trailerId, relation: 'trailerId', tenantId: session.trailer?.cervejariaId }] : []),
        ...(session.cardapioId ? [{ type: 'CARDAPIO' as const, id: session.cardapioId, relation: 'cardapioId', tenantId: session.cardapio?.cervejariaId }] : []),
      ], { sourceLinks: { pontoVendaId: session.pontoVendaId, trailerId: session.trailerId, cardapioId: session.cardapioId }, requiredLinks: ['pontoVendaId'], pdvFrom: { type: 'PDV', id: session.pontoVendaId, relation: 'pontoVendaId' } });
      for (const command of commands) {
        const parents: NonNullable<PlanningRecord['parents']> = [];
        if (command.eventoId) parents.push({ type: 'EVENTO', id: command.eventoId, relation: 'eventoId', tenantId: command.evento?.cervejariaId });
        if (command.pontoVendaId) parents.push({ type: 'PDV', id: command.pontoVendaId, relation: 'pontoVendaId', tenantId: command.pontoVenda?.cervejariaId });
        if (command.clienteId) parents.push({ type: 'CLIENTE', id: command.clienteId, relation: 'clienteId', tenantId: command.cliente?.cervejariaId });
        const pdvParent = command.origem === 'EVENTO' && command.eventoId
          ? { type: 'EVENTO' as const, id: command.eventoId, relation: 'eventoId' }
          : command.pontoVendaId ? { type: 'PDV' as const, id: command.pontoVendaId, relation: 'pontoVendaId' } : undefined;
        const blocker = command.origem === 'EVENTO' && !command.eventoId || ['CAIXA', 'QUIOSQUE'].includes(command.origem) && !command.pontoVendaId
          ? { code: 'REQUIRED_ORIGIN_LINK_MISSING', category: 'CONFLITO_DADOS' as const, evidence: `Origem ${command.origem} sem seu vínculo obrigatório na fotografia.` }
          : !['EVENTO', 'CAIXA', 'QUIOSQUE'].includes(command.origem)
            ? { code: 'UNKNOWN_COMMAND_ORIGIN', category: 'INFORMACAO_INSUFICIENTE' as const, evidence: `Origem ${command.origem} ainda não tem regra explícita no planejador.` }
            : undefined;
        const requiredLinks = command.origem === 'EVENTO' ? ['eventoId'] : ['CAIXA', 'QUIOSQUE'].includes(command.origem) ? ['pontoVendaId'] : [];
        add('COMANDA', command.id, parents, { sourceLinks: { eventoId: command.eventoId, pontoVendaId: command.pontoVendaId, clienteId: command.clienteId }, requiredLinks, pdvFrom: pdvParent, pdvConstraints: command.eventoId && command.pontoVendaId ? [{ type: 'PDV', id: command.pontoVendaId, relation: 'pontoVendaId' }] : [], blocker });
        for (const item of command.itens) {
          const itemParents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: command.id, relation: 'comandaId' }];
          if (item.produtoId) itemParents.push({ type: 'PRODUTO', id: item.produtoId, relation: 'produtoId' });
          if (item.tapId) itemParents.push({ type: 'TAP', id: item.tapId, relation: 'tapId' });
          if (item.pedidoCozinhaId) itemParents.push({ type: 'PEDIDO', id: item.pedidoCozinhaId, relation: 'pedidoCozinhaId' });
          add('ITEM_COMANDA', item.id, itemParents, { sourceLinks: { comandaId: command.id, produtoId: item.produtoId, tapId: item.tapId, pedidoCozinhaId: item.pedidoCozinhaId }, pdvFrom: pdvParent });
          for (const optional of item.opcionais) add('ITEM_OPCIONAL', optional.id, [
            { type: 'ITEM_COMANDA', id: item.id, relation: 'itemComandaId' },
            ...(optional.opcionalId ? [{ type: 'OPCAO_PRODUTO' as const, id: optional.opcionalId, relation: 'opcionalId' }] : []),
            ...(optional.opcionalCatalogoId ? [{ type: 'OPCIONAL_CATALOGO' as const, id: optional.opcionalCatalogoId, relation: 'opcionalCatalogoId' }] : []),
          ], { sourceLinks: { itemComandaId: item.id, opcionalId: optional.opcionalId, opcionalCatalogoId: optional.opcionalCatalogoId }, pdvFrom: pdvParent });
        }
      }
      for (const session of eventSessions) for (const movement of session.movimentos) add('MOVIMENTO_EVENTO', movement.id, [{ type: 'SESSAO_EVENTO', id: session.id, relation: 'sessaoId' }], { sourceLinks: { sessaoId: session.id } });
      for (const session of operationalSessions) {
        for (const product of session.produtos) add('SESSAO_PRODUTO', product.id, [{ type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoCaixaId' }, { type: 'PRODUTO', id: product.produtoId, relation: 'produtoId', tenantId: product.produto.cervejariaId }], { sourceLinks: { sessaoCaixaId: session.id, produtoId: product.produtoId }, pdvFrom: { type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoCaixaId' } });
        for (const movement of session.movimentos) add('MOVIMENTO_CAIXA', movement.id, [{ type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoId' }, ...(movement.correcaoDeId ? [{ type: 'MOVIMENTO_CAIXA' as const, id: movement.correcaoDeId, relation: 'correcaoDeId' }] : [])], { sourceLinks: { sessaoId: session.id, correcaoDeId: movement.correcaoDeId }, pdvFrom: { type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoId' } });
      }
      for (const order of orders) {
        const orderParents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: order.comandaId, relation: 'comandaId' }];
        if (order.pontoVendaId) orderParents.push({ type: 'PDV', id: order.pontoVendaId, relation: 'pontoVendaId', tenantId: order.pontoVenda?.cervejariaId });
        add('PEDIDO', order.id, orderParents, { sourceLinks: { comandaId: order.comandaId, pontoVendaId: order.pontoVendaId }, pdvFrom: { type: 'COMANDA', id: order.comandaId, relation: 'comandaId' }, pdvConstraints: order.pontoVendaId ? [{ type: 'PDV', id: order.pontoVendaId, relation: 'pontoVendaId' }] : [] });
        for (const item of order.itensComanda) add('PEDIDO_ITEM_LINK', item.id, [{ type: 'PEDIDO', id: order.id, relation: 'pedidoId' }, { type: 'ITEM_COMANDA', id: item.id, relation: 'itemComandaId' }]);
        for (const history of order.historicoStatus) add('PEDIDO_HISTORICO', history.id, [{ type: 'PEDIDO', id: order.id, relation: 'pedidoId' }]);
      }
      for (const payment of payments) {
        const parents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: payment.comandaId, relation: 'comandaId' }];
        if (payment.contaReceberId) parents.push({ type: 'CONTA_RECEBER', id: payment.contaReceberId, relation: 'contaReceberId' });
        if (payment.sessaoCaixaId) parents.push({ type: 'SESSAO_CAIXA', id: payment.sessaoCaixaId, relation: 'sessaoCaixaId' });
        if (payment.sessaoCaixaEventoId) parents.push({ type: 'SESSAO_EVENTO', id: payment.sessaoCaixaEventoId, relation: 'sessaoCaixaEventoId' });
        const doubleSession = payment.sessaoCaixaId && payment.sessaoCaixaEventoId;
        add('PAGAMENTO', payment.id, parents, { sourceLinks: { comandaId: payment.comandaId, contaReceberId: payment.contaReceberId, sessaoCaixaId: payment.sessaoCaixaId, sessaoCaixaEventoId: payment.sessaoCaixaEventoId }, requiredLinks: ['comandaId'], pdvFrom: { type: 'COMANDA', id: payment.comandaId, relation: 'comandaId' }, blocker: doubleSession ? { code: 'PAYMENT_SESSION_LINK_CONFLICT', category: 'CONFLITO_DADOS', evidence: 'O mesmo pagamento referencia simultaneamente sessão operacional e sessão de evento.' } : undefined });
      }
      for (const account of receivables) add('CONTA_RECEBER', account.id, [{ type: 'COMANDA', id: account.comandaId, relation: 'comandaId' }, { type: 'CLIENTE', id: account.clienteId, relation: 'clienteId', tenantId: account.cliente.cervejariaId }], { sourceLinks: { comandaId: account.comandaId, clienteId: account.clienteId }, requiredLinks: ['comandaId', 'clienteId'], pdvFrom: { type: 'COMANDA', id: account.comandaId, relation: 'comandaId' } });
      for (const setup of tapSetups) add('TAP_MONTAGEM', setup.id, [
        ...(setup.eventoId ? [{ type: 'EVENTO' as const, id: setup.eventoId, relation: 'eventoId', tenantId: setup.evento?.cervejariaId }] : []),
        ...(setup.sessaoCaixaId ? [{ type: 'SESSAO_CAIXA' as const, id: setup.sessaoCaixaId, relation: 'sessaoCaixaId', tenantId: setup.sessaoCaixa?.cervejariaId }] : []),
        { type: 'TAP', id: setup.tapId, relation: 'tapId', tenantId: setup.tap.cervejariaId }, { type: 'PRODUTO', id: setup.produtoId, relation: 'produtoId', tenantId: setup.produto.cervejariaId },
      ], { sourceLinks: { eventoId: setup.eventoId, sessaoCaixaId: setup.sessaoCaixaId, tapId: setup.tapId, produtoId: setup.produtoId }, pdvFrom: setup.eventoId ? { type: 'EVENTO', id: setup.eventoId, relation: 'eventoId' } : setup.sessaoCaixaId ? { type: 'SESSAO_CAIXA', id: setup.sessaoCaixaId, relation: 'sessaoCaixaId' } : undefined });
      for (const balance of balances) add('ESTOQUE', balance.id, [{ type: 'PDV', id: balance.pontoVendaId, relation: 'pontoVendaId', tenantId: balance.pontoVenda.cervejariaId }, { type: 'PRODUTO', id: balance.produtoId, relation: 'produtoId', tenantId: balance.produto.cervejariaId }], { sourceLinks: { pontoVendaId: balance.pontoVendaId, produtoId: balance.produtoId }, pdvFrom: { type: 'PDV', id: balance.pontoVendaId, relation: 'pontoVendaId' } });
      for (const movement of stockMovements) add('MOVIMENTO_ESTOQUE', movement.id, [{ type: 'PDV', id: movement.pontoVendaId, relation: 'pontoVendaId', tenantId: movement.pontoVenda.cervejariaId }, { type: 'PRODUTO', id: movement.produtoId, relation: 'produtoId', tenantId: movement.produto.cervejariaId }, ...(movement.pedidoId ? [{ type: 'PEDIDO' as const, id: movement.pedidoId, relation: 'pedidoId' }] : [])], { sourceLinks: { pontoVendaId: movement.pontoVendaId, produtoId: movement.produtoId, pedidoId: movement.pedidoId }, pdvFrom: { type: 'PDV', id: movement.pontoVendaId, relation: 'pontoVendaId' } });
      const mapping = planPdvMigration({
        companyId,
        pdvIds: pdvs.map((item) => item.id),
        trailerIds: trailers.map((item) => item.id),
        records,
      });
      const mappingByKey = new Map(mapping.map((planned) => [`${planned.sourceType}:${planned.sourceId}`, planned]));
      const eventCommandLinkResults = eventCommandLinks.map((link) => {
        const planned = mappingByKey.get(`COMANDA:${link.id}`);
        return { ...link, destinationPdvId: planned?.canonicalPdvId ?? null, mappingAction: planned?.action ?? 'BLOQUEADO', mappingComplete: planned?.mappingComplete ?? false, blockerCode: planned?.blocker?.code ?? null, blockerCategory: planned?.blocker?.category ?? null, evidence: planned?.evidence ?? 'Comanda não consta no grafo fotografado.' };
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
        units: { pointOfSaleIds: pdvs.map((x) => x.id), trailerIds: trailers.map((x) => x.id), configurations: { operational: operationalConfig, operation: moduleConfig } },
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
    ...snapshot.flatMap((company) => company.conflicts.mappingBlocked.map((row) => ({ companyId: company.companyId, sourceType: row.sourceType, sourceId: row.sourceId, category: row.blocker?.category ?? 'INFORMACAO_INSUFICIENTE', code: row.blocker?.code ?? 'UNKNOWN', evidence: row.evidence }))),
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
