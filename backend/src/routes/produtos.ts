import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { assertProdutoPodeExcluir } from '../lib/catalogo-utils.js';
import { isBebidaChope, isVendaUnitaria, normalizePrecos, produtoFieldsForSave } from '../lib/produto-utils.js';
import { listarOpcionaisProduto, substituirOpcionaisProduto } from '../lib/produto-opcionais.js';
import { canonicalPdvQaActivationEnabled } from '../lib/canonical-pdv-operational-config.js';
import { requirePermissaoOuDono } from '../lib/operacao/permissoes.js';

const opcionaisSchema = z.object({
  opcionalIds: z.array(z.string().min(1)).max(100),
});

const precoSchema = z.object({
  volumeMl: z.number().int().positive(),
  preco: z.number().positive(),
});

const produtoTipoSchema = z.enum(['BEBIDA', 'COMIDA']);
const formatoBebidaSchema = z.enum(['CHOPE', 'LATA', 'LONGNECK', 'GARRAFA', 'OUTRO']);

const createProdutoSchema = z
  .object({
    nome: z.string().min(1),
    descricao: z.string().optional(),
    cor: z.string().optional(),
    estilo: z.string().optional(),
    categoria: z.string().trim().min(1).max(80).optional(),
    controlaEstoque: z.boolean().optional(),
    exigePreparo: z.boolean().optional(),
    prepararEmPedidoSeparado: z.boolean().optional(),
    ordem: z.number().int().min(0).optional(),
    tipo: produtoTipoSchema.default('BEBIDA'),
    formato: formatoBebidaSchema.optional(),
    precos: z.array(precoSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const formato = data.tipo === 'BEBIDA' ? (data.formato ?? 'CHOPE') : null;
    if (data.tipo === 'COMIDA' && data.formato) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Comida não usa formato de bebida',
        path: ['formato'],
      });
    }
    if (isVendaUnitaria(data.tipo, formato) && data.precos.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe um único preço unitário',
        path: ['precos'],
      });
    }
    if (isBebidaChope(data.tipo, formato) && data.precos.filter((p) => p.preco).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chope precisa de ao menos um preço por volume',
        path: ['precos'],
      });
    }
  });

const updateProdutoSchema = z
  .object({
    nome: z.string().min(1).optional(),
    descricao: z.string().optional(),
    cor: z.string().optional(),
    estilo: z.string().optional(),
    categoria: z.string().trim().min(1).max(80).optional(),
    controlaEstoque: z.boolean().optional(),
    exigePreparo: z.boolean().optional(),
    prepararEmPedidoSeparado: z.boolean().optional(),
    ordem: z.number().int().min(0).optional(),
    tipo: produtoTipoSchema.optional(),
    formato: formatoBebidaSchema.optional(),
    ativo: z.boolean().optional(),
    precos: z.array(precoSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === 'COMIDA' && data.formato) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Comida não usa formato de bebida',
        path: ['formato'],
      });
    }
    const tipo = data.tipo ?? 'BEBIDA';
    const formato = tipo === 'BEBIDA' ? (data.formato ?? 'CHOPE') : null;
    if (data.precos && isVendaUnitaria(tipo, formato) && data.precos.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe um único preço unitário',
        path: ['precos'],
      });
    }
  });

