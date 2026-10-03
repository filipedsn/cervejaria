import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { planPdvMigration } from './pdv-unico-migration-planner.js';
import type { PlanningRecord } from './pdv-unico-migration-planner.js';

const qaDatabaseUrl = validateIsolatedQaEnvironment(process.env).toString();
process.env.DATABASE_URL = qaDatabaseUrl;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: qaDatabaseUrl } } });

test('PDV-SNAPSHOT-QA-01: fotografia Prisma conserva vínculos, valores e bloqueia sessão de pagamento ambígua', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let companyId: string | undefined;
  let eventId: string | undefined;
  let commandId: string | undefined;
  let itemId: string | undefined;
  let paymentId: string | undefined;
  let accountId: string | undefined;
  try {
    const company = await prisma.cervejaria.create({ data: { nome: `Synthetic planner ${suffix}`, slug: `planner-${suffix}` } });
    companyId = company.id;
    const user = await prisma.usuario.create({ data: { nome: 'Synthetic QA actor', email: `planner-${suffix}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
    const [pdv, trailer, client, product] = await Promise.all([
      prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Synthetic PDV' } }),
      prisma.trailer.create({ data: { cervejariaId: company.id, nome: 'Synthetic trailer' } }),
      prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Synthetic customer' } }),
      prisma.produto.create({ data: { cervejariaId: company.id, nome: 'Synthetic product', controlaEstoque: true } }),
    ]);
    const event = await prisma.evento.create({ data: { cervejariaId: company.id, trailerId: trailer.id, nome: 'Synthetic event', local: 'QA', data: new Date('2026-10-03T12:00:00Z') } });
    eventId = event.id;
    const command = await prisma.comanda.create({ data: { origem: 'EVENTO', eventoId: event.id, pontoVendaId: pdv.id, clienteId: client.id, status: 'FECHADA', total: '12.34', desconto: '0.50' } });
    commandId = command.id;
    const item = await prisma.itemComanda.create({ data: { comandaId: command.id, produtoId: product.id, quantidade: 2, volumeMl: 500, precoUnit: '6.17', nome: 'Snapshot name is redacted' } });
    itemId = item.id;
    const account = await prisma.contaReceber.create({ data: { comandaId: command.id, clienteId: client.id, valorOriginal: '12.34', criadoPorId: user.id } });
    accountId = account.id;
    const cashSession = await prisma.sessaoCaixaEvento.create({ data: { eventoId: event.id, abertoPorId: user.id } });
    const payment = await prisma.pagamento.create({ data: { comandaId: command.id, contaReceberId: account.id, sessaoCaixaEventoId: cashSession.id, sessaoCaixaId: `foreign-op-session-${suffix}`, forma: 'PIX', valor: '2.34', pagoEm: new Date('2026-10-03T15:30:00Z') } });
    paymentId = payment.id;

    const snapshot = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const commands = await tx.comanda.findMany({ where: { evento: { cervejariaId: company.id } }, select: {
        id: true, origem: true, eventoId: true, pontoVendaId: true, clienteId: true, total: true, desconto: true,
        evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } }, cliente: { select: { cervejariaId: true } },
        itens: { select: { id: true, produtoId: true, quantidade: true, volumeMl: true, precoUnit: true } },
        pagamentos: { select: { id: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true, valor: true, forma: true, pagoEm: true } },
        contaReceber: { select: { id: true, clienteId: true, valorOriginal: true } },
      } });
      const sessions = await tx.sessaoCaixaEvento.findMany({ where: { eventoId: event.id }, select: { id: true, eventoId: true } });
      return { commands, sessions };
    }, { isolationLevel: 'RepeatableRead' });
    assert.equal(snapshot.commands.length, 1, 'required synthetic command fixture must exist');
    assert.equal(snapshot.commands[0]!.itens.length, 1);
    assert.equal(snapshot.commands[0]!.itens[0]!.id, itemId);
    assert.equal(snapshot.commands[0]!.total.toFixed(2), '12.34');
    assert.equal(snapshot.commands[0]!.contaReceber?.valorOriginal.toFixed(2), '12.34');
    assert.equal(snapshot.commands[0]!.pagamentos[0]!.id, paymentId);
    assert.equal(snapshot.commands[0]!.pagamentos[0]!.sessaoCaixaId, `foreign-op-session-${suffix}`);
    assert.equal(snapshot.commands[0]!.pagamentos[0]!.sessaoCaixaEventoId, snapshot.sessions[0]!.id);

    const records: PlanningRecord[] = [
      { type: 'PDV', id: pdv.id, tenantId: company.id },
      { type: 'TRAILER', id: trailer.id, tenantId: company.id },
      { type: 'EVENTO', id: event.id, tenantId: company.id, parents: [{ type: 'TRAILER', id: trailer.id, relation: 'trailerId', tenantId: company.id }], pdvFrom: { type: 'TRAILER', id: trailer.id, relation: 'trailerId' } },
      { type: 'CLIENTE', id: client.id, tenantId: company.id },
      { type: 'PRODUTO', id: product.id, tenantId: company.id },
      { type: 'COMANDA', id: command.id, tenantId: company.id, parents: [{ type: 'EVENTO', id: event.id, relation: 'eventoId', tenantId: snapshot.commands[0]!.evento!.cervejariaId }, { type: 'PDV', id: pdv.id, relation: 'pontoVendaId', tenantId: snapshot.commands[0]!.pontoVenda!.cervejariaId }, { type: 'CLIENTE', id: client.id, relation: 'clienteId', tenantId: snapshot.commands[0]!.cliente!.cervejariaId }], requiredLinks: ['eventoId'], sourceLinks: { eventoId: command.eventoId, pontoVendaId: command.pontoVendaId, clienteId: command.clienteId }, pdvFrom: { type: 'EVENTO', id: event.id, relation: 'eventoId' }, pdvConstraints: [{ type: 'PDV', id: pdv.id, relation: 'pontoVendaId' }] },
      { type: 'ITEM_COMANDA', id: item.id, tenantId: company.id, parents: [{ type: 'COMANDA', id: command.id, relation: 'comandaId' }, { type: 'PRODUTO', id: product.id, relation: 'produtoId' }] },
      { type: 'SESSAO_EVENTO', id: snapshot.sessions[0]!.id, tenantId: company.id, parents: [{ type: 'EVENTO', id: event.id, relation: 'eventoId' }], requiredLinks: ['eventoId'], sourceLinks: { eventoId: event.id }, pdvFrom: { type: 'EVENTO', id: event.id, relation: 'eventoId' } },
      { type: 'CONTA_RECEBER', id: snapshot.commands[0]!.contaReceber!.id, tenantId: company.id, parents: [{ type: 'COMANDA', id: command.id, relation: 'comandaId' }, { type: 'CLIENTE', id: client.id, relation: 'clienteId' }] },
      { type: 'PAGAMENTO', id: payment.id, tenantId: company.id, parents: [{ type: 'COMANDA', id: command.id, relation: 'comandaId' }, { type: 'CONTA_RECEBER', id: account.id, relation: 'contaReceberId' }, { type: 'SESSAO_EVENTO', id: snapshot.commands[0]!.pagamentos[0]!.sessaoCaixaEventoId!, relation: 'sessaoCaixaEventoId' }], requiredLinks: ['comandaId'], blocker: { code: 'PAYMENT_SESSION_LINK_CONFLICT', category: 'CONFLITO_DADOS', evidence: 'Pagamento sintético aponta para sessão operacional não fotografada e para sessão de Evento.' } },
    ];
    const plan = planPdvMigration({ companyId: company.id, pdvIds: [pdv.id], trailerIds: [trailer.id], records });
    const plannedCommand = plan.find((row) => row.sourceType === 'COMANDA' && row.sourceId === command.id)!;
    const plannedPayment = plan.find((row) => row.sourceType === 'PAGAMENTO' && row.sourceId === payment.id)!;
    assert.equal(plannedCommand.mappingComplete, true);
    assert.equal(plannedCommand.canonicalPdvId, pdv.id);
    assert.equal(plannedPayment.blocker?.code, 'PAYMENT_SESSION_LINK_CONFLICT');
    console.log('PASS PDV-SNAPSHOT-QA-01: fixture Prisma sintética fotografada em RepeatableRead; valores/IDs preservados; sessão de pagamento ambígua bloqueada.');
  } finally {
    if (commandId) await prisma.itemComanda.deleteMany({ where: { comandaId: commandId } });
    if (accountId) await prisma.pagamento.deleteMany({ where: { contaReceberId: accountId } });
    if (commandId) await prisma.contaReceber.deleteMany({ where: { comandaId: commandId } });
    if (commandId) await prisma.pagamento.deleteMany({ where: { comandaId: commandId } });
    if (commandId) await prisma.comanda.deleteMany({ where: { id: commandId } });
    if (eventId) await prisma.sessaoCaixaEvento.deleteMany({ where: { eventoId: eventId } });
    if (eventId) await prisma.evento.deleteMany({ where: { id: eventId } });
    if (companyId) await prisma.cervejaria.deleteMany({ where: { id: companyId } });
  }
});

test.after(async () => { await prisma.$disconnect(); });
