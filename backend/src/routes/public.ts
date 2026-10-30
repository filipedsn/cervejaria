import type { FastifyInstance, FastifyRequest } from 'fastify';

import rateLimit from '@fastify/rate-limit';

import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';
import { isPortalCategoryAllowed } from '../lib/portal-catalog.js';
import { buildPublicPdvCardapio } from '../lib/portal-pdv-cardapio.js';
import { filtrarCategoriaChopeSeTapsDesligados } from '../lib/operacao/categoria-chope-torneiras.js';
import { resolveLogoVersion } from '../lib/cervejaria-branding.js';

import {
  lookupClientePortalPorTelefone,
  ClientePortalInativoError,
  registerClientePortalPdv,
} from '../lib/portal-cliente.js';
import { normalizePhone } from '../lib/phone.js';
import { assertCaixaAberto, lockCaixaEmTx } from '../lib/operacao/caixa.js';
import { atribuirTapMontado, diaOperacional, CAIXA_VENDA_TX, criarPedidos, resolverItens, resumoComanda } from '../lib/operacao/venda.js';
import { INCLUDE_COMANDA_OPERACAO, recalcComandaTotalOperacao, whereComandaOperacao } from '../lib/operacao/comanda-adapter.js';
import { CATEGORIAS_PRODUTO_OPERACAO, normalizarOrdemCategoriasProduto } from '../lib/operacao/categorias.js';
import { catalogoCategoriasCanonicoAtivo } from '../lib/operacao/catalogo-categorias.js';
import {
  notificarAtendimentoBalcaoPortal,
  notificarComandaOperacaoAtualizada,
  notificarPedidoNovo,
} from '../lib/operacao/cozinha.js';
import { inventoryService } from '../services/inventory-service.js';
import { lockComandaItemsInTx } from '../lib/comanda-service.js';
import { getOperationalProfile } from '../lib/operational-profile.js';
import { proximoNumeroComandaOperacaoTurno } from '../lib/comanda-numero.js';
import { assertCommandOccurrenceMatchesSession, cashOccurrenceContextEnabled } from '../lib/operacao/contexto-ocorrencia.js';
import { resolveUniqueOpenCashSession } from '../lib/operacao/cash-session-resolution.js';

import {
  getClienteSession,
  clearClienteSessionCookie,
} from '../lib/cliente-session.js';
import { PDV_CLIENTE_COOKIE_NAME, type PdvClienteSessionPayload } from '../types/cliente-session.js';

import {

  buildPublicEventCardapio,

  serializeComandaForCliente,

  serializePedido,

  pedidoInclude,

} from '../lib/comanda-service.js';

import { emitToEvento, emitToComanda, emitToCervejaria } from '../lib/realtime.js';
import { notifyPedidoCreated } from '../lib/push-notifications.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import { recordPaymentRequestTransition } from '../lib/payment-request-observability.js';

import { getDevFrontendOrigin } from '../lib/lan-url.js';

const PUBLIC_RATE_LIMIT_MAX =

  process.env.QA_MODE === '1'

    ? Number(process.env.QA_PUBLIC_RATE_LIMIT_MAX ?? 200)

    : 10;

const telefoneQuerySchema = z.object({
  telefone: z.string().min(10),
});

const abrirComandaPdvSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  telefone: z.string().min(10),
  ocorrenciaId: z.never().optional(),
});

const pedidoPdvSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  ocorrenciaId: z.never().optional(),
  itens: z.array(z.object({
    produtoId: z.string().min(1),
    quantidade: z.number().int().positive().max(999),
    tapId: z.string().min(1).optional(),
    volumeMl: z.number().int().positive().optional(),
    paraViagem: z.boolean().default(false),
    observacao: z.string().trim().max(280).optional(),
    opcionais: z.array(z.object({ opcionalId: z.string().min(1), quantidade: z.number().int().positive().max(99).optional() })).optional(),
  })).min(1),
  paraViagem: z.boolean().default(false),
  observacao: z.string().trim().max(280).optional(),
});

