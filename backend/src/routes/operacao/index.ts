import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { getConfiguracaoOperacao, requireModuloOperacao } from '../../lib/operacao/modulo.js';
import { getOperationalProfile, shouldExposeEstablishmentSurface } from '../../lib/operational-profile.js';
import { produtosOperacaoRoutes } from './produtos.js';
import { comandasOperacaoRoutes } from './comandas.js';
import { vendasOperacaoRoutes } from './vendas.js';
import { cozinhaOperacaoRoutes } from './cozinha.js';
import { caixaOperacaoRoutes } from './caixa.js';
import { cardapiosOperacaoRoutes } from './cardapios.js';
import { estoqueOperacaoRoutes } from './estoque.js';
import { dashboardOperacaoRoutes } from './dashboard.js';
import {
  atualizarCapacidadesOperacao,
  updateCapacidadesOperacaoSchema,
} from '../../lib/operacao/capacidades.js';

const createPontoVendaSchema = z.object({
  nome: z.string().trim().min(1),
});

export async function operacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * Sem a guarda de modulo de proposito: o frontend consulta para decidir se
   * mostra o operacao na navegacao, inclusive quando a empresa nao o tem.
   */
  app.get('/contexto', async (request) => {
    const user = getAuthUser(request);
    const configuracao = await getConfiguracaoOperacao(user.cervejariaId);

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
    moduloScope.addHook('preHandler', requireModuloOperacao(app));

    moduloScope.patch('/config', { preHandler: [app.requireDono] }, async (request) => {
      const { cervejariaId } = request.operacao;
      const body = z
        .object({
          usaCardapio: z.boolean().optional(),
          quantidadeMesas: z.number().int().min(0).max(500).optional(),
        })
        .refine((value) => value.usaCardapio !== undefined || value.quantidadeMesas !== undefined)
        .parse(request.body);

      const updated = await prisma.configuracaoOperacao.update({
        where: { cervejariaId },
        data: body,
      });

      return { usaCardapio: updated.usaCardapio, quantidadeMesas: updated.quantidadeMesas };
    });

    moduloScope.patch('/capacidades', { preHandler: [app.requireDono] }, async (request) => {
      const user = getAuthUser(request);
      const body = updateCapacidadesOperacaoSchema.parse(request.body);

      return prisma.$transaction((tx) =>
        atualizarCapacidadesOperacao(tx, {
          cervejariaId: user.cervejariaId!,
          usuarioId: user.sub,
          papel: 'DONO',
          origem: 'DONO',
          ...body,
        }),
      );
    });

    moduloScope.get('/pontos-venda', async (request) => {
      const { cervejariaId } = request.operacao;
      return prisma.pontoVenda.findMany({
        where: { cervejariaId },
        orderBy: { createdAt: 'asc' },
      });
    });

    moduloScope.post('/pontos-venda', { preHandler: [app.requireDono] }, async (request, reply) => {
      const { cervejariaId } = request.operacao;
      const body = createPontoVendaSchema.parse(request.body);
      const pontoVenda = await prisma.pontoVenda.create({
        // Cash access is derived from the operational mode, never per unit.
        data: { cervejariaId, nome: body.nome },
      });

      return reply.status(201).send(pontoVenda);
    });

    await moduloScope.register(produtosOperacaoRoutes, { prefix: '/produtos' });
    await moduloScope.register(cardapiosOperacaoRoutes, { prefix: '/cardapios' });
    await moduloScope.register(comandasOperacaoRoutes, { prefix: '/comandas' });
    await moduloScope.register(vendasOperacaoRoutes, { prefix: '/vendas' });
    await moduloScope.register(cozinhaOperacaoRoutes, { prefix: '/cozinha' });
    await moduloScope.register(caixaOperacaoRoutes, { prefix: '/caixa' });
    await moduloScope.register(estoqueOperacaoRoutes, { prefix: '/estoque' });
    await moduloScope.register(dashboardOperacaoRoutes, { prefix: '/dashboard' });
  });
}
