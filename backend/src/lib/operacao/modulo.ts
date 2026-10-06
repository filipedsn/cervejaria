import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { createSinglePdv } from '../single-pdv-provisioning.js';
import {
  getOperationalProfile,
  type OperationalProfile,
} from '../operational-profile.js';

export interface ContextoOperacao {
  cervejariaId: string;
  controlaEstoque: boolean;
  temCozinha: boolean;
  tapsEnabled: boolean;
  quantidadeMesas: number;
  effectiveSettings: OperationalProfile['effectiveSettings'];
}

declare module 'fastify' {
  interface FastifyRequest {
    operacao: ContextoOperacao;
  }
}

export async function getConfiguracaoOperacao(cervejariaId: string | null) {
  if (!cervejariaId) return null;
  return prisma.configuracaoOperacao.findFirst({
    where: { cervejariaId, ativo: true },
  });
}

/**
 * The Operacao route namespace currently serves direct sales. Keep the route
 * contract, but make its availability a capability decision rather than a
 * legacy configuration or company-mode decision.
 */
export function hasDirectSalesAccess(profile: OperationalProfile | null): boolean {
  return profile?.capabilities.cashMode === true;
}

/** Kitchen is tenant-wide; product-level preparation remains a separate rule. */
export function hasKitchenAccess(profile: OperationalProfile | null): boolean {
  return profile?.capabilities.kitchen === true;
}

/** Inventory is tenant-wide; product stock participation remains separate. */
export function hasInventoryAccess(profile: OperationalProfile | null): boolean {
  return profile?.capabilities.inventory === true;
}

export function hasComplementaryAccess(profile: OperationalProfile | null): boolean {
  return profile?.capabilities.cashMode === true || profile?.capabilities.inventory === true || profile?.capabilities.kitchen === true;
}

/** Tenant-owned catalog data is available independently of its operating mode. */
export function hasCatalogAccess(profile: OperationalProfile | null): profile is OperationalProfile {
  return profile !== null;
}

function attachOperacaoContext(
  request: FastifyRequest,
  cervejariaId: string,
  profile: OperationalProfile,
) {
  request.operacao = {
    cervejariaId,
    controlaEstoque: hasInventoryAccess(profile),
    temCozinha: hasKitchenAccess(profile),
    tapsEnabled: profile.capabilities.taps,
    quantidadeMesas: profile.effectiveSettings.quantidadeMesas,
    effectiveSettings: profile.effectiveSettings,
  };
}

/** Product and saved-menu APIs are tenant data and do not require CAIXA/EVENTO access. */
export function requireCatalogAccess(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    const user = getAuthUser(request);
    const cervejariaId = user.cervejariaId;
    const profile = cervejariaId ? await getOperationalProfile(cervejariaId) : null;

    if (!cervejariaId || !hasCatalogAccess(profile)) {
      throw app.httpErrors.notFound('Catálogo não disponível');
    }

    attachOperacaoContext(request, cervejariaId, profile);
  };
}

/**
 * Ativa o modulo para uma empresa e cria o primeiro ponto de venda.
 * Recebe o client da transacao para nascer junto com o cadastro da empresa.
 */
export async function ativarModuloOperacao(
  tx: any,
  params: {
    cervejariaId: string;
    controlaEstoque: boolean;
    temCozinha: boolean;
    exclusivo: boolean;
    nomePontoVenda?: string;
  },
) {
  const configuracao = await tx.configuracaoOperacao.create({
    data: {
      cervejariaId: params.cervejariaId,
      controlaEstoque: params.controlaEstoque,
      temCozinha: params.temCozinha,
      exclusivo: params.exclusivo,
    },
  });

  const { pontoVenda } = await createSinglePdv(tx, {
    cervejariaId: params.cervejariaId,
    nome: params.nomePontoVenda?.trim() || 'Principal',
    operationalSettings: {
      tapsEnabled: false,
      inventoryEnabled: params.controlaEstoque,
      kitchenEnabled: params.temCozinha,
      kitchenItemsChargeAtLaunch: false,
      allowCloseComandaWithPendingKitchenOrders: false,
      whatsappPedidoProntoEnabled: false,
      whatsappPedidoProntoNaCozinha: false,
      quantidadeMesas: null,
    },
  });

  return { configuracao, pontoVenda };
}

/**
 * Bloqueia as rotas do modulo para quem nao tem o operacao ativo. Responde 404
 * em vez de 403 para que o modulo seja invisivel a uma empresa so de cervejaria.
 */
export function requireModuloOperacao(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    const user = getAuthUser(request);
    const profile = user.cervejariaId
      ? await getOperationalProfile(user.cervejariaId)
      : null;

    if (!profile || !hasComplementaryAccess(profile)) {
      throw app.httpErrors.notFound('Modulo Operacao nÃ£o disponÃ­vel');
    }
attachOperacaoContext(request, user.cervejariaId!, profile);
  };
}
