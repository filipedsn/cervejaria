import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { getConfiguracaoQuiosque, requireModuloQuiosque } from '../../lib/quiosque/modulo.js';
import { getOperationalProfile, shouldExposeEstablishmentSurface } from '../../lib/operational-profile.js';
import { produtosQuiosqueRoutes } from './produtos.js';
import { comandasQuiosqueRoutes } from './comandas.js';
import { vendasQuiosqueRoutes } from './vendas.js';
import { cozinhaQuiosqueRoutes } from './cozinha.js';
import { caixaQuiosqueRoutes } from './caixa.js';
import { cardapiosQuiosqueRoutes } from './cardapios.js';
import { estoqueQuiosqueRoutes } from './estoque.js';
import { dashboardQuiosqueRoutes } from './dashboard.js';
import {
  atualizarCapacidadesQuiosque,
  updateCapacidadesQuiosqueSchema,
} from '../../lib/quiosque/capacidades.js';

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

    const [profile, pontosVenda] = await Promise.all([
      getOperationalProfile(user.cervejariaId!),
      prisma.pontoVenda.findMany({
      where: { cervejariaId: user.cervejariaId!, ativo: true },
      orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      // CAIXA remains a first-class workflow even before a POS is provisioned,
      // so the operator can reach the page that explains/provisions the next step.
      ativo: profile ? profile.operationMode === 'CAIXA' || shouldExposeEstablishmentSurface(profile.capabilities) : false,
      operationMode: profile?.operationMode ?? null,
      plannedOperationsEnabled: profile?.capabilities.plannedOperations ?? false,
      cashRegisterEnabled: profile?.capabilities.cashRegister ?? false,
      tapsEnabled: profile?.capabilities.taps ?? false,
      inventoryEnabled: profile?.capabilities.inventory ?? false,
      kitchenEnabled: profile?.capabilities.kitchen ?? false,
      // The context powers navigation and page guards, so it must expose the
      // same persisted capability decision as the operational settings panel.
      controlaEstoque: profile?.capabilities.inventory ?? configuracao?.controlaEstoque ?? false,
      temCozinha: profile?.capabilities.kitchen ?? configuracao?.temCozinha ?? false,
      usaCardapio: configuracao?.usaCardapio ?? false,
      quantidadeMesas: configuracao?.quantidadeMesas ?? 0,
      pontosVenda,
    };
  });

  await app.register(async (moduloScope) => {
    moduloScope.addHook('preHandler', requireModuloQuiosque(app));

    moduloScope.patch('/config', { preHandler: [app.requireDono] }, async (request) => {
      const { cervejariaId } = request.quiosque;
      const body = z
        .object({
          usaCardapio: z.boolean().optional(),
          quantidadeMesas: z.number().int().min(0).max(500).optional(),
        })
        .refine((value) => value.usaCardapio !== undefined || value.quantidadeMesas !== undefined)
        .parse(request.body);

      const updated = await prisma.configuracaoQuiosque.update({
        where: { cervejariaId },
        data: body,
      });

      return { usaCardapio: updated.usaCardapio, quantidadeMesas: updated.quantidadeMesas };
    });

    moduloScope.patch('/capacidades', { preHandler: [app.requireDono] }, async (request) => {
      const user = getAuthUser(request);
      const body = updateCapacidadesQuiosqueSchema.parse(request.body);

      return prisma.$transaction((tx) =>
        atualizarCapacidadesQuiosque(tx, {
          cervejariaId: user.cervejariaId!,
          usuarioId: user.sub,
          papel: 'DONO',
          origem: 'DONO',
          ...body,
        }),
      );
    });

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
      const profile = await getOperationalProfile(cervejariaId);

      const pontoVenda = await prisma.pontoVenda.create({
        data: { cervejariaId, nome: body.nome, usaCaixa: profile?.capabilities.cashRegister ?? false },
      });

      return reply.status(201).send(pontoVenda);
    });

    await moduloScope.register(produtosQuiosqueRoutes, { prefix: '/produtos' });
    await moduloScope.register(cardapiosQuiosqueRoutes, { prefix: '/cardapios' });
    await moduloScope.register(comandasQuiosqueRoutes, { prefix: '/comandas' });
    await moduloScope.register(vendasQuiosqueRoutes, { prefix: '/vendas' });
    await moduloScope.register(cozinhaQuiosqueRoutes, { prefix: '/cozinha' });
    await moduloScope.register(caixaQuiosqueRoutes, { prefix: '/caixa' });
    await moduloScope.register(estoqueQuiosqueRoutes, { prefix: '/estoque' });
    await moduloScope.register(dashboardQuiosqueRoutes, { prefix: '/dashboard' });
  });
}
