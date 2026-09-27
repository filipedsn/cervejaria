import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  CATEGORIAS_PRODUTO_OPERACAO,
  categoriaProdutoOperacaoSchema,
  normalizarOrdemCategoriasProduto,
} from '../../lib/operacao/categorias.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
import { listProdutosOperacionaisTurno } from '../../lib/operacao/sessao-cardapio.js';
import { listarOpcionaisProduto, substituirOpcionaisProduto } from '../../lib/produto-opcionais.js';

const createProdutoSchema = z.object({
  nome: z.string().min(1),
  categoria: categoriaProdutoOperacaoSchema.default('Bebidas'),
  precoUnit: z.number().positive(),
  exigePreparo: z.boolean().default(false),
  controlaEstoque: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
});

const updateProdutoSchema = createProdutoSchema.partial().extend({
  ativo: z.boolean().optional(),
  categoria: categoriaProdutoOperacaoSchema.optional(),
});

const opcionaisSchema = z.object({
  opcionalIds: z.array(z.string().min(1)).max(100),
});
const categoriasDisponiveis = new Set<string>(CATEGORIAS_PRODUTO_OPERACAO);

function respostaProduto(produto: { precos?: Array<{ preco: unknown }>; [key: string]: unknown }) {
  const vinculados = (produto.opcionaisVinculados as Array<{ opcional: { id: string; nome: string; preco: unknown } }> | undefined) ?? [];
  return {
    ...produto,
    gruposOpcionais: vinculados.length ? [{ id: 'opcionais', nome: 'Opcionais', obrigatorio: false, maximo: 99, opcoes: vinculados.map(({ opcional }) => ({ id: opcional.id, nome: opcional.nome, precoAdicional: Number(opcional.preco) })) }] : [],
    precoUnit: String(produto.precos?.[0]?.preco ?? 0),
  };
}

export async function produtosOperacaoRoutes(app: FastifyInstance) {
  const opcionalCadastroSchema = z.object({ nome: z.string().trim().min(1).max(80), preco: z.number().min(0).max(9999), ativo: z.boolean().optional() });
  app.get('/opcionais', async (request) => prisma.opcional.findMany({ where: { cervejariaId: request.operacao.cervejariaId }, orderBy: { nome: 'asc' } }));
  app.post('/opcionais', { preHandler: [app.requireDono] }, async (request, reply) => { const body = opcionalCadastroSchema.parse(request.body); return reply.status(201).send(await prisma.opcional.create({ data: { cervejariaId: request.operacao.cervejariaId, nome: body.nome, preco: body.preco, ativo: body.ativo ?? true } })); });
  app.put('/opcionais/:id', { preHandler: [app.requireDono] }, async (request) => { const body = opcionalCadastroSchema.partial().parse(request.body); return prisma.opcional.update({ where: { id: (request.params as { id: string }).id }, data: body }); });
  app.delete('/opcionais/:id', { preHandler: [app.requireDono] }, async (request) => { return prisma.opcional.delete({ where: { id: (request.params as { id: string }).id } }); });
  app.get('/categorias', async (request) => {
    const { cervejariaId } = request.operacao;
    const cervejaria = await prisma.cervejaria.findUnique({
      where: { id: cervejariaId },
      select: { operacaoCategoriasOrdem: true },
    });
    return {
      categorias: [...CATEGORIAS_PRODUTO_OPERACAO],
      ordem: normalizarOrdemCategoriasProduto(cervejaria?.operacaoCategoriasOrdem),
    };
  });

  app.put('/categorias/ordem', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const body = z.object({
      ordem: z.array(z.string()).length(CATEGORIAS_PRODUTO_OPERACAO.length).refine(
        (ordem) =>
          new Set(ordem).size === CATEGORIAS_PRODUTO_OPERACAO.length &&
          ordem.every((categoria) => categoriasDisponiveis.has(categoria)),
        'A ordem deve conter cada categoria disponível uma única vez',
      ),
    }).parse(request.body);
    const updated = await prisma.cervejaria.update({
      where: { id: cervejariaId },
      data: { operacaoCategoriasOrdem: body.ordem },
      select: { operacaoCategoriasOrdem: true },
    });
    return { ordem: normalizarOrdemCategoriasProduto(updated.operacaoCategoriasOrdem) };
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.operacao;
    const query = z
      .object({
        incluirInativos: z.coerce.boolean().default(false),
        pontoVendaId: z.string().min(1).optional(),
      })
      .parse(request.query);

    if (query.incluirInativos) {
      const produtos = await prisma.produto.findMany({
        where: { cervejariaId },
        include: { precos: { where: { volumeMl: 1 }, take: 1 }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      });
      return produtos.map(respostaProduto);
    }

    if (query.pontoVendaId) {
      return listProdutosOperacionaisTurno(cervejariaId, query.pontoVendaId, diaOperacional());
    }

    const produtos = await prisma.produto.findMany({
      where: { cervejariaId, ativo: true },
      include: { precos: { where: { volumeMl: 1 }, take: 1 }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    return produtos.map(respostaProduto);
  });

  app.get('/:id/opcionais', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto nÃ£o encontrado' });
    return listarOpcionaisProduto(prisma, id);
  });

  app.put('/:id/opcionais', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = opcionaisSchema.parse(request.body);
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto nÃ£o encontrado' });
    return prisma.$transaction((tx) => substituirOpcionaisProduto(tx, id, body.opcionalIds));
  });

  app.post('/', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const body = createProdutoSchema.parse(request.body);

    const produto = await prisma.produto.create({
      data: {
        cervejariaId,
        nome: body.nome.trim(),
        categoria: body.categoria,
        exigePreparo: body.exigePreparo,
        controlaEstoque: body.controlaEstoque,
        ordem: body.ordem,
        precos: { create: { volumeMl: 1, preco: body.precoUnit } },
      },
    });

    return reply.status(201).send(respostaProduto(produto));
  });

  app.put('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = updateProdutoSchema.parse(request.body);

    const existing = await prisma.produto.findFirst({ where: { id, cervejariaId }, include: { precos: { where: { volumeMl: 1 }, take: 1 } } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    const atualizado = await prisma.$transaction(async (tx) => {
      const produto = await tx.produto.update({
        where: { id },
        data: {
          nome: body.nome?.trim(),
          categoria: body.categoria,
          exigePreparo: body.exigePreparo,
          controlaEstoque: body.controlaEstoque,
          ordem: body.ordem,
          ativo: body.ativo,
        },
      });
      if (body.precoUnit !== undefined) {
        await tx.preco.upsert({
          where: { produtoId_volumeMl: { produtoId: id, volumeMl: 1 } },
          create: { produtoId: id, volumeMl: 1, preco: body.precoUnit },
          update: { preco: body.precoUnit },
        });
      }
      return tx.produto.findUniqueOrThrow({
        where: { id: produto.id },
        include: { precos: { where: { volumeMl: 1 }, take: 1 } },
      });
    });
    return respostaProduto(atualizado);
  });

  app.delete('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };

    const existing = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    // Desativa em vez de apagar: a partir da Fase 2 o produto aparece em vendas
    // ja fechadas e apagar quebraria o historico de caixa.
    await prisma.produto.update({ where: { id }, data: { ativo: false } });
    return reply.status(204).send();
  });
}
