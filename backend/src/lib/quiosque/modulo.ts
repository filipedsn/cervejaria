import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';
import { getAuthUser } from '../../types/auth.js';

export interface ContextoQuiosque {
  cervejariaId: string;
  controlaEstoque: boolean;
  temCozinha: boolean;
  exclusivo: boolean;
  usaCardapio: boolean;
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
    };
  };
}
