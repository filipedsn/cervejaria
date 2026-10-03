import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import {
  bloquearCaixaEvento,
  eventoCaixaInclude,
  FORMAS_CAIXA_EVENTO,
  obterCaixaAtualEvento,
  resumoCaixaEvento,
} from '../lib/evento-caixa.js';
import { normalizePhone } from '../lib/phone.js';
import { recalculateClienteStats } from '../lib/cliente-stats.js';
import { lockComandaItemsInTx } from '../lib/comanda-service.js';
import { centavos, reais } from '../lib/operacao/venda.js';
import { emitToEvento } from '../lib/realtime.js';

const abrirSchema = z.object({ trocoInicial: z.number().finite().min(0).max(1_000_000) });
const movimentoSchema = z.object({
  tipo: z.enum(['SUPRIMENTO', 'SANGRIA']),
  valor: z.number().finite().positive().max(1_000_000),
  observacao: z.string().trim().max(300).optional(),
});
const fecharSchema = z.object({
  contadoDinheiro: z.number().finite().min(0).max(1_000_000),
  contadoPix: z.number().finite().min(0).max(1_000_000),
  contadoDebito: z.number().finite().min(0).max(1_000_000),
  contadoCredito: z.number().finite().min(0).max(1_000_000),
  contadoCartao: z.number().finite().min(0).max(1_000_000),
  observacaoFechamento: z.string().trim().max(1000).optional(),
});
const receberSchema = z.object({
  pagamentos: z.array(z.object({ forma: z.enum(FORMAS_CAIXA_EVENTO), valor: z.number().finite().positive() })).min(1).max(4),
});

function resumirConta(conta: {
  id: string; valorOriginal: unknown; createdAt: Date;
  cliente: { id: string; nome: string; telefone: string | null };
  comanda: { id: string; numero: number | null; fechadaEm: Date | null; itens: Array<{ nome: string | null; quantidade: number }> };
  pagamentos: Array<{ id: string; forma: string; valor: unknown; pagoEm: Date }>;
}) {
  const valorOriginal = Number(conta.valorOriginal);
  const recebido = conta.pagamentos.reduce((sum, payment) => sum + Number(payment.valor), 0);
  return { ...conta, valorOriginal, recebido, saldo: Math.max(0, Math.round((valorOriginal - recebido) * 100) / 100) };
}

