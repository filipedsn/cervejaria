import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { diaOperacional } from '../../lib/quiosque/venda.js';
import {
  INCLUDE_PEDIDO_COZINHA,
  STATUS_NA_FILA,
  TRANSICOES,
  notificarCozinha,
  pedidoVaiParaCozinha,
  resumoPedidoCozinha,
} from '../../lib/quiosque/cozinha.js';

const alterarStatusSchema = z.object({
  status: z.enum(['RECEBIDO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO']),
});

export async function cozinhaQuiosqueRoutes(app: FastifyInstance) {
  /** A empresa escolhe no cadastro se tem cozinha; sem ela a fila nem existe. */
  app.addHook('preHandler', async (request) => {
    if (!request.quiosque.temCozinha) {
      throw app.httpErrors.notFound('Quiosque sem cozinha');
    }
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const { incluirEntregues } = z
      .object({ incluirEntregues: z.coerce.boolean().default(false) })
      .parse(request.query);

    const pedidos = await prisma.pedidoQuiosque.findMany({
      where: {
        cervejariaId,
        diaOperacional: diaOperacional(),
        status: incluirEntregues ? { not: 'CANCELADO' } : { in: STATUS_NA_FILA },
        // Rodada so de bebida nao ocupa a cozinha.
        itens: { some: { exigePreparo: true } },
      },
      include: INCLUDE_PEDIDO_COZINHA,
      // Ordem de chegada: e a regra da fila, nao a senha, que pode ser reemitida.
      orderBy: { createdAt: 'asc' },
    });

    return pedidos.map(resumoPedidoCozinha);
  });

  app.patch('/:id/status', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const { status } = alterarStatusSchema.parse(request.body);

    const pedido = await prisma.pedidoQuiosque.findFirst({
      where: { id, cervejariaId },
      include: { ...INCLUDE_PEDIDO_COZINHA, comanda: { select: { id: true, tipo: true, identificador: true, status: true } } },
    });
    if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado' });
    if (!pedidoVaiParaCozinha(pedido.itens)) {
      return reply.status(404).send({ error: 'Pedido não é da cozinha' });
    }

    if (!TRANSICOES[pedido.status].includes(status)) {
      return reply
        .status(409)
        .send({ error: `Não é possível ir de ${pedido.status} para ${status}` });
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

    const atualizado = await prisma.pedidoQuiosque.update({
      where: { id: pedido.id },
      data: { status },
      include: INCLUDE_PEDIDO_COZINHA,
    });

    notificarCozinha(app, cervejariaId, atualizado, false);

    return resumoPedidoCozinha(atualizado);
  });
}
