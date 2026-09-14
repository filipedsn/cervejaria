import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  getOperationalProfile,
  type OperationalProfile,
} from '../operational-profile.js';

export interface ContextoQuiosque {
  cervejariaId: string;
  controlaEstoque: boolean;
  temCozinha: boolean;
  exclusivo: boolean;
  usaCardapio: boolean;
  quantidadeMesas: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    quiosque: ContextoQuiosque;
  }
}

export async function getConfiguracaoQuiosque(cervejariaId: string | null) {
  if (!cervejariaId) return null;
  return prisma.configuracaoQuiosque.findFirst({
    where: { cervejariaId, ativo: true },
  });
}

/**
 * The Quiosque route namespace currently serves direct sales. Keep the route
 * contract, but make its availability a capability decision rather than a
 * legacy configuration or company-mode decision.
 */
export function hasDirectSalesAccess(profile: OperationalProfile | null): boolean {
  return profile?.capabilities.directSales === true;
}

/**
 * Ativa o modulo para uma empresa e cria o primeiro ponto de venda.
 * Recebe o client da transacao para nascer junto com o cadastro da empresa.
 */
export async function ativarModuloQuiosque(
  tx: Pick<typeof prisma, 'configuracaoQuiosque' | 'pontoVenda'>,
  params: {
    cervejariaId: string;
    controlaEstoque: boolean;
    temCozinha: boolean;
    exclusivo: boolean;
    nomePontoVenda?: string;
  },
) {
  const configuracao = await tx.configuracaoQuiosque.create({
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
 * Bloqueia as rotas do modulo para quem nao tem o quiosque ativo. Responde 404
 * em vez de 403 para que o modulo seja invisivel a uma empresa so de cervejaria.
 */
export function requireModuloQuiosque(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    const user = getAuthUser(request);
    const profile = user.cervejariaId
      ? await getOperationalProfile(user.cervejariaId)
      : null;

    if (!hasDirectSalesAccess(profile)) {
      throw app.httpErrors.notFound('Modulo Quiosque nÃ£o disponÃ­vel');
    }

    // Legacy configuration remains the compatibility source for route context
    // fields that have not yet been migrated in later F3 slices. It is no
    // longer the access decision for this module.
    const configuracao = await getConfiguracaoQuiosque(user.cervejariaId);

    if (!configuracao) {
      throw app.httpErrors.notFound('Modulo Quiosque não disponível');
    }

    request.quiosque = {
      cervejariaId: configuracao.cervejariaId,
      controlaEstoque: configuracao.controlaEstoque,
      temCozinha: configuracao.temCozinha,
      exclusivo: configuracao.exclusivo,
      usaCardapio: configuracao.usaCardapio,
      quantidadeMesas: configuracao.quantidadeMesas,
    };
  };
}
