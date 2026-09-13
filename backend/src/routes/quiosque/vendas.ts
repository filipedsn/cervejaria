import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  criarPedido,
  diaOperacional,
  QUIOSQUE_VENDA_TX,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
  totalEmCentavos,
  centavos,
  VendaInvalidaError,
} from '../../lib/quiosque/venda.js';
import { EstoqueInvalidoError } from '../../lib/quiosque/estoque.js';
import { CaixaInvalidoError } from '../../lib/quiosque/caixa.js';
import { notificarPedidoNovo } from '../../lib/quiosque/cozinha.js';
import { assertCaixaAberto, lockCaixaEmTx } from '../../lib/quiosque/caixa.js';
import { baixarEstoqueDoPedido } from '../../lib/quiosque/estoque.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordVendaAvulsa } from '../../lib/business-metrics.js';
import {
  fecharComandaQuiosqueInTx,
  INCLUDE_COMANDA_QUIOSQUE,
  recalcComandaTotalQuiosque,
} from '../../lib/quiosque/comanda-adapter.js';
import { assertPodeDarDescontoQuiosque, DescontoInvalidoError } from '../../lib/quiosque/desconto.js';

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
  pagamentos: z.array(
    z.object({
      forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
      valor: z.number().positive(),
      valorRecebido: z.number().positive().optional(),
    }),
  ),
  observacao: z.string().trim().max(280).optional(),
  desconto: z.number().min(0).optional(),
});

export async function vendasQuiosqueRoutes(app: FastifyInstance) {
  app.post('/', async (request, reply) => {
    try {
      const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
      const user = getAuthUser(request);
      const body = vendaAvulsaSchema.parse(request.body);
      const desconto = body.desconto ?? 0;
      const dia = diaOperacional();

      if (desconto > 0) {
        await assertPodeDarDescontoQuiosque(user);
      }

      const { comanda, pedido } = await prisma.$transaction(async (tx) => {
        const pontoVenda = await tx.pontoVenda.findFirst({
          where: { id: body.pontoVendaId, cervejariaId, ativo: true },
        });
        if (!pontoVenda) {
          throw Object.assign(new Error('Ponto de venda não encontrado'), { statusCode: 404 });
        }

        await lockCaixaEmTx(tx, cervejariaId, body.pontoVendaId, dia);
        const sessao = await assertCaixaAberto(cervejariaId, body.pontoVendaId, dia, tx);
        const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessao.id });
        const subtotalEmCents = totalEmCentavos(itens);
        const descontoEmCents = centavos(desconto);

        if (descontoEmCents > subtotalEmCents) {
          throw new DescontoInvalidoError('O desconto não pode ser maior que o subtotal da comanda');
        }

        const devidoEmCents = Math.max(0, subtotalEmCents - descontoEmCents);
        const pagamentos = resolverPagamentos(body.pagamentos, devidoEmCents);
        const agora = new Date();

        const criada = await tx.comanda.create({
          data: {
            origem: 'QUIOSQUE',
            pontoVendaId: body.pontoVendaId,
            tipo: 'AVULSA',
            diaOperacional: dia,
            abertaPorId: user.sub,
            status: 'ABERTA',
            total: 0,
            ...(desconto > 0 ? { desconto } : {}),
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
          temCozinha,
        });

        await baixarEstoqueDoPedido(tx, {
          moduloControlaEstoque: controlaEstoque,
          cervejariaId,
          pontoVendaId: body.pontoVendaId,
          pedidoId: pedidoCriado.id,
          registradoPorId: user.sub,
          itens,
        });

        await recalcComandaTotalQuiosque(tx, criada.id);

        const comandaCompleta = await tx.comanda.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA_QUIOSQUE,
        });

        await fecharComandaQuiosqueInTx(tx, {
          comanda: comandaCompleta,
          pagamentos,
          cervejariaId,
          usuarioId: user.sub,
          fechadaEm: agora,
        });

        return {
          comanda: await tx.comanda.findUniqueOrThrow({
            where: { id: criada.id },
            include: INCLUDE_COMANDA_QUIOSQUE,
          }),
          pedido: pedidoCriado,
        };
      }, QUIOSQUE_VENDA_TX);

      if (temCozinha) await notificarPedidoNovo(app, cervejariaId, pedido);

      const res = resumoComanda(comanda);
      recordVendaAvulsa(centavos(res.total));
      void registrarTransacao({
        cervejariaId,
        tipo: 'QUIOSQUE_VENDA_AVULSA',
        usuarioId: user.sub,
        comandaId: comanda.id,
        metadata: {
          total: res.total,
          ...(res.desconto > 0 ? { desconto: res.desconto } : {}),
        },
        payload: res,
      });

      return reply.status(201).send(res);
    } catch (err) {
      if (
        err instanceof VendaInvalidaError ||
        err instanceof EstoqueInvalidoError ||
        err instanceof CaixaInvalidoError ||
        err instanceof DescontoInvalidoError
      ) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        return reply.status(statusCode).send({ error: (err as Error).message });
      }
      throw err;
    }
  });
}
