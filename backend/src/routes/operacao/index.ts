import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { requireCatalogAccess, requireModuloOperacao } from '../../lib/operacao/modulo.js';
import { getOperationalProfile, shouldExposeEstablishmentSurface } from '../../lib/operational-profile.js';
import { produtosOperacaoRoutes } from './produtos.js';
import { comandasOperacaoRoutes } from './comandas.js';
import { vendasOperacaoRoutes } from './vendas.js';
import { cozinhaOperacaoRoutes } from './cozinha.js';
import { caixaOperacaoRoutes } from './caixa.js';
import { cardapiosOperacaoRoutes } from './cardapios.js';
import { estoqueOperacaoRoutes } from './estoque.js';
import { agendaOperacionalRoutes } from './agenda-operacional.js';
import { dashboardOperacaoRoutes } from './dashboard.js';
import { contasPendentesOperacaoRoutes } from './contas-pendentes.js';
import {
  atualizarCapacidadesOperacao,
  updateCapacidadesOperacaoSchema,
} from '../../lib/operacao/capacidades.js';
import { canonicalPdvQaActivationEnabled } from '../../lib/canonical-pdv-operational-config.js';
import { writeFreezeStatus } from '../../lib/write-freeze.js';
import { requireDonoAtual } from '../../lib/operacao/permissoes.js';
import { updateOperationalConfig } from '../../lib/operational-config.js';
import { createSinglePdv, SinglePdvProvisioningConflictError } from '../../lib/single-pdv-provisioning.js';

const createPontoVendaSchema = z.object({
  nome: z.string().trim().min(1),
}).strict();

export async function operacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * Sem a guarda de modulo de proposito: o frontend consulta para decidir se
   * mostra o operacao na navegacao, inclusive quando a empresa nao o tem.
   */
  app.get('/contexto', async (request) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) throw app.httpErrors.notFound('OperaÃƒÂ§ÃƒÂ£o nÃƒÂ£o disponÃƒÂ­vel');
    const [profile, pontosVenda] = await Promise.all([
      getOperationalProfile(user.cervejariaId),
      prisma.pontoVenda.findMany({
        where: { cervejariaId: user.cervejariaId, ativo: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      // An explicit cash mode exposes the setup surface even before the owner
      // creates a POS. Legacy-only data still cannot expose this surface.
      ativo: profile
        ? (profile.operationalUnits.pointsOfSale > 0 || shouldExposeEstablishmentSurface(profile.capabilities))
        : false,
      operationMode: profile?.operationMode ?? null,
      plannedOperationsEnabled: profile?.capabilities.plannedOperations ?? false,
      cashRegisterEnabled: profile?.capabilities.cashRegister ?? false,
      tapsEnabled: profile?.capabilities.taps ?? false,
      inventoryEnabled: profile?.capabilities.inventory ?? false,
      kitchenEnabled: profile?.capabilities.kitchen ?? false,
      // The context powers navigation and page guards, so it must expose the
      // same persisted capability decision as the operational settings panel.
      controlaEstoque: profile?.effectiveSettings.inventoryEnabled ?? false,
      temCozinha: profile?.effectiveSettings.kitchenEnabled ?? false,
      // CardÃ¡pios salvos sÃ£o padrÃ£o; o antigo toggle de ativaÃ§Ã£o foi removido.
      usaCardapio: true,
      kitchenItemsChargeAtLaunch: profile?.effectiveSettings.kitchenItemsChargeAtLaunch ?? false,
      allowCloseComandaWithPendingKitchenOrders: profile?.effectiveSettings.allowCloseComandaWithPendingKitchenOrders ?? false,
      quantidadeMesas: profile?.effectiveSettings.quantidadeMesas ?? 0,
      whatsappPedidoProntoEnabled: profile?.effectiveSettings.whatsappPedidoProntoEnabled ?? false,
      whatsappPedidoProntoNaCozinha: profile?.effectiveSettings.whatsappPedidoProntoNaCozinha ?? false,
      operationalSettingsSource: profile?.effectiveSettings.source ?? 'LEGACY',
      pontosVenda,
    };
  });

  app.get('/write-freeze-status', { preHandler: [requireDonoAtual(app)] }, async () => writeFreezeStatus());

  await app.register(async (catalogScope) => {
    catalogScope.addHook('preHandler', requireCatalogAccess(app));
    await catalogScope.register(produtosOperacaoRoutes, { prefix: '/produtos' });
    await catalogScope.register(cardapiosOperacaoRoutes, { prefix: '/cardapios' });
  });

  await app.register(async (moduloScope) => {
    moduloScope.addHook('preHandler', requireModuloOperacao(app));

    moduloScope.patch('/config', { preHandler: [app.requireDono] }, async (request) => {
      const { cervejariaId } = request.operacao;
      const body = z
        .object({
          quantidadeMesas: z.number().int().min(0).max(500).optional(),
        })
        .refine((value) => value.quantidadeMesas !== undefined)
        .parse(request.body);

      if (canonicalPdvQaActivationEnabled()) {
        const updated = await prisma.$transaction((tx) => updateOperationalConfig(
          tx,
          cervejariaId,
          { quantidadeMesas: body.quantidadeMesas },
          { userId: getAuthUser(request).sub, role: 'DONO' },
        ));
        return { quantidadeMesas: (updated as { quantidadeMesas?: number }).quantidadeMesas ?? 0 };
      }

      const updated = await prisma.configuracaoOperacao.update({ where: { cervejariaId }, data: body });

      return { quantidadeMesas: updated.quantidadeMesas };
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
      const canonical = canonicalPdvQaActivationEnabled();
      try {
        const created = await prisma.$transaction((tx) => canonical
          ? createSinglePdv(tx, {
              mode: 'CANONICAL', cervejariaId, nome: body.nome,
              operationalSettings: {
                tapsEnabled: false,
                inventoryEnabled: request.operacao.controlaEstoque,
                kitchenEnabled: request.operacao.temCozinha,
                kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch,
                allowCloseComandaWithPendingKitchenOrders: request.operacao.effectiveSettings.allowCloseComandaWithPendingKitchenOrders,
                whatsappPedidoProntoEnabled: request.operacao.effectiveSettings.whatsappPedidoProntoEnabled,
                whatsappPedidoProntoNaCozinha: request.operacao.effectiveSettings.whatsappPedidoProntoNaCozinha,
                quantidadeMesas: request.operacao.quantidadeMesas,
              },
            })
          : createSinglePdv(tx, { mode: 'LEGACY', cervejariaId, nome: body.nome }));
        return reply.status(201).send(created.pontoVenda);
      } catch (error) {
        if (error instanceof SinglePdvProvisioningConflictError) {
          return reply.status(409).send({ error: error.message, code: error.code });
        }
        throw error;
      }
    });

    await moduloScope.register(comandasOperacaoRoutes, { prefix: '/comandas' });
    await moduloScope.register(contasPendentesOperacaoRoutes, { prefix: '/contas-pendentes' });
    await moduloScope.register(vendasOperacaoRoutes, { prefix: '/vendas' });
    await moduloScope.register(cozinhaOperacaoRoutes, { prefix: '/cozinha' });
    await moduloScope.register(caixaOperacaoRoutes, { prefix: '/caixa' });
    await moduloScope.register(agendaOperacionalRoutes, { prefix: '/agenda' });
    await moduloScope.register(estoqueOperacaoRoutes, { prefix: '/estoque' });
    await moduloScope.register(dashboardOperacaoRoutes, { prefix: '/dashboard' });
  });
}
