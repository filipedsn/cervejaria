import type { FastifyInstance } from 'fastify';

import rateLimit from '@fastify/rate-limit';

import { z } from 'zod';

import { prisma } from '../lib/prisma.js';

import {
  lookupClientePortalPorTelefone,
  resolveTrailerPortalContext,
  startClientePortalSession,
} from '../lib/portal-cliente.js';
import { normalizePhone } from '../lib/phone.js';

import {

  getClienteSession,

  setClienteSessionCookie,

  clearClienteSessionCookie,

  signClienteSession,

} from '../lib/cliente-session.js';

import {

  buildPublicEventCardapio,

  serializeComandaForCliente,

  serializePedido,

  pedidoInclude,

} from '../lib/comanda-service.js';

import { emitToEvento, emitToComanda, emitToCervejaria } from '../lib/realtime.js';
import { notifyPedidoCreated } from '../lib/push-notifications.js';
import { registrarTransacao } from '../lib/transacao-log.js';

import { getDevFrontendOrigin } from '../lib/lan-url.js';



const PUBLIC_RATE_LIMIT_MAX =

  process.env.QA_MODE === '1'

    ? Number(process.env.QA_PUBLIC_RATE_LIMIT_MAX ?? 200)

    : 10;



const sessaoSchema = z.object({

  nome: z.string().min(2).max(120),

  telefone: z.string().min(10),

});

const telefoneQuerySchema = z.object({
  telefone: z.string().min(10),
});



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

    const preco = produto.precos.find((p) => p.volumeMl === item.volumeMl);

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

        corPrimaria: true,

        corPaleta: true,

      },

    });



    if (!cervejaria) {

      return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    }



    return cervejaria;

  });



  app.get('/cervejarias/:slug/trailers/:trailerId/info', async (request, reply) => {

    const { slug, trailerId } = request.params as { slug: string; trailerId: string };

    const ctx = await resolveTrailerPortalContext(slug, trailerId);

    if (!ctx) return reply.status(404).send({ error: 'Link inválido' });



    return {

      cervejaria: ctx.cervejaria,

      trailer: ctx.trailer,

      evento: ctx.evento,

      disponivel: !!ctx.evento,

    };

  });



  app.get('/cervejarias/:slug/trailers/:trailerId/cliente-por-telefone', {
    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { slug, trailerId } = request.params as { slug: string; trailerId: string };
    const query = telefoneQuerySchema.parse(request.query);

    const ctx = await resolveTrailerPortalContext(slug, trailerId);
    if (!ctx) return reply.status(404).send({ error: 'Link inválido' });

    const telefone = normalizePhone(query.telefone);
    if (!telefone) {
      return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).' });
    }

    return lookupClientePortalPorTelefone(ctx.cervejaria.id, telefone);
  });



  app.post('/cervejarias/:slug/trailers/:trailerId/sessao', {

    config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } },

  }, async (request, reply) => {

    const { slug, trailerId } = request.params as { slug: string; trailerId: string };

    const body = sessaoSchema.parse(request.body);



    const ctx = await resolveTrailerPortalContext(slug, trailerId);

    if (!ctx) return reply.status(404).send({ error: 'Link inválido' });

    if (!ctx.evento) {

      return reply.status(503).send({ error: 'Nenhum evento aberto neste trailer no momento' });

    }



    try {

      const { cliente, comanda, portalGeneration } = await startClientePortalSession({

        cervejariaId: ctx.cervejaria.id,

        eventoId: ctx.evento.id,

        trailerId: ctx.trailer.id,

        nome: body.nome,

        telefone: body.telefone,

      });



      const token = signClienteSession(app, {

        cervejariaId: ctx.cervejaria.id,

        eventoId: ctx.evento.id,

        trailerId: ctx.trailer.id,

        clienteId: cliente.id,

        comandaId: comanda.id,

        portalGeneration,

      });

      setClienteSessionCookie(reply, token);



      const comandaResumo = await serializeComandaForCliente(comanda.id);



      return reply.status(201).send({

        cliente: { id: cliente.id, nome: cliente.nome },

        evento: ctx.evento,

        trailer: ctx.trailer,

        cervejaria: { nome: ctx.cervejaria.nome, slug: ctx.cervejaria.slug, logoUrl: ctx.cervejaria.logoUrl },

        comanda: comandaResumo,

      });

    } catch (err) {

      const message = err instanceof Error ? err.message : 'Não foi possível iniciar sessão';

      return reply.status(400).send({ error: message });

    }

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

      return buildPublicEventCardapio(session.eventoId, session.trailerId, session.cervejariaId);

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
          numero: pedido.numero,
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