export async function eventoCaixaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/:eventoId/caixa', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const evento = await prisma.evento.findFirst({ where: { id: eventoId, cervejariaId: user.cervejariaId } });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    const session = await prisma.sessaoCaixaEvento.findFirst({
      where: { eventoId },
      include: eventoCaixaInclude,
      orderBy: { abertoEm: 'desc' },
    });
    return { caixa: resumoCaixaEvento(session), aberto: session?.status === 'ABERTO' };
  });

  app.post('/:eventoId/caixa/abrir', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const body = abrirSchema.parse(request.body);
    const evento = await prisma.evento.findFirst({ where: { id: eventoId, cervejariaId: user.cervejariaId } });
    if (!evento || evento.status !== 'ABERTO' || evento.recorrencia === 'SEMANAL') {
      return reply.status(409).send({ error: 'Abra o caixa somente em uma sessão de evento ativa' });
    }

    try {
      const session = await prisma.$transaction(async (tx) => {
        await bloquearCaixaEvento(tx, eventoId);
        const activeEvent = await tx.evento.findFirst({
          where: { id: eventoId, cervejariaId: user.cervejariaId, status: 'ABERTO', recorrencia: 'NENHUMA' },
          select: { id: true },
        });
        if (!activeEvent) {
          throw Object.assign(new Error('Abra o caixa somente em uma sessão de evento ativa'), { statusCode: 409 });
        }
        const exists = await tx.sessaoCaixaEvento.findFirst({ where: { eventoId, status: 'ABERTO' }, select: { id: true } });
        if (exists) throw Object.assign(new Error('Já existe um caixa aberto neste evento'), { statusCode: 409 });
        const created = await tx.sessaoCaixaEvento.create({
          data: { eventoId, trocoInicial: body.trocoInicial, abertoPorId: user.sub },
          include: eventoCaixaInclude,
        });
        await registrarTransacao({
          cervejariaId: user.cervejariaId,
          tipo: 'EVENTO_CAIXA_ABERTO',
          usuarioId: user.sub,
          eventoId,
          metadata: { trocoInicial: body.trocoInicial },
          payload: { caixaId: created.id },
        }, tx);
        return created;
      });
      emitToEvento(app.io, eventoId, { type: 'evento-caixa:updated', data: { eventoId } });
      return reply.status(201).send({ caixa: resumoCaixaEvento(session), aberto: true });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 409) return reply.status(409).send({ error: (error as Error).message });
      throw error;
    }
  });

  app.post('/:eventoId/caixa/movimentos', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const body = movimentoSchema.parse(request.body);
    const session = await prisma.$transaction(async (tx) => {
      await bloquearCaixaEvento(tx, eventoId);
      const evento = await tx.evento.findFirst({
        where: { id: eventoId, cervejariaId: user.cervejariaId }, select: { id: true },
      });
      if (!evento) throw Object.assign(new Error('Evento não encontrado'), { statusCode: 404 });
      const opened = await tx.sessaoCaixaEvento.findFirst({ where: { eventoId, status: 'ABERTO' }, select: { id: true } });
      if (!opened) throw Object.assign(new Error('Abra o caixa do evento antes de registrar movimentos'), { statusCode: 409 });
      const movement = await tx.movimentoCaixaEvento.create({
        data: { sessaoId: opened.id, tipo: body.tipo, valor: body.valor, observacao: body.observacao, registradoPorId: user.sub },
      });
      await registrarTransacao({
        cervejariaId: user.cervejariaId,
        tipo: 'EVENTO_CAIXA_MOVIMENTO',
        usuarioId: user.sub,
        eventoId,
        metadata: { tipo: body.tipo, valor: body.valor, movimentoId: movement.id },
        payload: movement,
      }, tx);
      return movement;
    }).catch((error: unknown) => {
      if ([404, 409].includes((error as { statusCode?: number }).statusCode ?? 0)) {
        return { error: (error as Error).message, statusCode: (error as { statusCode: number }).statusCode };
      }
      throw error;
    });
    if ('error' in session) return reply.status(session.statusCode).send({ error: session.error });
    emitToEvento(app.io, eventoId, { type: 'evento-caixa:updated', data: { eventoId } });
    return { movimento: session, caixa: resumoCaixaEvento(await obterCaixaAtualEvento(eventoId)) };
  });

  app.post('/:eventoId/caixa/fechar', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const body = fecharSchema.parse(request.body);
    const result = await prisma.$transaction(async (tx) => {
      await bloquearCaixaEvento(tx, eventoId);
      const evento = await tx.evento.findFirst({ where: { id: eventoId, cervejariaId: user.cervejariaId }, select: { id: true, status: true } });
      if (!evento || evento.status !== 'ABERTO') throw Object.assign(new Error('O evento não está aberto'), { statusCode: 409 });
      const abertas = await tx.comanda.count({ where: { eventoId, status: 'ABERTA' } });
      if (abertas) throw Object.assign(new Error(`Feche ou deixe pendentes as ${abertas} comanda(s) aberta(s) antes de fechar o caixa`), { statusCode: 409 });
      const opened = await tx.sessaoCaixaEvento.findFirst({ where: { eventoId, status: 'ABERTO' }, select: { id: true } });
      if (!opened) throw Object.assign(new Error('Não há caixa aberto neste evento'), { statusCode: 409 });
      const closed = await tx.sessaoCaixaEvento.update({
        where: { id: opened.id },
        data: {
          status: 'FECHADO', fechadoPorId: user.sub, fechadoEm: new Date(),
          contadoDinheiro: body.contadoDinheiro, contadoPix: body.contadoPix,
          contadoDebito: body.contadoDebito, contadoCredito: body.contadoCredito,
          contadoCartao: body.contadoCartao,
          observacaoFechamento: body.observacaoFechamento,
        },
        include: eventoCaixaInclude,
      });
      const summary = resumoCaixaEvento(closed)!;
      await registrarTransacao({
        cervejariaId: user.cervejariaId,
        tipo: 'EVENTO_CAIXA_FECHADO',
        usuarioId: user.sub,
        eventoId,
        metadata: { caixaId: closed.id, divergencia: summary.divergencia },
        payload: summary,
      }, tx);
      return summary;
    }).catch((error: unknown) => {
      if ((error as { statusCode?: number }).statusCode) return { error: (error as Error).message, statusCode: (error as { statusCode: number }).statusCode };
      throw error;
    });
    if ('error' in result) return reply.status(result.statusCode).send({ error: result.error });
    emitToEvento(app.io, eventoId, { type: 'evento-caixa:updated', data: { eventoId } });
    return { caixa: result, aberto: false, formas: FORMAS_CAIXA_EVENTO };
  });

  app.get('/:eventoId/contas-pendentes', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId } = request.params as { eventoId: string };
    const evento = await prisma.evento.findFirst({ where: { id: eventoId, cervejariaId: user.cervejariaId }, select: { id: true } });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    const contas = await prisma.contaReceber.findMany({
      where: { comanda: { eventoId, origem: 'EVENTO' } },
      include: {
        cliente: { select: { id: true, nome: true, telefone: true } },
        comanda: { select: { id: true, numero: true, fechadaEm: true, itens: { select: { nome: true, quantidade: true }, orderBy: { createdAt: 'asc' } } } },
        pagamentos: { orderBy: { pagoEm: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return contas.map(resumirConta).filter((conta) => conta.saldo > 0);
  });

  app.post('/:eventoId/contas-pendentes/:contaId/pagamentos', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { eventoId, contaId } = request.params as { eventoId: string; contaId: string };
    const body = receberSchema.parse(request.body);
    const conta = await prisma.contaReceber.findFirst({
      where: { id: contaId, comanda: { eventoId, origem: 'EVENTO', evento: { cervejariaId: user.cervejariaId } } },
      include: { cliente: true, comanda: { select: { id: true, status: true } }, pagamentos: true },
    });
    if (!conta) return reply.status(404).send({ error: 'Conta pendente não encontrada' });
    if (!conta.cliente.ativo || conta.cliente.isSistema || !normalizePhone(conta.cliente.telefone)) {
      return reply.status(409).send({ error: 'Esta conta não possui cliente ativo com telefone válido' });
    }

    const totalCentavos = body.pagamentos.reduce((sum, payment) => sum + centavos(payment.valor), 0);
    const amountReceived = conta.pagamentos.reduce((sum, payment) => sum + centavos(payment.valor), 0);
    const balance = centavos(conta.valorOriginal) - amountReceived;
    if (totalCentavos <= 0 || totalCentavos > balance) {
      return reply.status(400).send({ error: `O recebimento não pode exceder o saldo de R$ ${reais(Math.max(0, balance)).toFixed(2)}` });
    }

    const result = await prisma.$transaction(async (tx) => {
      await bloquearCaixaEvento(tx, eventoId);
      await lockComandaItemsInTx(tx, conta.comandaId);
      const current = await tx.contaReceber.findUniqueOrThrow({
        where: { id: contaId }, include: { pagamentos: true, comanda: { select: { status: true } } },
      });
      const paid = current.pagamentos.reduce((sum, payment) => sum + centavos(payment.valor), 0);
      const currentBalance = centavos(current.valorOriginal) - paid;
      if (current.comanda.status !== 'FECHADA' || totalCentavos > currentBalance || currentBalance <= 0) {
        throw Object.assign(new Error('O saldo da conta mudou; atualize antes de receber'), { statusCode: 409 });
      }
      const eventNow = await tx.evento.findFirst({ where: { id: eventoId, cervejariaId: user.cervejariaId }, select: { status: true } });
      const cash = eventNow?.status === 'ABERTO' ? await obterCaixaAtualEvento(eventoId, tx) : null;
      await tx.pagamento.createMany({
        data: body.pagamentos.map((payment) => ({
          comandaId: conta.comandaId, contaReceberId: contaId, forma: payment.forma,
          valor: payment.valor, registradoPorId: user.sub,
          ...(cash ? { sessaoCaixaEventoId: cash.id } : {}),
        })),
      });
      await recalculateClienteStats(tx, conta.clienteId);
      const updated = await tx.contaReceber.findUniqueOrThrow({
        where: { id: contaId },
        include: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          comanda: { select: { id: true, numero: true, fechadaEm: true, itens: { select: { nome: true, quantidade: true }, orderBy: { createdAt: 'asc' } } } },
          pagamentos: { orderBy: { pagoEm: 'asc' } },
        },
      });
      const summary = resumirConta(updated);
      await registrarTransacao({
        cervejariaId: user.cervejariaId, tipo: 'SALE_PAYMENT_RECORDED', usuarioId: user.sub,
        eventoId, comandaId: conta.comandaId,
        metadata: { recebimentoContaPendente: true, contaReceberId: contaId, pagamentos: body.pagamentos, valorRecebido: reais(totalCentavos), saldoRestante: summary.saldo, classificacao: cash ? 'CAIXA_EVENTO' : 'FORA_DO_CAIXA' },
        payload: summary,
      }, tx);
      return { conta: summary, classificacao: cash ? 'CAIXA_EVENTO' : 'FORA_DO_CAIXA' };
    }).catch((error: unknown) => {
      if ((error as { statusCode?: number }).statusCode === 409) return { error: (error as Error).message };
      throw error;
    });
    if ('error' in result) return reply.status(409).send({ error: result.error });
    return result;
  });
}
