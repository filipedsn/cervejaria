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
import { assertCaixaAberto, lockCaixaEmTx } from '../../lib/operacao/caixa.js';
import { bloquearCaixaEvento, obterCaixaAtualEvento } from '../../lib/evento-caixa.js';
import { estornarVendaAvulsaFechada } from '../../lib/operacao/estorno-venda-avulsa.js';

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

    const avisoConfig = request.operacao.effectiveSettings;
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
      include: { ...INCLUDE_PEDIDO_COZINHA, comanda: { select: { id: true, tipo: true, identificador: true, status: true, origem: true, eventoId: true, pontoVendaId: true, diaOperacional: true } } },
    });
    if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado' });
    if (!pedidoVaiParaCozinha(pedido.itensComanda)) {
      return reply.status(404).send({ error: 'Pedido não é da cozinha' });
    }

    if (status === 'CANCELAMENTO_PENDENTE') {
      if (user.papel !== 'DONO') {
        return reply.status(403).send({ error: 'Só o dono pode cancelar um pedido' });
      }
      if (pedido.comanda.status !== 'ABERTA' && !(pedido.comanda.tipo === 'AVULSA' && pedido.comanda.status === 'FECHADA')) {
        return reply.status(409).send({ error: 'Esta comanda não pode ser cancelada pela cozinha' });
      }
    }

    if (!TRANSICOES[pedido.status].includes(status)) {
      return reply
        .status(409)
        .send({ error: `Não é possível ir de ${pedido.status} para ${status}` });
    }

    let atualizado;
    let valorEstornado = 0;
    try {
      atualizado = await prisma.$transaction(async (tx) => {
        if (status !== 'CANCELAMENTO_PENDENTE') {
          if (status === 'CANCELADO' && pedido.status === 'CANCELAMENTO_PENDENTE') {
            await lockComandaItemsInTx(tx, pedido.comandaId);
            await tx.itemComanda.updateMany({
              where: { pedidoCozinhaId: pedido.id, canceladoEm: null },
              data: { cancelamentoPendenteEm: null, canceladoEm: new Date() },
            });
          }
          const atualizado = await kitchenService.applyStatus(tx, pedido, status);
          await recalcComandaTotalOperacao(tx, pedido.comandaId);
          return atualizado;
        }

        let sessaoCaixaId: string | undefined;
        let sessaoCaixaEventoId: string | undefined;
        if (pedido.comanda.tipo === 'AVULSA' && pedido.comanda.status === 'FECHADA') {
          if (pedido.comanda.origem === 'CAIXA') {
            if (!pedido.comanda.pontoVendaId || !pedido.comanda.diaOperacional) {
              throw Object.assign(new Error('Venda sem ponto de venda ou dia operacional'), { statusCode: 409 });
            }
            const diaAtual = diaOperacional();
            await lockCaixaEmTx(tx, cervejariaId, pedido.comanda.pontoVendaId, diaAtual);
            const caixa = await assertCaixaAberto(cervejariaId, pedido.comanda.pontoVendaId, diaAtual, tx);
            sessaoCaixaId = caixa.id;
          } else {
            if (!pedido.comanda.eventoId) throw Object.assign(new Error('Venda sem evento'), { statusCode: 409 });
            await bloquearCaixaEvento(tx, pedido.comanda.eventoId);
            const caixa = await obterCaixaAtualEvento(pedido.comanda.eventoId, tx);
            if (!caixa) throw Object.assign(new Error('Abra o caixa do evento para estornar esta venda'), { statusCode: 409 });
            sessaoCaixaEventoId = caixa.id;
          }
        }

        await lockComandaItemsInTx(tx, pedido.comandaId);
        const pedidoAtual = await tx.pedidoOperacao.findUniqueOrThrow({
          where: { id: pedido.id },
          include: {
            itensComanda: { include: { produto: true, opcionais: { include: { opcional: true } } } },
            comanda: { select: { id: true, status: true, tipo: true } },
          },
        });
        if (!TRANSICOES[pedidoAtual.status].includes(status)) {
          throw new StatusPedidoCozinhaDesatualizadoError();
        }
        if (pedidoAtual.comanda.status !== 'ABERTA' && !(pedidoAtual.comanda.status === 'FECHADA' && pedidoAtual.comanda.tipo === 'AVULSA')) {
          throw Object.assign(new Error('Esta comanda não pode ser cancelada pela cozinha'), { statusCode: 409 });
        }

        const solicitacaoEm = new Date();
        await tx.itemComanda.updateMany({
          where: {
            pedidoCozinhaId: pedidoAtual.id,
            exigePreparo: true,
            cancelamentoPendenteEm: null,
            canceladoEm: null,
          },
          data: { cancelamentoPendenteEm: solicitacaoEm },
        });
        const cancelado = await aplicarStatusPedidoCozinha(tx, pedidoAtual, 'CANCELAMENTO_PENDENTE', solicitacaoEm);

        for (const item of pedidoAtual.itensComanda) {
          if (!item.exigePreparo || item.cancelamentoPendenteEm || item.canceladoEm) continue;
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
            tapId: item.tapId,
            volumeMl: item.volumeMl,
            registradoPorId: user.sub,
            opcionais: item.opcionais.map((opcional) => ({ produtoEstoqueId: opcional.opcional?.produtoEstoqueId ?? null, quantidade: opcional.quantidade })),
          });
        }

        if (pedidoAtual.comanda.status === 'FECHADA') {
          if (!sessaoCaixaId && !sessaoCaixaEventoId) {
            throw new StatusPedidoCozinhaDesatualizadoError();
          }
          const estorno = await estornarVendaAvulsaFechada(tx, {
            comandaId: pedidoAtual.comandaId,
            registradoPorId: user.sub,
            sessaoCaixaId,
            sessaoCaixaEventoId,
          });
          valorEstornado = estorno.valorEstornado;
        } else {
          await recalcComandaTotalOperacao(tx, pedidoAtual.comandaId);
        }
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
      if (pedido.comanda.eventoId) {
        emitToEvento(app.io, pedido.comanda.eventoId, {
          type: 'comanda:updated',
          data: { comandaId: pedido.comandaId },
        });
      }
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
      metadata: { statusAnterior: pedido.status, status, ...(valorEstornado > 0 ? { valorEstornado, estornoNoCaixa: true } : {}) },
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
