import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { toNumber } from '../lib/utils.js';
import { isBebidaChope } from '../lib/produto-utils.js';

export async function rankingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const comandas = await prisma.comanda.findMany({
      where: { eventoId },
      include: {
        cliente: true,
        itens: { include: { produto: true } },
      },
    });

    const rankingMap = new Map<
      string,
      { clienteId: string; nome: string; telefone: string | null; totalMl: number; totalValor: number; pedidos: number }
    >();

    for (const comanda of comandas) {
      const key = comanda.clienteId;
      const current = rankingMap.get(key) ?? {
        clienteId: comanda.clienteId,
        nome: comanda.cliente.nome,
        telefone: comanda.cliente.telefone,
        totalMl: 0,
        totalValor: 0,
        pedidos: 0,
      };

      for (const item of comanda.itens) {
        if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
          current.totalMl += item.volumeMl * item.quantidade;
          current.pedidos += item.quantidade;
          current.totalValor += toNumber(item.precoUnit) * item.quantidade;
        }
      }

      rankingMap.set(key, current);
    }

    const ranking = Array.from(rankingMap.values())
      .filter((r) => r.totalMl > 0)
      .sort((a, b) => b.totalMl - a.totalMl || a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((r, index) => ({ posicao: index + 1, ...r }));

    return {
      evento: {
        id: evento.id,
        nome: evento.nome,
        local: evento.local,
        data: evento.data,
        horaInicio: evento.horaInicio,
        horaFim: evento.horaFim,
      },
      ranking,
    };
  });
}
