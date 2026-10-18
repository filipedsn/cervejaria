import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  CATEGORIAS_PRODUTO_OPERACAO,
  normalizarOrdemCategoriasProduto,
  normalizeCategoriaProduto,
} from '../../lib/operacao/categorias.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
import { listProdutosOperacionaisTurno } from '../../lib/operacao/sessao-cardapio.js';
import { listarOpcionaisProduto, substituirOpcionaisProduto } from '../../lib/produto-opcionais.js';
import { canonicalPdvQaActivationEnabled } from '../../lib/canonical-pdv-operational-config.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';
import { catalogoCategoriasCanonicoAtivo, categoriaPdvInputSchema, normalizarNomeCategoria } from '../../lib/operacao/catalogo-categorias.js';

const precoProdutoSchema = z.object({ volumeMl: z.number().int().positive(), preco: z.number().positive() });
const tipoProdutoSchema = z.enum(['BEBIDA', 'COMIDA']);
const formatoProdutoSchema = z.enum(['CHOPE', 'LATA', 'LONGNECK', 'GARRAFA', 'OUTRO']);

const createProdutoSchema = z.object({
  nome: z.string().min(1),
  categoria: z.string().trim().min(1).max(80).default('Bebidas'),
  categoriaPdvId: z.string().min(1).optional(),
  precoUnit: z.number().positive().optional(),
  precos: z.array(precoProdutoSchema).min(1).optional(),
  tipo: tipoProdutoSchema.optional(),
  formato: formatoProdutoSchema.optional(),
  descricao: z.string().optional(),
  estilo: z.string().optional(),
  exigePreparo: z.boolean().default(false),
  prepararEmPedidoSeparado: z.boolean().default(false),
  controlaEstoque: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
});

const updateProdutoSchema = createProdutoSchema.partial().extend({
  ativo: z.boolean().optional(),
  categoria: z.string().trim().min(1).max(80).optional(),
});

const opcionaisSchema = z.object({
  opcionalIds: z.array(z.string().min(1)).max(100),
});
function respostaProduto(produto: { precos?: Array<{ preco: unknown }>; [key: string]: unknown }) {
  const vinculados = (produto.opcionaisVinculados as Array<{ opcional: { id: string; nome: string; preco: unknown } }> | undefined) ?? [];
  return {
    ...produto,
    gruposOpcionais: vinculados.length ? [{ id: 'opcionais', nome: 'Opcionais', obrigatorio: false, maximo: 99, opcoes: vinculados.map(({ opcional }) => ({ id: opcional.id, nome: opcional.nome, precoAdicional: Number(opcional.preco) })) }] : [],
    precoUnit: String(produto.precos?.[0]?.preco ?? 0),
  };
}

async function removerProdutoDosCardapios(
  tx: Prisma.TransactionClient,
  produtoId: string,
  cervejariaId: string,
) {
  await tx.cardapioProduto.deleteMany({
    where: { produtoId, cardapio: { cervejariaId } },
  });
  await tx.eventoProduto.deleteMany({
    where: { produtoId, evento: { cervejariaId, status: 'ABERTO' } },
  });
  await tx.sessaoCaixaProdutoOperacao.deleteMany({
    where: { produtoId, sessao: { cervejariaId, status: 'ABERTO' } },
  });
}

