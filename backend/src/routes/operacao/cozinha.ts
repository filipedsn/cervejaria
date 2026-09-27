import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
import {
  INCLUDE_PEDIDO_COZINHA,
  INCLUDE_PEDIDO_COZINHA_COM_CLIENTE,
  TRANSICOES,
  aplicarStatusPedidoCozinha,
  filtroListaPedidosCozinha,
  notificarCozinha,
  notificarComandaOperacaoAtualizada,
  pedidoVaiParaCozinha,
  resumoPedidoCozinha,
  StatusPedidoCozinhaDesatualizadoError,
  temPedidoCozinhaPendente,
} from '../../lib/operacao/cozinha.js';
import { kitchenService } from '../../services/kitchen-service.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordTempoPreparoCozinha } from '../../lib/business-metrics.js';
import { estornarEstoqueItemPedido } from '../../lib/operacao/estoque.js';
import { recalcComandaTotalOperacao } from '../../lib/operacao/comanda-adapter.js';
import { lockComandaItemsInTx } from '../../lib/comanda-service.js';
import { confirmarCancelamentoItemComandaOperacao } from '../../lib/operacao/comanda-itens.js';
import { emitToEvento } from '../../lib/realtime.js';

const alterarStatusSchema = z.object({
  status: z.enum(['RECEBIDO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELAMENTO_PENDENTE', 'CANCELADO']),
});

export async function cozinhaOperacaoRoutes(app: FastifyInstance) {
  /** A empresa escolhe no cadastro se tem cozinha; sem ela a fila nem existe. */
  app.addHook('preHandler', async (request) => {
    if (!request.operacao.temCozinha) {
      throw app.httpErrors.notFound('Operacao sem cozinha');
    }
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.operacao;
    const { incluirEntregues } = z
      .object({ incluirEntregues: z.coerce.boolean().default(false) })
      .parse(request.query);

    const avisoConfig = await prisma.configuracaoOperacional.findUnique({
      where: { cervejariaId },
      select: { whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: true },
    });
    const incluirCliente = Boolean(
      avisoConfig?.whatsappPedidoProntoEnabled && avisoConfig.whatsappPedidoProntoNaCozinha,
    );

    const pedidos = await prisma.pedidoOperacao.findMany({
      where: {
        cervejariaId,
        ...filtroListaPedidosCozinha(incluirEntregues, diaOperacional()),
        // Rodada so de bebida nao ocupa a cozinha.
        itensComanda: { some: { exigePreparo: true, canceladoEm: null } },
      },
      include: incluirCliente ? INCLUDE_PEDIDO_COZINHA_COM_CLIENTE : INCLUDE_PEDIDO_COZINHA,
      // Ordem de chegada: e a regra da fila, nao a senha, que pode ser reemitida.
      orderBy: { createdAt: 'asc' },
    });

    return pedidos.map((pedido) => resumoPedidoCozinha(pedido, incluirCliente));
  });

  app.patch('/:id/status', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const { status } = alterarStatusSchema.parse(request.body);

    const pedido = await prisma.pedidoOperacao.findFirst({
      where: { id, cervejariaId },
      include: { ...INCLUDE_PEDIDO_COZINHA, comanda: { select: { id: true, tipo: true, identificador: true, status: true } } },
    });
    if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado' });
    if (!pedidoVaiParaCozinha(pedido.itensComanda)) {
      return reply.status(404).send({ error: 'Pedido não é da cozinha' });
    }

    if (status === 'CANCELAMENTO_PENDENTE') {
      if (user.papel !== 'DONO') {
        return reply.status(403).send({ error: 'Só o dono pode cancelar um pedido' });
      }
      // O pedido só pode ser solicitado para cancelamento enquanto a conta está aberta.
      if (pedido.comanda.status !== 'ABERTA') {
        return reply.status(409).send({ error: 'A comanda deste pedido já foi fechada' });
      }
    }

    if (!TRANSICOES[pedido.status].includes(status)) {
      return reply
        .status(409)
        .send({ error: `Não é possível ir de ${pedido.status} para ${status}` });
    }

    let atualizado;
    try {
      atualizado = await prisma.$transaction(async (tx) => {
        if (status !== 'CANCELAMENTO_PENDENTE') {
          const atualizado = await kitchenService.applyStatus(tx, pedido, status);
          await recalcComandaTotalOperacao(tx, pedido.comandaId);
          return atualizado;
        }

        await lockComandaItemsInTx(tx, pedido.comandaId);
        const pedidoAtual = await tx.pedidoOperacao.findUniqueOrThrow({
          where: { id: pedido.id },
          include: {
            itensComanda: { include: { produto: true } },
            comanda: { select: { id: true, status: true } },
          },
        });
        if (pedidoAtual.comanda.status !== 'ABERTA') {
          throw Object.assign(new Error('A comanda deste pedido já foi fechada'), { statusCode: 409 });
        }

        const cancelado = await aplicarStatusPedidoCozinha(tx, pedidoAtual, 'CANCELAMENTO_PENDENTE');

        for (const item of pedidoAtual.itensComanda) {
          if (!item.produto || !pedidoAtual.pontoVendaId) continue;
          await estornarEstoqueItemPedido(tx, {
            moduloControlaEstoque: request.operacao.controlaEstoque,
            cervejariaId,
            pontoVendaId: pedidoAtual.pontoVendaId,
            pedidoId: pedidoAtual.id,
            produtoId: item.produto.id,
            nome: item.nome ?? item.produto.nome,
            quantidade: item.quantidade,
            controlaEstoque: item.produto.controlaEstoque,
            registradoPorId: user.sub,
          });
        }

        await recalcComandaTotalOperacao(tx, pedidoAtual.comandaId);
        return cancelado;
      });
    } catch (error) {
      if (error instanceof StatusPedidoCozinhaDesatualizadoError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }

    notificarCozinha(app, cervejariaId, atualizado, false);

    if (status === 'ENTREGUE' || status === 'CANCELAMENTO_PENDENTE' || status === 'CANCELADO') {
      notificarComandaOperacaoAtualizada(app, cervejariaId, atualizado.comanda.id);
    }

    if (status === 'ENTREGUE') {
      recordTempoPreparoCozinha(Date.now() - pedido.createdAt.getTime());
    }

    const resumo = resumoPedidoCozinha(atualizado);
    void registrarTransacao({
      cervejariaId,
      tipo: 'KITCHEN_ORDER_STATUS_CHANGED',
      usuarioId: user.sub,
      comandaId: pedido.comandaId,
      entidadeId: pedido.id,
      metadata: { statusAnterior: pedido.status, status },
      payload: resumo,
    });

    return resumo;
  });

  app.patch('/:pedidoId/itens/:itemId/confirmar-cancelamento', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pedidoId, itemId } = request.params as { pedidoId: string; itemId: string };
    const resultado = await confirmarCancelamentoItemComandaOperacao({
      app,
      cervejariaId,
      pedidoId,
      itemId,
    });
    if ('error' in resultado) {
      const status = resultado.error === 'Item não encontrado' ? 404 : 409;
      return reply.status(status).send({ error: resultado.error });
    }
    if (resultado.eventoId) {
      emitToEvento(app.io, resultado.eventoId, {
        type: 'item:removed',
        data: { comandaId: resultado.comandaId },
      });
    }
    return { ok: true };
  });
}
