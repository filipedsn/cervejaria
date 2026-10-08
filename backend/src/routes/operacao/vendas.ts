import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  criarPedidos,
  diaOperacional,
  CAIXA_VENDA_TX,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
  totalEmCentavos,
  centavos,
  VendaInvalidaError,
} from '../../lib/operacao/venda.js';
import { EstoqueInvalidoError } from '../../lib/operacao/estoque.js';
import { CaixaInvalidoError } from '../../lib/operacao/caixa.js';
import { notificarPedidoNovo } from '../../lib/operacao/cozinha.js';
import { assertCaixaAberto, lockCaixaEmTx } from '../../lib/operacao/caixa.js';
import { inventoryService } from '../../services/inventory-service.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordVendaAvulsa } from '../../lib/business-metrics.js';
import {
  fecharComandaOperacaoInTx,
  INCLUDE_COMANDA_OPERACAO,
  recalcComandaTotalOperacao,
} from '../../lib/operacao/comanda-adapter.js';
import { assertPodeDarDescontoOperacao, DescontoInvalidoError } from '../../lib/operacao/desconto.js';
import { cashOccurrenceContextEnabled } from '../../lib/operacao/contexto-ocorrencia.js';
import { requirePermissao } from '../../lib/operacao/permissoes.js';

const vendaAvulsaSchema = z.object({
  pontoVendaId: z.string().min(1),
  clienteId: z.string().min(1).optional(),
  nomeCliente: z.string().trim().max(120).optional(),
  itens: z
    .array(
      z.object({
        produtoId: z.string().min(1),
        quantidade: z.number().int().positive().max(999),
        tapId: z.string().min(1).optional(),
        volumeMl: z.number().int().positive().optional(),
        paraViagem: z.boolean().default(false),
        observacao: z.string().trim().max(280).optional(),
        opcionais: z.array(z.object({ opcionalId: z.string().min(1), quantidade: z.number().int().positive().max(99).optional() })).optional(),
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
  paraViagem: z.boolean().default(false),
  desconto: z.number().min(0).optional(),
  ocorrenciaId: z.never().optional(),
});

export async function vendasOperacaoRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: [requirePermissao(app, (request) => {
    const body = request.body as { desconto?: number } | null;
    return body?.desconto && body.desconto > 0
      ? ['command.operate', 'payment.receive', 'discount.apply']
      : ['command.operate', 'payment.receive'];
  })] }, async (request, reply) => {
    try {
      const { cervejariaId, temCozinha, controlaEstoque, tapsEnabled } = request.operacao;
      const user = getAuthUser(request);
      const body = vendaAvulsaSchema.parse(request.body);
      const desconto = body.desconto ?? 0;
      const dia = diaOperacional();

      if (desconto > 0) {
        await assertPodeDarDescontoOperacao(user);
      }

      const { comanda, pedidos } = await prisma.$transaction(async (tx) => {
        const pontoVenda = await tx.pontoVenda.findFirst({
          where: { id: body.pontoVendaId, cervejariaId, ativo: true },
        });
        if (!pontoVenda) {
          throw Object.assign(new Error('Ponto de venda não encontrado'), { statusCode: 404 });
        }

        await lockCaixaEmTx(tx, cervejariaId, body.pontoVendaId, dia);
        const sessao = await assertCaixaAberto(cervejariaId, body.pontoVendaId, dia, tx);
        const cliente = body.clienteId
          ? await tx.cliente.findFirst({
              where: { id: body.clienteId, cervejariaId, ativo: true, isSistema: false },
              select: { id: true },
            })
          : null;
        if (body.clienteId && !cliente) {
          throw Object.assign(new Error('Cliente não encontrado'), { statusCode: 404 });
        }
        const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessao.id, tapsEnabled });
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
            origem: 'CAIXA',
            pontoVendaId: body.pontoVendaId,
            ...(cashOccurrenceContextEnabled() ? { ocorrenciaId: sessao.ocorrenciaId ?? null } : {}),
            tipo: 'AVULSA',
            identificador: body.nomeCliente || null,
            ...(cliente ? { clienteId: cliente.id } : {}),
            diaOperacional: dia,
            abertaPorId: user.sub,
            status: 'ABERTA',
            total: 0,
            ...(desconto > 0 ? { desconto } : {}),
          },
        });

        const pedidosCriados = await criarPedidos(tx, {
          cervejariaId,
          comandaId: criada.id,
          pontoVendaId: body.pontoVendaId,
          dia,
          criadoPorId: user.sub,
          paraViagem: body.paraViagem,
          observacao: body.observacao,
          itens,
          temCozinha,
        });

        for (const { pedido, itens: itensPedido } of pedidosCriados) await inventoryService.consumeSale(tx, {
          context: 'CAIXA', moduleEnabled: controlaEstoque, cervejariaId,
          pontoVendaId: body.pontoVendaId, pedidoId: pedido.id, registradoPorId: user.sub, items: itensPedido,
        });

        // Venda avulsa é paga e registrada imediatamente. Mesmo quando comandas
        // normais só cobram itens de cozinha após a entrega, este fluxo precisa
        // validar o pagamento pelo valor integral vendido.
        await recalcComandaTotalOperacao(tx, criada.id, { kitchenItemsChargeAtLaunch: true });

        const comandaCompleta = await tx.comanda.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA_OPERACAO,
        });

        await fecharComandaOperacaoInTx(tx, {
          comanda: comandaCompleta,
          pagamentos,
          cervejariaId,
          usuarioId: user.sub,
          fechadaEm: agora,
          sessaoCaixaId: sessao.id,
          kitchenItemsChargeAtLaunch: true,
        });

        return {
          comanda: await tx.comanda.findUniqueOrThrow({
            where: { id: criada.id },
            include: INCLUDE_COMANDA_OPERACAO,
          }),
          pedidos: pedidosCriados.map((item) => item.pedido),
        };
      }, CAIXA_VENDA_TX);

      if (temCozinha) for (const pedido of pedidos) await notificarPedidoNovo(app, cervejariaId, pedido);

      const res = resumoComanda(comanda, true);
      recordVendaAvulsa(centavos(res.total));
      void registrarTransacao({
        cervejariaId,
        tipo: 'SALE_COMPLETED',
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
