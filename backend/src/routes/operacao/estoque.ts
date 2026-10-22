import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  ajustarSaldo,
  atualizarEstoqueMinimo,
  listarSaldos,
  registrarEntrada,
  registrarSaidaManual,
} from '../../lib/operacao/estoque.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { requirePermissao } from '../../lib/operacao/permissoes.js';

const pontoVendaQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const entradaSchema = z.object({
  pontoVendaId: z.string().min(1),
  produtoId: z.string().min(1),
  quantidade: z.number().positive(),
  observacao: z.string().trim().max(280).optional(),
});

const saidaSchema = z.object({
  pontoVendaId: z.string().min(1),
  produtoId: z.string().min(1),
  tipo: z.enum(['PERDA', 'CORTESIA', 'CONSUMO_INTERNO']),
  quantidade: z.number().positive(),
  observacao: z.string().trim().max(280).optional(),
});

const ajusteSchema = z.object({
  pontoVendaId: z.string().min(1),
  produtoId: z.string().min(1),
  quantidadeNova: z.number().min(0),
  observacao: z.string().trim().max(280).optional(),
});

const estoqueMinimoSchema = z.object({
  pontoVendaId: z.string().min(1),
  produtoId: z.string().min(1),
  estoqueMinimo: z.number().min(0).nullable(),
});

export async function estoqueOperacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    if (!request.operacao.controlaEstoque) {
      throw app.httpErrors.notFound('Operação sem controle de estoque');
    }
  });

  app.get('/', { preHandler: [requirePermissao(app, 'inventory.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    return listarSaldos(cervejariaId, pontoVendaId);
  });

  app.post('/entrada', { preHandler: [requirePermissao(app, 'inventory.adjust')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = entradaSchema.parse(request.body);

    const saldos = await registrarEntrada({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      produtoId: body.produtoId,
      quantidade: body.quantidade,
      observacao: body.observacao,
      registradoPorId: user.sub,
    });

    await registrarTransacao({
      cervejariaId,
      tipo: 'INVENTORY_MOVEMENT',
      usuarioId: user.sub,
      metadata: { operacao: 'entrada', produtoId: body.produtoId, quantidade: body.quantidade },
      payload: { request: body, saldos },
    });

    return reply.status(201).send(saldos);
  });

  app.post('/saida', { preHandler: [requirePermissao(app, 'inventory.adjust')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = saidaSchema.parse(request.body);

    const saldos = await registrarSaidaManual({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      produtoId: body.produtoId,
      tipo: body.tipo,
      quantidade: body.quantidade,
      observacao: body.observacao,
      registradoPorId: user.sub,
    });

    await registrarTransacao({
      cervejariaId,
      tipo: 'INVENTORY_MOVEMENT',
      usuarioId: user.sub,
      metadata: { operacao: 'saida', tipo: body.tipo, produtoId: body.produtoId, quantidade: body.quantidade },
      payload: { request: body, saldos },
    });

    return reply.status(201).send(saldos);
  });

  app.post('/ajuste', { preHandler: [requirePermissao(app, 'inventory.adjust')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = ajusteSchema.parse(request.body);

    const saldos = await ajustarSaldo({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      produtoId: body.produtoId,
      quantidadeNova: body.quantidadeNova,
      observacao: body.observacao,
      registradoPorId: user.sub,
    });

    await registrarTransacao({
      cervejariaId,
      tipo: 'INVENTORY_MOVEMENT',
      usuarioId: user.sub,
      metadata: { operacao: 'ajuste', produtoId: body.produtoId, quantidadeNova: body.quantidadeNova },
      payload: { request: body, saldos },
    });

    return reply.status(201).send(saldos);
  });

  app.put('/minimo', { preHandler: [app.requireDono] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const body = estoqueMinimoSchema.parse(request.body);
    return atualizarEstoqueMinimo({ cervejariaId, ...body });
  });
}
