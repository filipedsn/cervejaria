import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
import {
  INCLUDE_PEDIDO_COZINHA,
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

const alterarStatusSchema = z.object({
  status: z.enum(['RECEBIDO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO']),
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

    const pedidos = await prisma.pedidoOperacao.findMany({
      where: {
        cervejariaId,
        ...filtroListaPedidosCozinha(incluirEntregues, diaOperacional()),
        // Rodada so de bebida nao ocupa a cozinha.
        itensComanda: { some: { exigePreparo: true } },
      },
      include: INCLUDE_PEDIDO_COZINHA,
      // Ordem de chegada: e a regra da fila, nao a senha, que pode ser reemitida.
      orderBy: { createdAt: 'asc' },
    });

    return pedidos.map(resumoPedidoCozinha);
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

    if (status === 'CANCELADO') {
      if (user.papel !== 'DONO') {
        return reply.status(403).send({ error: 'Só o dono pode cancelar um pedido' });
      }
      // Cancelar tira o item do total; numa comanda ja paga isso reabriria a conta.
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
      atualizado = await prisma.$transaction(async (tx) =>
        kitchenService.applyStatus(tx, pedido, status),
      );
    } catch (error) {
      if (error instanceof StatusPedidoCozinhaDesatualizadoError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }

    notificarCozinha(app, cervejariaId, atualizado, false);

    if (status === 'ENTREGUE' || status === 'CANCELADO') {
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
}