export async function produtosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const opcionalCadastroSchema = z.object({ nome: z.string().trim().min(1).max(80), preco: z.number().min(0).max(9999), ativo: z.boolean().optional() });
  app.get('/opcionais', async (request) => { const user = getTenantUser(app, request); return prisma.opcional.findMany({ where: { cervejariaId: user.cervejariaId }, orderBy: { nome: 'asc' } }); });
  app.post('/opcionais', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => { const user = getTenantUser(app, request); const body = opcionalCadastroSchema.parse(request.body); return reply.status(201).send(await prisma.opcional.create({ data: { cervejariaId: user.cervejariaId, nome: body.nome, preco: body.preco, ativo: body.ativo ?? true } })); });
  app.put('/opcionais/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = opcionalCadastroSchema.partial().parse(request.body);
    const changed = await prisma.opcional.updateMany({ where: { id, cervejariaId }, data: body });
    if (!changed.count) return reply.status(404).send({ error: 'Opcional não encontrado' });
    return prisma.opcional.findFirstOrThrow({ where: { id, cervejariaId } });
  });
  app.delete('/opcionais/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const deleted = await prisma.opcional.deleteMany({ where: { id, cervejariaId } });
    if (!deleted.count) return reply.status(404).send({ error: 'Opcional não encontrado' });
    return { ok: true };
  });

  app.get('/', async (request) => {
    const user = getTenantUser(app, request);
    return prisma.produto.findMany({
      where: { cervejariaId: user.cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' } }, gruposOpcionais: { where: { ativo: true }, include: { opcoes: { where: { ativo: true }, orderBy: { ordem: 'asc' } } }, orderBy: { ordem: 'asc' } } },
      orderBy: [{ tipo: 'asc' }, { formato: 'asc' }, { nome: 'asc' }],
    });
  });

  app.get('/:id', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const produto = await prisma.produto.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });

    if (!produto) return reply.status(404).send({ error: 'Produto não encontrado' });
    return produto;
  });

  app.get('/:id/opcionais', async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId: user.cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto nÃ£o encontrado' });
    return listarOpcionaisProduto(prisma, id);
  });

  app.put('/:id/opcionais', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = opcionaisSchema.parse(request.body);
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId: user.cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto nÃ£o encontrado' });
    return prisma.$transaction((tx) => substituirOpcionaisProduto(tx, id, user.cervejariaId, body.opcionalIds));
  });

  app.post('/', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = createProdutoSchema.parse(request.body);
    const formato = body.tipo === 'BEBIDA' ? (body.formato ?? 'CHOPE') : null;
    const precos = normalizePrecos(body.tipo, formato, body.precos);
    const fields = produtoFieldsForSave(body.tipo, formato, body);

    const produto = await prisma.produto.create({
      data: {
        nome: body.nome,
        descricao: body.descricao,
        tipo: body.tipo,
        formato: fields.formato,
        cor: fields.cor,
        estilo: fields.estilo,
        categoria: body.categoria,
        controlaEstoque: body.controlaEstoque,
        exigePreparo: body.exigePreparo,
        ...(canonicalPdvQaActivationEnabled() ? { prepararEmPedidoSeparado: body.prepararEmPedidoSeparado } : {}),
        ordem: body.ordem,
        cervejariaId: user.cervejariaId,
        precos: {
          create: precos.map((p) => ({ volumeMl: p.volumeMl, preco: p.preco })),
        },
      },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });

    return reply.status(201).send(produto);
  });

  app.put('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = updateProdutoSchema.parse(request.body);

    const existing = await prisma.produto.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    const tipo = body.tipo ?? existing.tipo;
    const formato = tipo === 'BEBIDA' ? (body.formato ?? existing.formato ?? 'CHOPE') : null;
    if (tipo !== existing.tipo || formato !== existing.formato) {
      const vendasHistoricas = await prisma.itemComanda.count({ where: { produtoId: id } });
      if (vendasHistoricas > 0) {
        return reply.status(409).send({ error: 'Tipo/formato não pode ser alterado após vendas para preservar ranking e histórico de consumo' });
      }
    }

    const produto = await prisma.$transaction(async (tx) => {
      if (body.precos) {
        const precos = normalizePrecos(tipo, formato, body.precos);
        await tx.preco.deleteMany({ where: { produtoId: id } });
        await tx.preco.createMany({
          data: precos.map((p) => ({ produtoId: id, volumeMl: p.volumeMl, preco: p.preco })),
        });
      }

      const fields = produtoFieldsForSave(tipo, formato, {
        cor: body.cor ?? existing.cor,
        estilo: body.estilo ?? existing.estilo,
      });

      return tx.produto.update({
        where: { id },
        data: {
          nome: body.nome,
          descricao: body.descricao,
          tipo: body.tipo,
          formato: fields.formato,
          cor: fields.cor,
          estilo: fields.estilo,
          categoria: body.categoria,
          controlaEstoque: body.controlaEstoque,
          exigePreparo: body.exigePreparo,
          ...(canonicalPdvQaActivationEnabled() ? { prepararEmPedidoSeparado: body.prepararEmPedidoSeparado } : {}),
          ordem: body.ordem,
          ativo: body.ativo,
        },
        include: { precos: { orderBy: { volumeMl: 'asc' } } },
      });
    });

    return produto;
  });

  app.patch('/:id/ativo', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const { ativo } = z.object({ ativo: z.boolean() }).parse(request.body);

    const existing = await prisma.produto.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    const produto = await prisma.produto.update({
      where: { id },
      data: { ativo },
      include: { precos: { orderBy: { volumeMl: 'asc' } } },
    });

    return produto;
  });

  app.delete('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const existing = await prisma.produto.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    const blockReason = await assertProdutoPodeExcluir(id, user.cervejariaId);
    if (blockReason) return reply.status(409).send({ error: blockReason });

    await prisma.$transaction(async (tx) => {
      await tx.tap.updateMany({ where: { produtoId: id }, data: { produtoId: null } });
      await tx.preco.deleteMany({ where: { produtoId: id } });
      await tx.produto.delete({ where: { id } });
    });

    return reply.status(204).send();
  });
}
