import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  criarPedido,
  diaOperacional,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
  totalEmCentavos,
} from '../../lib/quiosque/venda.js';
import { notificarPedidoNovo } from '../../lib/quiosque/cozinha.js';

const vendaAvulsaSchema = z.object({
  pontoVendaId: z.string().min(1),
  itens: z
    .array(
      z.object({
        produtoId: z.string().min(1),
        quantidade: z.number().int().positive().max(999),
      }),
    )
    .min(1),
  pagamentos: z
    .array(
      z.object({
        forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
        valor: z.number().positive(),
        valorRecebido: z.number().positive().optional(),
      }),
    )
    .min(1),
  observacao: z.string().trim().max(280).optional(),
});

const INCLUDE_COMANDA = {
  pedidos: { include: { itens: true }, orderBy: { numero: 'asc' } },
  pagamentos: { orderBy: { pagoEm: 'asc' } },
} as const;

export async function vendasQuiosqueRoutes(app: FastifyInstance) {
  /**
   * Venda paga na hora. Vira uma comanda tipo AVULSA aberta e fechada na mesma
   * transacao: o caixa e o historico ficam num lugar so, sem um segundo fluxo
   * paralelo de venda solta.
   */
  app.post('/', async (request, reply) => {
    const { cervejariaId, temCozinha } = request.quiosque;
    const user = getAuthUser(request);
    const body = vendaAvulsaSchema.parse(request.body);
    const dia = diaOperacional();

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: body.pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const { comanda, pedido } = await prisma.$transaction(async (tx) => {
      const itens = await resolverItens(tx, cervejariaId, body.itens);
      const pagamentos = resolverPagamentos(body.pagamentos, totalEmCentavos(itens));
      const agora = new Date();

      const criada = await tx.comandaQuiosque.create({
        data: {
          cervejariaId,
          pontoVendaId: body.pontoVendaId,
          tipo: 'AVULSA',
          diaOperacional: dia,
          abertaPorId: user.sub,
          status: 'FECHADA',
          fechadaEm: agora,
          fechadaPorId: user.sub,
        },
      });

      const pedidoCriado = await criarPedido(tx, {
        cervejariaId,
        comandaId: criada.id,
        pontoVendaId: body.pontoVendaId,
        dia,
        criadoPorId: user.sub,
        observacao: body.observacao,
        itens,
      });

      await tx.pagamentoQuiosque.createMany({
        data: pagamentos.map((pagamento) => ({
          comandaId: criada.id,
          forma: pagamento.forma,
          valor: pagamento.valor,
          valorRecebido: pagamento.valorRecebido ?? null,
          troco: pagamento.troco,
          registradoPorId: user.sub,
        })),
      });

      return {
        comanda: await tx.comandaQuiosque.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA,
        }),
        pedido: pedidoCriado,
      };
    });

    if (temCozinha) await notificarPedidoNovo(app, cervejariaId, pedido);

    return reply.status(201).send(resumoComanda(comanda));
  });
}
