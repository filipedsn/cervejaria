import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToEvento } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { cancelarComandaVazia } from '../lib/comanda-cancelar.js';
import { registrarTransacao } from '../lib/transacao-log.js';

const pagamentoSchema = z.object({
  forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
  valor: z.number().positive(),
});

const fecharComandaSchema = z.object({
  pagamentos: z.array(pagamentoSchema).min(1),
});

const comandaInclude = {
  cliente: true,
  itens: {
    include: { produto: true },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
};

export async function pagamentosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/comandas/:id/fechar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = fecharComandaSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
      include: { itens: true },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada' });

    if (comanda.itens.length === 0) {
      const cancelled = await cancelarComandaVazia({
        comandaId: id,
        cervejariaId: user.cervejariaId!,
        fechadoPorId: user.sub,
        motivo: 'empty_on_close',
      });
      if ('error' in cancelled) return reply.status(400).send({ error: cancelled.error });
      emitToEvento(app.io, cancelled.eventoId, { type: 'comanda:closed', data: cancelled.comanda });
      return cancelled.comanda;
    }

    const total = toNumber(comanda.total);
    const totalPagamentos = body.pagamentos.reduce((sum, p) => sum + p.valor, 0);

    if (Math.abs(totalPagamentos - total) > 0.01) {
      return reply.status(400).send({
        error: `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total da comanda (R$ ${total.toFixed(2)})`,
      });
    }

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const fechou = await tx.comanda.updateMany({
          where: { id, status: 'ABERTA' },
          data: { status: 'FECHADA', fechadoPorId: user.sub },
        });
        if (fechou.count === 0) {
          throw app.httpErrors.notFound('Comanda não encontrada ou já fechada');
        }

        await tx.pagamento.createMany({
          data: body.pagamentos.map((p) => ({
            comandaId: id,
            forma: p.forma,
            valor: p.valor,
          })),
        });

        await registrarTransacao(
          {
            cervejariaId: user.cervejariaId!,
            tipo: 'COMANDA_FECHADA',
            usuarioId: user.sub,
            eventoId: comanda.eventoId,
            comandaId: id,
            metadata: {
              total,
              pagamentos: body.pagamentos,
            },
          },
          tx,
        );

        return tx.comanda.findUniqueOrThrow({
          where: { id },
          include: comandaInclude,
        });
      });
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada' });
      }
      throw err;
    }

    emitToEvento(app.io, comanda.eventoId, { type: 'comanda:closed', data: updated });
    return updated;
  });
}
