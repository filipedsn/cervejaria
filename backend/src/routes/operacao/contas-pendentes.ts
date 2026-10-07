import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { normalizePhone } from '../../lib/phone.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { lockComandaItemsInTx } from '../../lib/comanda-service.js';
import { assertCashRegisterUnitEnabled, lockCaixaEmTx } from '../../lib/operacao/caixa.js';
import { centavos, diaOperacional, reais } from '../../lib/operacao/venda.js';
import { recalculateClienteStats } from '../../lib/cliente-stats.js';
import { zonedTimeToUtc } from '../../lib/event-datetime.js';
import { requirePermissao } from '../../lib/operacao/permissoes.js';

const recebimentoSchema = z.object({
  pontoVendaId: z.string().min(1),
  pagamentos: z.array(z.object({
    forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
    valor: z.number().positive(),
  })).min(1).max(3),
});

function resumoConta(conta: {
  id: string;
  valorOriginal: unknown;
  createdAt: Date;
  cliente: { id: string; nome: string; telefone: string | null };
  comanda: {
    id: string;
    numero: number | null;
    identificador: string | null;
    tipo: string;
    fechadaEm: Date | null;
    pontoVenda: { id: string; nome: string } | null;
    itens: Array<{ nome: string | null; quantidade: number }>;
  };
  pagamentos: Array<{ id: string; forma: string; valor: unknown; pagoEm: Date }>;
}) {
  const valorOriginal = Number(conta.valorOriginal);
  const recebido = conta.pagamentos.reduce((soma, pagamento) => soma + Number(pagamento.valor), 0);
  return {
    id: conta.id,
    cliente: conta.cliente,
    comanda: conta.comanda,
    valorOriginal,
    recebido,
    saldo: Math.max(0, Math.round((valorOriginal - recebido) * 100) / 100),
    createdAt: conta.createdAt,
    pagamentos: conta.pagamentos,
  };
}