async function getPdvClienteSession(app: FastifyInstance, request: FastifyRequest) {
  const token = request.cookies[PDV_CLIENTE_COOKIE_NAME];
  if (!token) throw app.httpErrors.unauthorized('Sessão expirada. Identifique-se novamente.');
  let decoded: unknown;
  try {
    decoded = await app.jwt.verify(token);
  } catch {
    throw app.httpErrors.unauthorized('Sessão inválida.');
  }
  const session = decoded as Partial<PdvClienteSessionPayload>;
  if (session.type !== 'cliente-pdv' || !session.cervejariaId || !session.pontoVendaId || !session.clienteId || !session.comandaId) {
    throw app.httpErrors.unauthorized('Sessão inválida.');
  }
  const comanda = await prisma.comanda.findFirst({
    where: { ...whereComandaOperacao(session.cervejariaId, { id: session.comandaId, status: 'ABERTA' }), clienteId: session.clienteId, pontoVendaId: session.pontoVendaId },
    include: INCLUDE_COMANDA_OPERACAO,
  });
  if (!comanda) throw app.httpErrors.unauthorized('Comanda encerrada. Identifique-se novamente.');
  return { session: session as PdvClienteSessionPayload, comanda };
}

async function summarizePdvClientComanda(comanda: Parameters<typeof resumoComanda>[0], cervejariaId: string) {
  const profile = await getOperationalProfile(cervejariaId);
  return resumoComanda(comanda, profile?.effectiveSettings.kitchenItemsChargeAtLaunch);
}



const pedidoItemSchema = z.object({

  produtoId: z.string(),

  volumeMl: z.number().int().positive(),

  quantidade: z.number().int().positive().default(1),

  tapId: z.string().optional(),

});



const createPedidoSchema = z.object({

  observacao: z.string().max(300).optional(),

  itens: z.array(pedidoItemSchema).min(1),

});



async function validatePedidoItens(

  eventoId: string,

  trailerId: string,

  cervejariaId: string,

  itens: z.infer<typeof pedidoItemSchema>[],

) {

  const cardapio = await buildPublicEventCardapio(eventoId, trailerId, cervejariaId);

  const chopeByTap = new Map(cardapio.chopes.map((c) => [c.tapId, c]));

  const unitById = new Map(

    [...cardapio.bebidas, ...cardapio.comidas].map((p) => [p.id, p]),

  );



  const normalized: {

    produtoId: string;

    volumeMl: number;

    quantidade: number;

    tapId: string | null;

    precoUnit: number;

  }[] = [];



  for (const item of itens) {

    if (item.tapId) {

      const chope = chopeByTap.get(item.tapId);

      if (!chope || chope.produto.id !== item.produtoId) {

        return { error: 'Chope ou tap inválido no cardápio' as const };

      }

      const preco = chope.produto.precos.find((p) => p.volumeMl === item.volumeMl);

      if (!preco) return { error: 'Volume inválido para este chope' as const };

      normalized.push({

        produtoId: item.produtoId,

        volumeMl: item.volumeMl,

        quantidade: item.quantidade,

        tapId: item.tapId,

        precoUnit: preco.preco,

      });

      continue;

    }



    const produto = unitById.get(item.produtoId);

    if (!produto) return { error: 'Item não disponível no cardápio' as const };

    const preco = produto.precos.find((p: { volumeMl: number }) => p.volumeMl === item.volumeMl);
    if (!preco) return { error: 'Volume inválido para este produto' as const };

    normalized.push({

      produtoId: item.produtoId,

      volumeMl: item.volumeMl,

      quantidade: item.quantidade,

      tapId: null,

      precoUnit: preco.preco,

    });

  }



  return { ok: true as const, itens: normalized };

}