export async function produtosOperacaoRoutes(app: FastifyInstance) {
  const opcionalCadastroSchema = z.object({ nome: z.string().trim().min(1).max(80), preco: z.number().min(0).max(9999), ativo: z.boolean().optional() });
  app.get('/opcionais', async (request) => prisma.opcional.findMany({ where: { cervejariaId: request.operacao.cervejariaId }, orderBy: { nome: 'asc' } }));
  app.post('/opcionais', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const body = opcionalCadastroSchema.parse(request.body);
    return reply.status(201).send(await prisma.opcional.create({ data: {
      cervejariaId: request.operacao.cervejariaId,
      // Operational middleware resolves effectiveSettings from the canonical
      // PDV. Keep NULL in legacy mode to preserve its global optional contract.
      pontoVendaId: canonicalPdvQaActivationEnabled() ? request.operacao.effectiveSettings.pointId : null,
      nome: body.nome,
      preco: body.preco,
      ativo: body.ativo ?? true,
    } }));
  });
  app.put('/opcionais/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = opcionalCadastroSchema.partial().parse(request.body);
    const changed = await prisma.opcional.updateMany({ where: { id, cervejariaId }, data: body });
    if (!changed.count) return reply.status(404).send({ error: 'Opcional não encontrado' });
    return prisma.opcional.findFirstOrThrow({ where: { id, cervejariaId } });
  });
  app.delete('/opcionais/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const deleted = await prisma.opcional.deleteMany({ where: { id, cervejariaId } });
    if (!deleted.count) return reply.status(404).send({ error: 'Opcional não encontrado' });
    return { ok: true };
  });
  app.get('/categorias', async (request) => {
    const { cervejariaId } = request.operacao;
    if (catalogoCategoriasCanonicoAtivo()) {
      const categorias = await prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId }, orderBy: [{ nomeNormalizado: 'asc' }, { nome: 'asc' }] });
      const cervejaria = await prisma.cervejaria.findUnique({ where: { id: cervejariaId }, select: { operacaoCategoriasOrdem: true } });
      const config = cervejaria?.operacaoCategoriasOrdem;
      const rawOrder = Array.isArray(config) ? config : config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).catalogo : [];
      const names = categorias.map((categoria) => categoria.nome);
      const saved = Array.isArray(rawOrder) ? rawOrder.filter((name): name is string => typeof name === 'string' && names.includes(name)) : [];
      const ordem = [...new Set(saved), ...names.filter((name) => !saved.includes(name))];
      return { categorias: ordem, categoriasPdv: categorias, ordem, catalogoCanonico: true };
    }
    const categorias = request.operacao.tapsEnabled
      ? [...CATEGORIAS_PRODUTO_OPERACAO, 'Chope']
      : [...CATEGORIAS_PRODUTO_OPERACAO];
    const cervejaria = await prisma.cervejaria.findUnique({
      where: { id: cervejariaId },
      select: { operacaoCategoriasOrdem: true },
    });
    return {
      categorias,
      ordem: normalizarOrdemCategoriasProduto(cervejaria?.operacaoCategoriasOrdem, request.operacao.tapsEnabled),
      catalogoCanonico: false,
    };
  });


  app.post('/categorias', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    if (!catalogoCategoriasCanonicoAtivo()) return reply.status(404).send({ error: 'Catálogo canônico desativado' });
    const { cervejariaId } = request.operacao;
    const body = categoriaPdvInputSchema.parse(request.body);
    const nomeNormalizado = normalizarNomeCategoria(body.nome);
    const existente = await prisma.categoriaProdutoPdv.findFirst({ where: { cervejariaId, nomeNormalizado } });
    if (existente) return reply.status(409).send({ error: 'Já existe categoria com nome equivalente', categoria: existente });
    return reply.status(201).send(await prisma.categoriaProdutoPdv.create({ data: { cervejariaId, nome: body.nome, nomeNormalizado, gamificada: body.gamificada } }));
  });

  app.put('/categorias/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    if (!catalogoCategoriasCanonicoAtivo()) return reply.status(404).send({ error: 'Catálogo canônico desativado' });
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = categoriaPdvInputSchema.parse(request.body);
    const existente = await prisma.categoriaProdutoPdv.findFirst({ where: { id, cervejariaId } });
    if (!existente) return reply.status(404).send({ error: 'Categoria não encontrada' });
    const nomeNormalizado = normalizarNomeCategoria(body.nome);
    const colisao = await prisma.categoriaProdutoPdv.findFirst({ where: { cervejariaId, nomeNormalizado, id: { not: id } } });
    if (colisao) return reply.status(409).send({ error: 'Já existe categoria com nome equivalente', categoria: colisao });
    const updated = await prisma.$transaction(async (tx) => {
      const category = await tx.categoriaProdutoPdv.update({ where: { id }, data: { nome: body.nome, nomeNormalizado, gamificada: body.gamificada } });
      await tx.produto.updateMany({ where: { categoriaPdvId: id, cervejariaId }, data: { categoria: body.nome } });
      const brewery = await tx.cervejaria.findUnique({ where: { id: cervejariaId }, select: { operacaoCategoriasOrdem: true } });
      const preferences = Array.isArray(brewery?.operacaoCategoriasOrdem)
        ? { catalogo: brewery.operacaoCategoriasOrdem }
        : brewery?.operacaoCategoriasOrdem && typeof brewery.operacaoCategoriasOrdem === 'object'
          ? brewery.operacaoCategoriasOrdem as Record<string, unknown>
          : {};
      if (Array.isArray(preferences.catalogo)) {
        await tx.cervejaria.update({ where: { id: cervejariaId }, data: { operacaoCategoriasOrdem: { ...preferences, catalogo: preferences.catalogo.map((name) => name === existente.nome ? body.nome : name) } } });
      }
      return category;
    });
    return reply.send(updated);
  });

  app.delete('/categorias/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    if (!catalogoCategoriasCanonicoAtivo()) return reply.status(404).send({ error: 'Catálogo canônico desativado' });
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const category = await prisma.categoriaProdutoPdv.findFirst({ where: { id, cervejariaId }, select: { id: true, nome: true } });
    if (!category) return reply.status(404).send({ error: 'Categoria não encontrada neste PDV' });
    try {
      await prisma.$transaction(async (tx) => {
        const linkedProducts = await tx.produto.count({ where: { categoriaPdvId: id, cervejariaId } });
        if (linkedProducts > 0) throw new Error(`Categoria usada por ${linkedProducts} produto(s); remova os vínculos antes de excluir.`);
        const deleted = await tx.categoriaProdutoPdv.deleteMany({ where: { id, cervejariaId } });
        if (!deleted.count) throw new Error('Categoria não encontrada neste PDV');
        const brewery = await tx.cervejaria.findUnique({ where: { id: cervejariaId }, select: { operacaoCategoriasOrdem: true } });
        const preferences = Array.isArray(brewery?.operacaoCategoriasOrdem)
          ? { catalogo: brewery.operacaoCategoriasOrdem }
          : brewery?.operacaoCategoriasOrdem && typeof brewery.operacaoCategoriasOrdem === 'object'
            ? brewery.operacaoCategoriasOrdem as Record<string, unknown>
            : {};
        if (Array.isArray(preferences.catalogo)) {
          await tx.cervejaria.update({ where: { id: cervejariaId }, data: { operacaoCategoriasOrdem: { ...preferences, catalogo: preferences.catalogo.filter((name) => name !== category.nome) } } });
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Categoria usada por ')) return reply.status(409).send({ error: error.message });
      if (error instanceof Error && error.message === 'Categoria não encontrada neste PDV') return reply.status(404).send({ error: error.message });
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003') {
        return reply.status(409).send({ error: 'Categoria ainda possui produtos vinculados e não pode ser excluída.' });
      }
      throw error;
    }
    return { ok: true };
  });

  app.put('/categorias/ordem', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const categorias = catalogoCategoriasCanonicoAtivo()
      ? (await prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId }, select: { nome: true }, orderBy: { nomeNormalizado: 'asc' } })).map((categoria) => categoria.nome)
      : request.operacao.tapsEnabled ? [...CATEGORIAS_PRODUTO_OPERACAO, 'Chope'] : [...CATEGORIAS_PRODUTO_OPERACAO];
    const categoriasDisponiveis = new Set<string>(categorias);
    const body = z.object({
      ordem: z.array(z.string()).length(categorias.length).refine(
        (ordem) =>
          new Set(ordem).size === categorias.length &&
          ordem.every((categoria) => categoriasDisponiveis.has(categoria)),
        'A ordem deve conter cada categoria disponível uma única vez',
      ),
    }).parse(request.body);
    const atual = await prisma.cervejaria.findUnique({
      where: { id: cervejariaId },
      select: { operacaoCategoriasOrdem: true },
    });
    const preferencias = Array.isArray(atual?.operacaoCategoriasOrdem)
      ? { catalogo: atual.operacaoCategoriasOrdem }
      : atual?.operacaoCategoriasOrdem && typeof atual.operacaoCategoriasOrdem === 'object'
        ? atual.operacaoCategoriasOrdem as Record<string, unknown>
        : {};
    const updated = await prisma.cervejaria.update({
      where: { id: cervejariaId },
      data: { operacaoCategoriasOrdem: { ...preferencias, catalogo: body.ordem } },
      select: { operacaoCategoriasOrdem: true },
    });
    if (catalogoCategoriasCanonicoAtivo()) {
      const config = updated.operacaoCategoriasOrdem;
      const raw = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).catalogo : [];
      const saved = Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && categoriasDisponiveis.has(name)) : [];
      return { ordem: [...new Set(saved), ...categorias.filter((name) => !saved.includes(name))] };
    }
    return { ordem: normalizarOrdemCategoriasProduto(updated.operacaoCategoriasOrdem, request.operacao.tapsEnabled) };
  });

  app.get('/', async (request) => {
    const { cervejariaId } = request.operacao;
    const query = z
      .object({
        incluirInativos: z.coerce.boolean().default(false),
        pontoVendaId: z.string().min(1).optional(),
        incluirTodosChopes: z.coerce.boolean().default(false),
      })
      .parse(request.query);

    if (query.incluirInativos) {
      const produtos = await prisma.produto.findMany({
        where: { cervejariaId },
        include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      });
      return produtos.map(respostaProduto);
    }

    if (query.pontoVendaId) {
      return listProdutosOperacionaisTurno(cervejariaId, query.pontoVendaId, diaOperacional(), request.operacao.tapsEnabled, query.incluirTodosChopes);
    }

    const produtos = await prisma.produto.findMany({
      where: { cervejariaId, ativo: true },
      include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    return produtos.map(respostaProduto);
  });

  app.get('/:id/opcionais', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto não encontrado' });
    return listarOpcionaisProduto(prisma, id);
  });

  app.put('/:id/opcionais', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = opcionaisSchema.parse(request.body);
    const produto = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!produto) return reply.status(404).send({ error: 'Produto não encontrado' });
    return prisma.$transaction((tx) => substituirOpcionaisProduto(tx, id, cervejariaId, body.opcionalIds));
  });

  app.post('/', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    const body = createProdutoSchema.parse(request.body);
    let categoria = body.categoria;
    let categoriaPdvId: string | null = null;
    if (catalogoCategoriasCanonicoAtivo()) {
      if (!body.categoriaPdvId) return reply.status(400).send({ error: 'Selecione uma categoria cadastrada' });
      const categoriaPdv = await prisma.categoriaProdutoPdv.findFirst({ where: { id: body.categoriaPdvId, cervejariaId } });
      if (!categoriaPdv) return reply.status(404).send({ error: 'Categoria não encontrada neste PDV' });
      categoria = categoriaPdv.nome;
      categoriaPdvId = categoriaPdv.id;
    }
    const chope = categoria === 'Chope' || body.formato === 'CHOPE';
    if (chope && categoria !== 'Chope' && !catalogoCategoriasCanonicoAtivo()) return reply.status(400).send({ error: 'Selecione a categoria Chope para cadastrar preços por volume' });
    if (chope && !tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    if (chope && !(body.precos ?? []).some((preco) => preco.volumeMl > 1 && preco.preco > 0)) {
      return reply.status(400).send({ error: 'Informe pelo menos um preço por volume para o chope' });
    }
    if (!chope && !body.precoUnit) return reply.status(400).send({ error: 'Informe um preço unitário maior que zero' });

    const tipo = chope ? 'BEBIDA' : body.tipo ?? 'BEBIDA';
    const formato = chope ? 'CHOPE' : tipo === 'BEBIDA' ? body.formato ?? 'OUTRO' : null;
    const precos = chope ? body.precos! : [{ volumeMl: 1, preco: body.precoUnit! }];

    const produto = await prisma.produto.create({
      data: {
        cervejariaId,
        ...(request.operacao.effectiveSettings.pointId ? { pontoVendaId: request.operacao.effectiveSettings.pointId } : {}),
        nome: body.nome.trim(),
        categoria,
        ...(catalogoCategoriasCanonicoAtivo() ? { categoriaPdvId } : {}),
        tipo,
        formato,
        descricao: chope ? body.descricao : undefined,
        estilo: chope ? body.estilo : undefined,
        exigePreparo: chope ? false : body.exigePreparo,
        ...(canonicalPdvQaActivationEnabled() ? { prepararEmPedidoSeparado: chope || !body.exigePreparo ? false : body.prepararEmPedidoSeparado } : {}),
        controlaEstoque: body.controlaEstoque,
        ordem: body.ordem,
        precos: { create: precos },
      },
      include: { precos: { orderBy: { volumeMl: 'asc' } }, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
      omit: {
        ...(catalogoCategoriasCanonicoAtivo() ? {} : { categoriaPdvId: true }),
        ...(canonicalPdvQaActivationEnabled() ? {} : { prepararEmPedidoSeparado: true }),
      },
    });

    return reply.status(201).send(respostaProduto(produto));
  });

  app.put('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    const { id } = request.params as { id: string };
    const body = updateProdutoSchema.parse(request.body);

    const canonicalCategoriesEnabled = catalogoCategoriasCanonicoAtivo();
    const existing = await prisma.produto.findFirst({ where: { id, cervejariaId }, include: { precos: { orderBy: { volumeMl: 'asc' } }, ...(canonicalCategoriesEnabled ? { categoriaPdv: true } : {}) } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    let categoria = body.categoria ?? (canonicalCategoriesEnabled ? existing.categoriaPdv?.nome ?? existing.categoria : normalizeCategoriaProduto(existing.categoria)) ?? 'Outros';
    let categoriaPdvId: string | null | undefined;
    if (canonicalCategoriesEnabled && body.categoriaPdvId) {
      const categoriaPdv = await prisma.categoriaProdutoPdv.findFirst({ where: { id: body.categoriaPdvId, cervejariaId } });
      if (!categoriaPdv) return reply.status(404).send({ error: 'Categoria não encontrada neste PDV' });
      categoria = categoriaPdv.nome;
      categoriaPdvId = categoriaPdv.id;
    } else if (canonicalCategoriesEnabled) {
      const categoriaCanonicaAtual = existing.categoriaPdv?.nome ?? existing.categoria;
      if (body.categoria !== undefined && body.categoria !== categoriaCanonicaAtual) return reply.status(400).send({ error: 'Para trocar a categoria, selecione uma categoria cadastrada' });
      categoria = categoriaCanonicaAtual ?? 'Outros';
    }

    const tipoAtualizado = body.tipo ?? (body.formato === 'CHOPE' ? 'BEBIDA' : existing.tipo);
    const formatoAtualizado = tipoAtualizado === 'BEBIDA'
      ? body.formato ?? existing.formato ?? 'OUTRO'
      : null;
    const chope = tipoAtualizado === 'BEBIDA' && formatoAtualizado === 'CHOPE';
    if (categoria === 'Chope' && !chope) {
      return reply.status(400).send({ error: 'A categoria Chope exige tipo Bebida e formato Chope' });
    }
    if (chope && categoria !== 'Chope' && !canonicalCategoriesEnabled) return reply.status(400).send({ error: 'Selecione a categoria Chope para cadastrar preços por volume' });
    if (chope && !tapsEnabled && (body.categoria === 'Chope' || body.formato === 'CHOPE' || body.precos !== undefined || body.precoUnit !== undefined)) {
      return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    }
    const precosExistentesChope = body.precos ?? existing.precos;
    if (chope && !precosExistentesChope.some((preco) => preco.volumeMl > 1 && Number(preco.preco) > 0)) {
      return reply.status(400).send({ error: 'Informe pelo menos um preço por volume para o chope' });
    }
    if (chope && body.precoUnit !== undefined && body.precos === undefined) {
      return reply.status(400).send({ error: 'Chope deve ser salvo com preços por volume' });
    }
    const classificationChanged = tipoAtualizado !== existing.tipo || formatoAtualizado !== existing.formato;
    if (classificationChanged && (tipoAtualizado !== existing.tipo || formatoAtualizado !== existing.formato)) {
      const vendasHistoricas = await prisma.itemComanda.count({ where: { produtoId: id } });
      if (vendasHistoricas > 0) return reply.status(409).send({ error: 'Tipo/formato não pode ser alterado após vendas para preservar ranking e histórico de consumo' });
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      const tipo = tipoAtualizado;
      const formato = formatoAtualizado;
      const produto = await tx.produto.update({
        where: { id },
        data: {
          nome: body.nome?.trim(),
          categoria: body.categoria !== undefined || categoriaPdvId !== undefined || (canonicalCategoriesEnabled && existing.categoriaPdvId) ? categoria : undefined,
          ...(catalogoCategoriasCanonicoAtivo() && categoriaPdvId !== undefined ? { categoriaPdvId } : {}),
          ...(classificationChanged ? { tipo, formato } : {}),
          descricao: body.descricao,
          estilo: body.estilo,
          exigePreparo: chope ? false : body.exigePreparo,
          ...(canonicalPdvQaActivationEnabled() ? { prepararEmPedidoSeparado: chope || !(body.exigePreparo ?? existing.exigePreparo) ? false : (body.prepararEmPedidoSeparado ?? existing.prepararEmPedidoSeparado) } : {}),
          controlaEstoque: body.controlaEstoque,
          ordem: body.ordem,
          ativo: body.ativo,
        },
      });
      if (body.ativo === false) {
        await removerProdutoDosCardapios(tx, id, cervejariaId);
      }
      const precosNovos = body.precos ?? (!chope && body.precoUnit !== undefined ? [{ volumeMl: 1, preco: body.precoUnit }] : undefined);
      if (precosNovos) {
        await tx.preco.deleteMany({ where: { produtoId: id } });
        await tx.preco.createMany({
          data: precosNovos.map((preco) => ({ produtoId: id, volumeMl: preco.volumeMl, preco: preco.preco })),
        });
      }
      return tx.produto.findUniqueOrThrow({
        where: { id: produto.id },
        include: { precos: { orderBy: { volumeMl: 'asc' } } },
      });
    });
    return respostaProduto(atualizado);
  });

  app.delete('/:id', { preHandler: [requirePermissaoOuDono(app, 'catalog.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };

    const existing = await prisma.produto.findFirst({ where: { id, cervejariaId } });
    if (!existing) return reply.status(404).send({ error: 'Produto não encontrado' });

    // Desativa em vez de apagar: a partir da Fase 2 o produto aparece em vendas
    // já fechadas. Só os vínculos de cardápio operacional são removidos.
    await prisma.$transaction(async (tx) => {
      await tx.produto.update({ where: { id }, data: { ativo: false } });
      await removerProdutoDosCardapios(tx, id, cervejariaId);
    });
    return reply.status(204).send();
  });
}