export async function contasPendentesOperacaoRoutes(app: FastifyInstance) {
  app.get('/resumo', async (request) => {
    const { cervejariaId } = request.operacao;
    const dia = diaOperacional();
    const inicio = zonedTimeToUtc(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 0, 0);
    const amanha = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate() + 1));
    const fim = zonedTimeToUtc(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), 0, 0);
    const recebimentos = await prisma.pagamento.aggregate({
      where: {
        contaReceberId: { not: null },
        pagoEm: { gte: inicio, lt: fim },
        contaReceber: { cliente: { cervejariaId }, comanda: { origem: 'CAIXA' } },
      },
      _sum: { valor: true },
    });

    return { recebimentosHoje: Number(recebimentos._sum.valor ?? 0) };
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.operacao;
    const contas = await prisma.contaReceber.findMany({
      where: { cliente: { cervejariaId }, comanda: { origem: 'CAIXA' } },
      include: {
        cliente: { select: { id: true, nome: true, telefone: true } },
        comanda: {
          select: {
            id: true,
            numero: true,
            identificador: true,
            tipo: true,
            fechadaEm: true,
            pontoVenda: { select: { id: true, nome: true } },
            itens: { select: { nome: true, quantidade: true, observacao: true }, orderBy: { createdAt: 'asc' } },
          },
        },
        pagamentos: { orderBy: { pagoEm: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return contas.map(resumoConta).filter((conta) => conta.saldo > 0);
  });

  app.post('/:id/pagamentos', { preHandler: [requirePermissao(app, 'debt.receive')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = recebimentoSchema.parse(request.body);
    const conta = await prisma.contaReceber.findFirst({
      where: { id, cliente: { cervejariaId }, comanda: { origem: 'CAIXA' } },
      include: { cliente: true, comanda: { select: { id: true, pontoVendaId: true, status: true } }, pagamentos: true },
    });
    if (!conta) return reply.status(404).send({ error: 'Conta pendente nÃ£o encontrada' });
    if (!conta.cliente.ativo || conta.cliente.isSistema || !normalizePhone(conta.cliente.telefone)) {
      return reply.status(409).send({ error: 'Esta conta nÃ£o possui cliente ativo com telefone vÃ¡lido' });
    }
    if (conta.comanda.status !== 'FECHADA') {
      return reply.status(409).send({ error: 'A comanda vinculada nÃ£o estÃ¡ encerrada' });
    }

    const totalCentavos = body.pagamentos.reduce((sum, pagamento) => sum + centavos(pagamento.valor), 0);
    const jaRecebido = conta.pagamentos.reduce((sum, pagamento) => sum + centavos(pagamento.valor), 0);
    const saldoCentavos = centavos(conta.valorOriginal) - jaRecebido;
    if (totalCentavos <= 0 || totalCentavos > saldoCentavos) {
      return reply.status(400).send({ error: `O recebimento deve ser maior que zero e nÃ£o pode exceder o saldo de ${reais(Math.max(0, saldoCentavos)).toFixed(2)}` });
    }

    const pagamentos = await prisma.$transaction(async (tx) => {
      const dia = diaOperacional();
      await assertCashRegisterUnitEnabled(cervejariaId, body.pontoVendaId, tx);
      await lockCaixaEmTx(tx, cervejariaId, body.pontoVendaId, dia);
      const sessao = await tx.sessaoCaixaOperacao.findFirst({
        where: { cervejariaId, pontoVendaId: body.pontoVendaId, diaOperacional: dia, status: 'ABERTO' },
        select: { id: true },
        orderBy: { abertoEm: 'desc' },
      });
      await lockComandaItemsInTx(tx, conta.comandaId);
      const atual = await tx.contaReceber.findUniqueOrThrow({
        where: { id },
        include: { pagamentos: true, cliente: true, comanda: { select: { status: true } } },
      });
      const pagoAtual = atual.pagamentos.reduce((sum, pagamento) => sum + centavos(pagamento.valor), 0);
      const saldoAtual = centavos(atual.valorOriginal) - pagoAtual;
      if (atual.comanda.status !== 'FECHADA' || saldoAtual <= 0) {
        throw Object.assign(new Error('Esta conta jÃ¡ foi quitada ou nÃ£o estÃ¡ disponÃ­vel'), { statusCode: 409 });
      }
      if (totalCentavos > saldoAtual) {
        throw Object.assign(new Error('O saldo mudou. Atualize a conta antes de registrar este recebimento.'), { statusCode: 409 });
      }

      await tx.pagamento.createMany({
        data: body.pagamentos.map((pagamento) => ({
          comandaId: conta.comandaId,
          contaReceberId: id,
          sessaoCaixaId: sessao?.id ?? null,
          forma: pagamento.forma,
          valor: pagamento.valor,
          registradoPorId: user.sub,
        })),
      });
      await recalculateClienteStats(tx, conta.clienteId);
      const contaAtualizada = await tx.contaReceber.findUniqueOrThrow({
        where: { id },
        include: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          comanda: {
            select: {
              id: true,
              numero: true,
              identificador: true,
              tipo: true,
              fechadaEm: true,
              pontoVenda: { select: { id: true, nome: true } },
              itens: { select: { nome: true, quantidade: true, observacao: true }, orderBy: { createdAt: 'asc' } },
            },
          },
          pagamentos: { orderBy: { pagoEm: 'asc' } },
        },
      });
      return { conta: contaAtualizada, classificacao: sessao ? 'CAIXA' as const : 'PENDURADO' as const };
    });

    const resumo = resumoConta(pagamentos.conta);
    void registrarTransacao({
      cervejariaId,
      tipo: 'SALE_PAYMENT_RECORDED',
      usuarioId: user.sub,
      comandaId: conta.comandaId,
      entidadeTipo: 'ContaReceber',
      entidadeId: id,
      metadata: {
        recebimentoContaPendente: true,
        contaReceberId: id,
        pagamentos: body.pagamentos,
        valorRecebido: reais(totalCentavos),
        saldoRestante: resumo.saldo,
        pontoVendaId: body.pontoVendaId,
        classificacao: pagamentos.classificacao,
      },
      payload: resumo,
    });

    return resumo;
  });
}
