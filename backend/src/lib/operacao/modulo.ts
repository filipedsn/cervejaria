import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  getOperationalProfile,
  type OperationalProfile,
} from '../operational-profile.js';

export interface ContextoOperacao {
  cervejariaId: string;
  controlaEstoque: boolean;
  temCozinha: boolean;
  usaCardapio: boolean;
  quantidadeMesas: number;
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

/**
 * Ativa o modulo para uma empresa e cria o primeiro ponto de venda.
 * Recebe o client da transacao para nascer junto com o cadastro da empresa.
 */
export async function ativarModuloOperacao(
  tx: Pick<typeof prisma, 'configuracaoOperacao' | 'pontoVenda'>,
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

  const pontoVenda = await tx.pontoVenda.create({
    data: {
      cervejariaId: params.cervejariaId,
      nome: params.nomePontoVenda?.trim() || 'Principal',
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

    if (!hasComplementaryAccess(profile)) {
      throw app.httpErrors.notFound('Modulo Operacao nÃ£o disponÃ­vel');
    }

    // Legacy configuration remains the compatibility source for route context
    // fields that have not yet been migrated in later F3 slices. It is no
    // longer the access decision for this module.
    const configuracao = await getConfiguracaoOperacao(user.cervejariaId);

    if (!configuracao && !hasComplementaryAccess(profile)) {
      throw app.httpErrors.notFound('Modulo Operacao não disponível');
    }

    request.operacao = {
      cervejariaId: user.cervejariaId!,
      controlaEstoque: hasInventoryAccess(profile),
      temCozinha: hasKitchenAccess(profile),
      usaCardapio: configuracao?.usaCardapio ?? false,
      quantidadeMesas: configuracao?.quantidadeMesas ?? 0,
    };
  };
}
