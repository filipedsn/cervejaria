import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { getConfiguracaoQuiosque, requireModuloQuiosque } from '../../lib/quiosque/modulo.js';
import { produtosQuiosqueRoutes } from './produtos.js';

const createPontoVendaSchema = z.object({
  nome: z.string().trim().min(1),
});

export async function quiosqueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * Sem a guarda de modulo de proposito: o frontend consulta para decidir se
   * mostra o quiosque na navegacao, inclusive quando a empresa nao o tem.
   */
  app.get('/contexto', async (request) => {
    const user = getAuthUser(request);
    const configuracao = await getConfiguracaoQuiosque(user.cervejariaId);

    if (!configuracao) return { ativo: false as const };

    const pontosVenda = await prisma.pontoVenda.findMany({
      where: { cervejariaId: configuracao.cervejariaId, ativo: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ativo: true as const,
      controlaEstoque: configuracao.controlaEstoque,
      temCozinha: configuracao.temCozinha,
      exclusivo: configuracao.exclusivo,
      pontosVenda,
    };
  });

  await app.register(async (moduloScope) => {
    moduloScope.addHook('preHandler', requireModuloQuiosque(app));

    moduloScope.get('/pontos-venda', async (request) => {
      const { cervejariaId } = request.quiosque;
      return prisma.pontoVenda.findMany({
        where: { cervejariaId },
        orderBy: { createdAt: 'asc' },
      });
    });

    moduloScope.post('/pontos-venda', { preHandler: [app.requireDono] }, async (request, reply) => {
      const { cervejariaId } = request.quiosque;
      const body = createPontoVendaSchema.parse(request.body);

      const pontoVenda = await prisma.pontoVenda.create({
        data: { cervejariaId, nome: body.nome },
      });

      return reply.status(201).send(pontoVenda);
    });

    await moduloScope.register(produtosQuiosqueRoutes, { prefix: '/produtos' });
  });
}
