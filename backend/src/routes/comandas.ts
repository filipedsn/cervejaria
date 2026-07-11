import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToEvento, emitRankingUpdated } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { isBebidaChope } from '../lib/produto-utils.js';
import { assertChopeAtivoNoTap } from '../lib/tap-montagem.js';
import { assertProdutoNoCardapioEvento } from '../lib/evento-cardapio.js';
import { isVendaUnitaria } from '../lib/produto-utils.js';
import { cancelarComandaVazia } from '../lib/comanda-cancelar.js';
import { resolveClienteParaComanda } from '../lib/cliente-resolver.js';
import { registrarTransacao } from '../lib/transacao-log.js';

const createComandaSchema = z.object({
  eventoId: z.string(),
  clienteNome: z.string().min(1),
  clienteTelefone: z.string().optional().nullable(),
});

const addItemSchema = z.object({
  produtoId: z.string(),
  volumeMl: z.number().int().positive(),
  quantidade: z.number().int().positive().default(1),
  tapId: z.string().optional(),
});

const comandaInclude = {
  cliente: true,
  itens: {
    include: { produto: true, tap: { select: { id: true, numero: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
};

async function recalcTotal(comandaId: string) {
  const itens = await prisma.itemComanda.findMany({ where: { comandaId } });
  const total = itens.reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
  return prisma.comanda.update({
    where: { id: comandaId },
    data: { total },
    include: comandaInclude,
  });
}

export async function comandasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };
    const { status } = request.query as { status?: 'ABERTA' | 'FECHADA' };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    return prisma.comanda.findMany({
      where: {
        eventoId,
        ...(status ? { status } : {}),
      },
      include: comandaInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  });

  app.post('/:id/itens', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = addItemSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
      include: { evento: { select: { id: true } } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, cervejariaId: user.cervejariaId, ativo: true },
      include: { precos: true },
    });
    if (!produto) return reply.status(400).send({ error: 'Produto inválido' });

    const isChope = isBebidaChope(produto.tipo, produto.formato);
    if (isChope) {
      if (!body.tapId) {
        return reply.status(400).send({ error: 'Informe o tap para venda de chope' });
      }
      const chopeNoTap = await assertChopeAtivoNoTap(comanda.eventoId, body.tapId, body.produtoId);
      if (!chopeNoTap) {
        return reply.status(400).send({ error: 'Este chope não está posicionado no tap selecionado' });
      }
    } else if (isVendaUnitaria(produto.tipo, produto.formato)) {
      const noCardapio = await assertProdutoNoCardapioEvento(comanda.eventoId, body.produtoId);
      if (!noCardapio) {
        return reply.status(400).send({ error: 'Este item não está no cardápio deste evento' });
      }
    }

    const preco = produto.precos.find((p) => p.volumeMl === body.volumeMl);
    if (!preco) return reply.status(400).send({ error: 'Preço não encontrado para este volume' });

    await prisma.itemComanda.create({
      data: {
        comandaId: id,
        produtoId: body.produtoId,
        tapId: isChope ? body.tapId : null,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        precoUnit: preco.preco,
      },
    });

    const updated = await recalcTotal(id);
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_ADICIONADO',
      usuarioId: user.sub,
      eventoId: comanda.eventoId,
      comandaId: id,
      entidadeTipo: 'Produto',
      entidadeId: body.produtoId,
      metadata: {
        produtoNome: produto.nome,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        precoUnit: toNumber(preco.preco),
        tapId: body.tapId ?? null,
      },
    });
    const chopeAfetado = isBebidaChope(produto.tipo, produto.formato);
    emitToEvento(app.io, comanda.eventoId, { type: 'item:added', data: updated });
    if (chopeAfetado) {
      emitRankingUpdated(app.io, user.cervejariaId!, comanda.eventoId);
    }
    return reply.status(201).send(updated);
  });

  app.delete('/:id/itens/:itemId', async (request, reply) => {
    const user = getAuthUser(request);
    const { id, itemId } = request.params as { id: string; itemId: string };

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const item = await prisma.itemComanda.findFirst({
      where: { id: itemId, comandaId: id },
      include: { produto: true },
    });
    if (!item) return reply.status(404).send({ error: 'Item não encontrado' });

    await prisma.itemComanda.delete({ where: { id: itemId } });
    const updated = await recalcTotal(id);
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_REMOVIDO',
      usuarioId: user.sub,
      eventoId: comanda.eventoId,
      comandaId: id,
      entidadeTipo: 'ItemComanda',
      entidadeId: itemId,
      metadata: {
        produtoNome: item.produto.nome,
        volumeMl: item.volumeMl,
        quantidade: item.quantidade,
        precoUnit: toNumber(item.precoUnit),
      },
    });
    const chopeAfetado = isBebidaChope(item.produto.tipo, item.produto.formato);
    emitToEvento(app.io, comanda.eventoId, { type: 'item:removed', data: updated });
    if (chopeAfetado) {
      emitRankingUpdated(app.io, user.cervejariaId!, comanda.eventoId);
    }
    return updated;
  });

  app.post('/:id/cancelar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const result = await cancelarComandaVazia({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      fechadoPorId: user.sub,
      motivo: 'manual',
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    emitToEvento(app.io, result.eventoId, { type: 'comanda:closed', data: result.comanda });
    return result.comanda;
  });

  app.get('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: {
        id,
        evento: { cervejariaId: user.cervejariaId },
      },
      include: comandaInclude,
    });

    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    return comanda;
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = createComandaSchema.parse(request.body);

    const evento = await prisma.evento.findFirst({
      where: { id: body.eventoId, cervejariaId: user.cervejariaId, status: 'ABERTO' },
    });
    if (!evento) return reply.status(400).send({ error: 'Evento não encontrado ou fechado' });

    const cliente = await resolveClienteParaComanda({
      cervejariaId: user.cervejariaId!,
      nome: body.clienteNome,
      telefone: body.clienteTelefone,
    });

    const comanda = await prisma.comanda.create({
      data: {
        eventoId: body.eventoId,
        clienteId: cliente.id,
      },
      include: comandaInclude,
    });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_CRIADA',
      usuarioId: user.sub,
      eventoId: body.eventoId,
      comandaId: comanda.id,
      metadata: {
        clienteNome: cliente.nome,
        clienteTelefone: cliente.telefone,
      },
    });

    emitToEvento(app.io, body.eventoId, { type: 'comanda:created', data: comanda });
    return reply.status(201).send(comanda);
  });
}