export async function publicRoutes(app: FastifyInstance) {

  await app.register(rateLimit, {

    global: false,

    max: 10,

    timeWindow: '1 minute',

  });

  app.get('/dev/app-origin', async (_request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ error: 'Not found' });
    }

    return { origin: getDevFrontendOrigin() };
  });

  app.get('/cervejarias/:slug/info', async (request, reply) => {

    const { slug } = request.params as { slug: string };



    const cervejaria = await prisma.cervejaria.findFirst({

      where: { slug, ativo: true },

      select: {

        nome: true,

        slug: true,

        logoUrl: true,

        updatedAt: true,

        corPrimaria: true,

        corPaleta: true,

      },

    });



    if (!cervejaria) {

      return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    }



    return { ...cervejaria, logoVersion: resolveLogoVersion(cervejaria) };

  });



  app.get('/cervejarias/:slug/trailers/:trailerId/info', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Portal de evento descontinuado. Use o QR do ponto de venda (/c/:slug/p/:pontoVendaId).',
      code: 'PORTAL_EVENTO_DESCONTINUADO',
    });
  });

  app.get('/cervejarias/:slug/pontos-venda/:pontoVendaId/info', async (request, reply) => {
    const { slug, pontoVendaId } = request.params as { slug: string; pontoVendaId: string };
    const cervejaria = await prisma.cervejaria.findFirst({
      where: { slug, ativo: true },
      select: { id: true, nome: true, slug: true, logoUrl: true, updatedAt: true, portalBackgroundUrl: true },
    });
    if (!cervejaria) return reply.status(404).send({ error: 'Link inválido' });

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId: cervejaria.id, ativo: true },
      select: { id: true, nome: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Link inválido' });

    const dia = diaOperacional();
    const sessoes = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId: cervejaria.id, pontoVendaId, status: 'ABERTO' },
      select: { id: true },
      take: 2,
    });
    const sessao = resolveUniqueOpenCashSession(sessoes);
    return {
      cervejaria: {
        ...cervejaria,
        logoVersion: resolveLogoVersion(cervejaria),
        portalBackgroundUrl: cervejaria.portalBackgroundUrl ?? null,
      },
      pontoVenda,
      disponivel: Boolean(sessao),
    };
  });

  app.get('/cervejarias/:slug/pontos-venda/:pontoVendaId/cliente-por-telefone', {
    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { slug, pontoVendaId } = request.params as { slug: string; pontoVendaId: string };
    const query = telefoneQuerySchema.parse(request.query);
    const cervejaria = await prisma.cervejaria.findFirst({
      where: { slug, ativo: true },
      select: { id: true },
    });
    if (!cervejaria) return reply.status(404).send({ error: 'Link inválido' });
    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId: cervejaria.id, ativo: true },
      select: { id: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Link inválido' });
    const telefone = normalizePhone(query.telefone);
    if (!telefone) return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número.' });
    return lookupClientePortalPorTelefone(cervejaria.id, telefone);
  });

  app.get('/cervejarias/:slug/pontos-venda/:pontoVendaId/cardapio', async (request, reply) => {
    const { session, comanda } = await getPdvClienteSession(app, request);
    if (session.pontoVendaId !== (request.params as { pontoVendaId: string }).pontoVendaId) {
      return reply.status(403).send({ error: 'Sessão inválida para este ponto de venda' });
    }
    const profile = await getOperationalProfile(session.cervejariaId);
    const settings = await prisma.cervejaria.findUnique({ where: { id: session.cervejariaId }, select: { portalCategoriasPermitidas: true } });
    const allowed = Array.isArray(settings?.portalCategoriasPermitidas)
      ? settings.portalCategoriasPermitidas.filter((value): value is string => typeof value === 'string')
      : null;
    return buildPublicPdvCardapio({
      cervejariaId: session.cervejariaId,
      pontoVendaId: session.pontoVendaId,
      dia: comanda.diaOperacional ?? diaOperacional(),
      tapsEnabled: profile?.capabilities.taps ?? false,
      allowedCategories: allowed,
    });
  });

  app.get('/cervejarias/:slug/pontos-venda/:pontoVendaId/cardapio/categorias', async (request, reply) => {
    const { session } = await getPdvClienteSession(app, request);
    if (session.pontoVendaId !== (request.params as { pontoVendaId: string }).pontoVendaId) {
      return reply.status(403).send({ error: 'Sessão inválida para este ponto de venda' });
    }
    const profile = await getOperationalProfile(session.cervejariaId);
    const tapsEnabled = profile?.capabilities.taps ?? false;
    if (catalogoCategoriasCanonicoAtivo()) {
      const categories = await prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId: session.cervejariaId }, select: { nome: true }, orderBy: [{ nomeNormalizado: 'asc' }, { nome: 'asc' }] });
      const cervejaria = await prisma.cervejaria.findUnique({ where: { id: session.cervejariaId }, select: { operacaoCategoriasOrdem: true } });
      const config = cervejaria?.operacaoCategoriasOrdem;
      const raw = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).catalogo : config;
      const names = filtrarCategoriaChopeSeTapsDesligados(categories.map((category) => category.nome), tapsEnabled);
      const saved = Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && names.includes(name)) : [];
      return { ordemCategorias: [...new Set(saved), ...names.filter((name) => !saved.includes(name))], catalogoCanonico: true };
    }
    const cervejaria = await prisma.cervejaria.findUnique({
      where: { id: session.cervejariaId },
      select: { operacaoCategoriasOrdem: true },
    });
    return {
      ordemCategorias: normalizarOrdemCategoriasProduto(
        cervejaria?.operacaoCategoriasOrdem ?? CATEGORIAS_PRODUTO_OPERACAO,
        tapsEnabled,
      ),
      catalogoCanonico: false,
    };
  });

  app.get('/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda', async (request, reply) => {
    const { session, comanda } = await getPdvClienteSession(app, request);
    if (session.pontoVendaId !== (request.params as { pontoVendaId: string }).pontoVendaId) {
      return reply.status(403).send({ error: 'Sessão inválida para este ponto de venda' });
    }
    return summarizePdvClientComanda(comanda, session.cervejariaId);
  });

  app.post('/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/pedidos', async (request, reply) => {
    const { session } = await getPdvClienteSession(app, request);
    if (session.pontoVendaId !== (request.params as { pontoVendaId: string }).pontoVendaId) {
      return reply.status(403).send({ error: 'Sessão inválida para este ponto de venda' });
    }
    const body = pedidoPdvSchema.parse(request.body);
    const profile = await getOperationalProfile(session.cervejariaId);
    const temCozinha = profile?.capabilities.kitchen ?? false;
    const controlaEstoque = profile?.capabilities.inventory ?? false;
    let resultado;
    try {
    resultado = await prisma.$transaction(async (tx) => {
      // Existing sessions remain read-only after deactivation. Locking the client row
      // serializes this write with the administrative active=false update.
      const cliente = await tx.$queryRaw<Array<{ id: string; ativo: boolean }>>`
        SELECT "id", "ativo" FROM "Cliente"
        WHERE "id" = ${session.clienteId} AND "cervejariaId" = ${session.cervejariaId}
        FOR UPDATE
      `;
      if (!cliente[0]?.ativo) throw Object.assign(new ClientePortalInativoError(), { statusCode: 409 });
      await lockCaixaEmTx(tx, session.cervejariaId, session.pontoVendaId, diaOperacional());
      const sessao = await assertCaixaAberto(session.cervejariaId, session.pontoVendaId, diaOperacional(), tx);
      await lockComandaItemsInTx(tx, session.comandaId);
      const comanda = await tx.comanda.findFirst({
        where: { ...whereComandaOperacao(session.cervejariaId, { id: session.comandaId, status: 'ABERTA' }), clienteId: session.clienteId },
      });
      if (!comanda) throw Object.assign(new Error('Esta comanda já foi fechada'), { statusCode: 409 });
      assertCommandOccurrenceMatchesSession(comanda, sessao);
      if (body.idempotencyKey) await tx.portalPedidoOperacaoRequest.create({ data: {
        idempotencyKey: body.idempotencyKey,
        cervejariaId: session.cervejariaId,
        comandaId: session.comandaId,
      } });
      const itensComTap = await atribuirTapMontado(tx, sessao.id, body.itens);
      const settings = await tx.cervejaria.findUnique({ where: { id: session.cervejariaId }, select: { portalCategoriasPermitidas: true } });
      const allowed = Array.isArray(settings?.portalCategoriasPermitidas)
        ? settings.portalCategoriasPermitidas.filter((value): value is string => typeof value === 'string')
        : null;
      if (allowed !== null) {
        const produtos = await tx.produto.findMany({ where: { cervejariaId: session.cervejariaId, id: { in: [...new Set(body.itens.map((item) => item.produtoId))] }, ativo: true }, select: { id: true, categoria: true } });
        const categoriaById = new Map(produtos.map((produto) => [produto.id, produto.categoria]));
        if (body.itens.some((item) => !isPortalCategoryAllowed(categoriaById.get(item.produtoId), allowed))) {
          throw Object.assign(new Error('Este item nÃ£o estÃ¡ disponÃ­vel no portal do cliente'), { statusCode: 400 });
        }
      }
      const itens = await resolverItens(tx, session.cervejariaId, itensComTap, {
        sessaoCaixaId: sessao.id,
        tapsEnabled: profile?.capabilities.taps ?? false,
      });
      const pedidosCriados = await criarPedidos(tx, {
        cervejariaId: session.cervejariaId,
        comandaId: session.comandaId,
        pontoVendaId: session.pontoVendaId,
        dia: comanda.diaOperacional!,
        criadoPorId: `PORTAL:${session.clienteId}`,
        paraViagem: body.paraViagem,
        observacao: body.observacao,
        itens,
        temCozinha,
      });
      for (const { pedido, itens: itensPedido } of pedidosCriados) await inventoryService.consumeSale(tx, {
        context: 'CAIXA', moduleEnabled: controlaEstoque, cervejariaId: session.cervejariaId,
        pontoVendaId: session.pontoVendaId, pedidoId: pedido.id,
        registradoPorId: `PORTAL:${session.clienteId}`, items: itensPedido,
      });
      await recalcComandaTotalOperacao(tx, session.comandaId, { kitchenItemsChargeAtLaunch: profile?.effectiveSettings.kitchenItemsChargeAtLaunch });
      return {
        pedidos: pedidosCriados.map((item) => item.pedido),
        comanda: await tx.comanda.findUniqueOrThrow({ where: { id: session.comandaId }, include: INCLUDE_COMANDA_OPERACAO }),
      };
    }, CAIXA_VENDA_TX);
    } catch (error) {
      if (!body.idempotencyKey || !isUniqueViolation(error)) throw error;
      const previous = await prisma.portalPedidoOperacaoRequest.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (!previous || previous.cervejariaId !== session.cervejariaId || previous.comandaId !== session.comandaId) throw error;
      const comanda = await prisma.comanda.findFirst({ where: whereComandaOperacao(session.cervejariaId, { id: session.comandaId, status: 'ABERTA' }), include: INCLUDE_COMANDA_OPERACAO });
      if (!comanda) throw Object.assign(new Error('Esta comanda jÃ¡ foi fechada'), { statusCode: 409 });
      return reply.status(200).send(await summarizePdvClientComanda(comanda, session.cervejariaId));
    }
    for (const pedido of resultado.pedidos) {
      void registrarTransacao({
        cervejariaId: session.cervejariaId,
        tipo: 'PORTAL_PEDIDO_CRIADO',
        comandaId: session.comandaId,
        entidadeTipo: 'pedido_operacao',
        entidadeId: pedido.id,
        metadata: {
          origem: 'PORTAL_PDV',
          pontoVendaId: session.pontoVendaId,
          clienteId: session.clienteId,
          comandaId: session.comandaId,
        },
      });
    }
    // A tela geral de comandas precisa atualizar mesmo quando não há cozinha
    // habilitada para o perfil operacional.
    notificarComandaOperacaoAtualizada(app, session.cervejariaId, session.comandaId);
    if (temCozinha) for (const pedido of resultado.pedidos) await notificarPedidoNovo(app, session.cervejariaId, pedido);
    // Chope/itens sem preparo não entram na cozinha — avisa o balcão quem servir.
    await notificarAtendimentoBalcaoPortal(
      app,
      session.cervejariaId,
      session.comandaId,
      resultado.pedidos.map((pedido) => pedido.id),
    );
    return reply.status(201).send(resumoComanda(resultado.comanda, profile?.effectiveSettings.kitchenItemsChargeAtLaunch));
  });

  app.post('/cervejarias/:slug/pontos-venda/:pontoVendaId/comanda/solicitar-pagamento', async (request, reply) => {
    const { session } = await getPdvClienteSession(app, request);
    if (session.pontoVendaId !== (request.params as { pontoVendaId: string }).pontoVendaId) return reply.status(403).send({ error: 'SessÃ£o invÃ¡lida para este ponto de venda' });
    const requestedAt = new Date();
    const result = await prisma.comanda.updateMany({
      where: { ...whereComandaOperacao(session.cervejariaId, { id: session.comandaId, status: 'ABERTA' }), clienteId: session.clienteId, pontoVendaId: session.pontoVendaId, solicitacaoPagamentoEm: null },
      data: { solicitacaoPagamentoEm: requestedAt },
    });
    const comanda = await prisma.comanda.findFirst({ where: whereComandaOperacao(session.cervejariaId, { id: session.comandaId }), select: { id: true, solicitacaoPagamentoEm: true } });
    if (!comanda) return reply.status(404).send({ error: 'Comanda nÃ£o encontrada' });
    if (result.count > 0) {
      recordPaymentRequestTransition('requested', {
        cervejariaId: session.cervejariaId,
        comandaId: comanda.id,
        route: request.routeOptions.url ?? request.url.split('?')[0] ?? request.url,
        method: request.method,
        statusCode: 200,
      });
      notificarComandaOperacaoAtualizada(app, session.cervejariaId, comanda.id);
    }
    return { pendente: Boolean(comanda.solicitacaoPagamentoEm), solicitacaoPagamentoEm: comanda.solicitacaoPagamentoEm };
  });

  app.post('/cervejarias/:slug/pontos-venda/:pontoVendaId/comandas', {
    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { slug, pontoVendaId } = request.params as { slug: string; pontoVendaId: string };
    const body = abrirComandaPdvSchema.parse(request.body);
    const cervejaria = await prisma.cervejaria.findFirst({ where: { slug, ativo: true }, select: { id: true, nome: true } });
    if (!cervejaria) return reply.status(404).send({ error: 'Link inválido' });
    const pontoVenda = await prisma.pontoVenda.findFirst({ where: { id: pontoVendaId, cervejariaId: cervejaria.id, ativo: true }, select: { id: true, nome: true } });
    if (!pontoVenda) return reply.status(404).send({ error: 'Link inválido' });

    const telefone = normalizePhone(body.telefone);
    if (!telefone) return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número.' });
    const dia = diaOperacional();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const cliente = await registerClientePortalPdv(tx, { cervejariaId: cervejaria.id, nome: body.nome, telefone });
        await lockCaixaEmTx(tx, cervejaria.id, pontoVenda.id, dia);
        const sessao = await assertCaixaAberto(cervejaria.id, pontoVenda.id, dia, tx);
        const occurrenceScoped = cashOccurrenceContextEnabled();
        const existente = await tx.comanda.findFirst({ where: {
          origem: 'CAIXA', pontoVendaId: pontoVenda.id, clienteId: cliente.id, status: 'ABERTA',
          ...(occurrenceScoped ? { ocorrenciaId: sessao.ocorrenciaId ?? null } : {}),
        } });
        if (existente) return { clienteId: cliente.id, comanda: existente, reused: true };
        const numero = await proximoNumeroComandaOperacaoTurno(tx, cervejaria.id, pontoVenda.id, sessao.abertoEm);
        const comanda = await tx.comanda.create({ data: {
          origem: 'CAIXA', pontoVendaId: pontoVenda.id,
          sessaoCaixaRealizacaoId: sessao.id,
          ...(occurrenceScoped ? { ocorrenciaId: sessao.ocorrenciaId ?? null } : {}),
          clienteId: cliente.id, tipo: 'APELIDO', identificador: cliente.nome,
          numero, diaOperacional: sessao.diaOperacional, status: 'ABERTA', total: 0,
        } });
        return { clienteId: cliente.id, comanda, reused: false };
      });
      void registrarTransacao({ cervejariaId: cervejaria.id, tipo: 'COMANDA_CRIADA', comandaId: result.comanda.id, metadata: { origem: 'PORTAL_PDV', pontoVendaId, ocorrenciaId: result.comanda.ocorrenciaId ?? null, reused: result.reused }, payload: { numero: result.comanda.numero, identificador: result.comanda.identificador, ocorrenciaId: result.comanda.ocorrenciaId ?? null } });
      if (!result.reused) {
        emitToCervejaria(app.io, cervejaria.id, { type: 'comanda:created', data: result.comanda });
      }
      const token = app.jwt.sign({
        type: 'cliente-pdv',
        cervejariaId: cervejaria.id,
        pontoVendaId: pontoVenda.id,
        clienteId: result.clienteId,
        comandaId: result.comanda.id,
      } as PdvClienteSessionPayload, { expiresIn: '12h' });
      reply.setCookie(PDV_CLIENTE_COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 12 * 60 * 60,
      });
      const comanda = await prisma.comanda.findUniqueOrThrow({
        where: { id: result.comanda.id },
        include: INCLUDE_COMANDA_OPERACAO,
      });
      return reply.status(result.reused ? 200 : 201).send({
        comanda: await summarizePdvClientComanda(comanda, cervejaria.id),
        reused: result.reused,
        pontoVenda,
        cervejaria,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível abrir a comanda';
      // Mensagens de caixa são jargão da equipe — no portal do cliente usamos copy amigável.
      if (
        /Abra o caixa|Caixa não habilitado|Ponto de venda não encontrado/i.test(message)
      ) {
        return reply.status(503).send({
          error: 'No momento não estamos aberto. Volte mais tarde.',
          code: 'PORTAL_CAIXA_FECHADO',
        });
      }
      return reply.status(409).send({ error: message });
    }
  });



  app.get('/cervejarias/:slug/trailers/:trailerId/cliente-por-telefone', {
    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    return reply.status(410).send({
      error: 'Portal de evento descontinuado. Use o QR do ponto de venda (/c/:slug/p/:pontoVendaId).',
      code: 'PORTAL_EVENTO_DESCONTINUADO',
    });
  });

  app.post('/cervejarias/:slug/trailers/:trailerId/sessao', {
    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    return reply.status(410).send({
      error: 'Portal de evento descontinuado. Use o QR do ponto de venda (/c/:slug/p/:pontoVendaId).',
      code: 'PORTAL_EVENTO_DESCONTINUADO',
    });
  });



  app.post('/cliente/logout', async (_request, reply) => {

    clearClienteSessionCookie(reply);

    return reply.status(204).send();

  });



  app.register(async (clienteApp) => {

    clienteApp.addHook('preHandler', app.authenticateCliente);



    clienteApp.get('/cliente/comanda', async (request) => {

      const session = getClienteSession(request);

      return serializeComandaForCliente(session.comandaId);

    });

    clienteApp.get('/cliente/cardapio', async (request) => {

      const session = getClienteSession(request);

      let cardapio = await buildPublicEventCardapio(session.eventoId, session.trailerId, session.cervejariaId);
      if (!catalogoCategoriasCanonicoAtivo()) return cardapio;
      const categories = await prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId: session.cervejariaId }, select: { nome: true }, orderBy: [{ nomeNormalizado: 'asc' }, { nome: 'asc' }] });
      const brewery = await prisma.cervejaria.findUnique({ where: { id: session.cervejariaId }, select: { operacaoCategoriasOrdem: true } });
      const config = brewery?.operacaoCategoriasOrdem;
      const raw = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).catalogo : config;
      const names = categories.map((category) => category.nome);
      const saved = Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && names.includes(name)) : [];
      const order = [...new Set(saved), ...names.filter((name) => !saved.includes(name))];
      const priority = new Map(order.map((name, index) => [name, index]));
      const byCategory = <T extends { categoria?: string | null }>(items: T[]) => [...items].sort(
        (a, b) => (priority.get(a.categoria ?? '') ?? Number.MAX_SAFE_INTEGER) - (priority.get(b.categoria ?? '') ?? Number.MAX_SAFE_INTEGER),
      );
      return { ...cardapio, bebidas: byCategory(cardapio.bebidas), comidas: byCategory(cardapio.comidas), ordemCategorias: order };

    });



    clienteApp.get('/cliente/pedidos', async (request) => {

      const session = getClienteSession(request);

      const pedidos = await prisma.pedidoCliente.findMany({

        where: { comandaId: session.comandaId, clienteId: session.clienteId },

        include: pedidoInclude,

        orderBy: { createdAt: 'desc' },

      });

      return pedidos.map(serializePedido);

    });



    clienteApp.post('/cliente/pedidos', {

      config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },

    }, async (request, reply) => {

      const session = getClienteSession(request);

      const body = createPedidoSchema.parse(request.body);
      const evento = await prisma.evento.findFirst({

        where: { id: session.eventoId, status: 'ABERTO', cervejariaId: session.cervejariaId },

      });

      if (!evento) return reply.status(400).send({ error: 'Evento encerrado' });



      const comanda = await prisma.comanda.findFirst({

        where: { id: session.comandaId, status: 'ABERTA', clienteId: session.clienteId },

      });

      if (!comanda) return reply.status(400).send({ error: 'Comanda não está aberta' });



      const validated = await validatePedidoItens(

        session.eventoId,

        session.trailerId,

        session.cervejariaId,

        body.itens,

      );

      if ('error' in validated) return reply.status(400).send({ error: validated.error });



      const pedido = await prisma.pedidoCliente.create({

        data: {

          eventoId: session.eventoId,

          comandaId: session.comandaId,

          clienteId: session.clienteId,

          observacao: body.observacao?.trim() || null,

          itens: {

            create: validated.itens.map((i) => ({

              produtoId: i.produtoId,

              tapId: i.tapId,

              volumeMl: i.volumeMl,

              quantidade: i.quantidade,

              precoUnit: i.precoUnit,

            })),

          },

        },

        include: pedidoInclude,

      });



      emitToEvento(app.io, session.eventoId, { type: 'pedido:created', data: serializePedido(pedido) });

      const pendenteCount = await prisma.pedidoCliente.count({
        where: { eventoId: session.eventoId, status: 'PENDENTE' },
      });
      const resumoItens = pedido.itens
        .slice(0, 2)
        .map((item) => `${item.quantidade}x ${item.produto.nome}`)
        .join(', ');
      void notifyPedidoCreated(session.cervejariaId, {
        pedidoId: pedido.id,
        eventoId: session.eventoId,
        clienteNome: pedido.cliente?.nome ?? 'Cliente',
        resumoItens: resumoItens || 'Pedido pendente',
        pendenteCount,
      });

      void registrarTransacao({
        cervejariaId: session.cervejariaId,
        tipo: 'PORTAL_PEDIDO_CRIADO',
        eventoId: session.eventoId,
        comandaId: session.comandaId,
        entidadeTipo: 'pedido',
        entidadeId: pedido.id,
        metadata: {
          clienteId: session.clienteId,
          itemCount: pedido.itens.length,
          numero: pedido.comanda?.numero ?? null,
        },
        payload: serializePedido(pedido),
      });

      return reply.status(201).send(serializePedido(pedido));

    });



    clienteApp.post('/cliente/pedidos/:id/cancelar', async (request, reply) => {

      const session = getClienteSession(request);

      const { id } = request.params as { id: string };



      const pedido = await prisma.pedidoCliente.findFirst({

        where: {

          id,

          comandaId: session.comandaId,

          clienteId: session.clienteId,

          status: 'PENDENTE',

        },

      });

      if (!pedido) return reply.status(404).send({ error: 'Pedido não encontrado ou já processado' });



      const updated = await prisma.pedidoCliente.update({

        where: { id },

        data: { status: 'CANCELADO' },

        include: pedidoInclude,

      });



      const serialized = serializePedido(updated);

      emitToEvento(app.io, updated.eventoId, { type: 'pedido:cancelado', data: serialized });

      emitToComanda(app.io, updated.comandaId, {
        type: 'pedido:cancelado',
        data: { comandaId: updated.comandaId },
      });

      emitToCervejaria(app.io, session.cervejariaId, { type: 'pedido:cancelado', data: serialized });



      return serialized;

    });

  });

}


