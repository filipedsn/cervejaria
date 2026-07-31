import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const createProdutoSchema = z.object({
  nome: z.string().min(1),
  categoria: z.string().trim().min(1).optional(),
  precoUnit: z.number().positive(),
  exigePreparo: z.boolean().default(false),
  controlaEstoque: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
});

const updateProdutoSchema = createProdutoSchema.partial().extend({
  ativo: z.boolean().optional(),
});

export async function produtosQuiosqueRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const { incluirInativos } = z
      .object({ incluirInativos: z.coerce.boolean().default(false) })
      .parse(request.query);

    return prisma.produtoQuiosque.findMany({
      where: {
        cervejariaId,
        ...(incluirInativos ? {} : { ativo: true }),
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  });

  app.post('/', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const body = createProdutoSchema.parse(request.body);

    const produto = await prisma.produtoQuiosque.create({
      data: {
        cervejariaId,
        nome: body.nome.trim(),
        categoria: body.categoria,
        precoUnit: body.precoUnit,
        exigePreparo: body.exigePreparo,
        controlaEstoque: body.controlaEstoque,
        ordem: body.ordem,
      },
    });

    return reply.status(201).send(produto);
  });

  app.put('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };
    const body = updateProdutoSchema.parse(request.body);

    const existing = await prisma.produtoQuiosque.findFirst({ where: { id, cervejariaId } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    return prisma.produtoQuiosque.update({
      where: { id },
      data: {
        nome: body.nome?.trim(),
        categoria: body.categoria,
        precoUnit: body.precoUnit,
        exigePreparo: body.exigePreparo,
        controlaEstoque: body.controlaEstoque,
        ordem: body.ordem,
        ativo: body.ativo,
      },
    });
  });

  app.delete('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };

    const existing = await prisma.produtoQuiosque.findFirst({ where: { id, cervejariaId } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    // Desativa em vez de apagar: a partir da Fase 2 o produto aparece em vendas
    // ja fechadas e apagar quebraria o historico de caixa.
    await prisma.produtoQuiosque.update({ where: { id }, data: { ativo: false } });
    return reply.status(204).send();
  });
}
