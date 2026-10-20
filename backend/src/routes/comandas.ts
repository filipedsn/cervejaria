import type { FastifyInstance } from 'fastify';
import { registerLegacyWriteGuard } from '../lib/legacy-write-guard.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToComanda, emitToEvento, emitRankingUpdated } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { isBebidaChope } from '../lib/produto-utils.js';
import { cancelarComandaVazia } from '../lib/comanda-cancelar.js';
import { resolveClienteParaComanda, TelefoneConflitoError } from '../lib/cliente-resolver.js';
import { isTelefoneClienteAvulsoReservado } from '../lib/cliente-avulso.js';
import { normalizePhone } from '../lib/phone.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import { proximoNumeroComandaEvento } from '../lib/comanda-numero.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';
import {
  addItemToComandaInTx,
  addItemToComanda,
  aplicarDescontoComanda,
  comandaDetailInclude,
  lockComandaItemsInTx,
  removeItemFromComanda,
} from '../lib/comanda-service.js';
import { INCLUDE_PEDIDO_COZINHA, notificarCozinha } from '../lib/operacao/cozinha.js';

function eventoIdDaComanda(comanda: { eventoId: string | null }): string {
  if (!comanda.eventoId) throw new Error('Comanda sem evento associado');
  return comanda.eventoId;
}
import { assertPodeDarDescontoOperacao, DescontoInvalidoError } from '../lib/operacao/desconto.js';
import { requirePermissao } from '../lib/operacao/permissoes.js';

function comandaAbertaResponse(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  comandaId: string,
) {
  return reply.status(409).send({
    error: 'Este cliente já possui comanda aberta neste evento',
    comandaId,
  });
}

const createComandaSchema = z
  .object({
    eventoId: z.string(),
    clienteNome: z.string().min(1),
    clienteTelefone: z.string().optional(),
    clienteId: z.string().optional(),
  })
  .refine((data) => Boolean(data.clienteId || data.clienteTelefone?.trim()), {
    message: 'Informe o telefone ou selecione um cliente cadastrado',
  });

const addItemSchema = z.object({
  produtoId: z.string(),
  volumeMl: z.number().int().positive(),
  quantidade: z.number().int().positive().default(1),
  tapId: z.string().optional(),
  paraViagem: z.boolean().optional(),
  observacao: z.string().trim().max(280).optional(),
  opcionais: z.array(z.object({ opcionalId: z.string().min(1), quantidade: z.number().int().positive().max(99).optional() })).optional(),
});
const addItemsSchema = z.object({ itens: z.array(addItemSchema).min(1) });

const descontoSchema = z.object({
  desconto: z.number().min(0),
});

export async function comandasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  registerLegacyWriteGuard(app);

  app.post('/:id/solicitacao-pagamento/resolver', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const resolved = await prisma.comanda.updateMany({
      where: { id, solicitacaoPagamentoEm: { not: null }, evento: { cervejariaId: user.cervejariaId! } },
      data: { solicitacaoPagamentoEm: null },
    });
    if (!resolved.count) return reply.status(404).send({ error: 'Solicitacao pendente nao encontrada' });
    emitToComanda(app.io, id, { type: 'payment:request-resolved', data: { comandaId: id } });
    const comanda = await prisma.comanda.findFirst({ where: { id, evento: { cervejariaId: user.cervejariaId! } }, include: comandaDetailInclude });
    if (!comanda?.eventoId) return reply.status(404).send({ error: 'Comanda nao encontrada' });
    emitToEvento(app.io, comanda.eventoId!, { type: 'payment:request-resolved', data: { comandaId: id } });
    return comanda;
  });

  app.get('/evento/:eventoId', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };
    const { status } = request.query as { status?: 'ABERTA' | 'FECHADA' };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId! },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    return prisma.comanda.findMany({
      where: {
        eventoId,
        ...(status ? { status } : {}),
      },
      include: comandaDetailInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  });

  app.post('/:id/itens', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = addItemSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId! } },
      include: { evento: { select: { id: true } } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const result = await addItemToComanda({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      eventoId: eventoIdDaComanda(comanda),
      item: {
        produtoId: body.produtoId,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        tapId: body.tapId,
          paraViagem: body.paraViagem,
          observacao: body.observacao,
          opcionais: body.opcionais,
      },
      criadoPorId: user.sub,
    });

    if ('error' in result) {
      return reply.status(400).send({ error: result.error });
    }
    if (!('comanda' in result)) {
      return reply.status(400).send({ error: 'Falha ao adicionar item' });
    }

    const { comanda: updated, produto, isChope, precoUnit, pedidoCozinha } = result;
    if (pedidoCozinha) {
      const cozinha = await prisma.pedidoOperacao.findUnique({
        where: { id: pedidoCozinha.id },
        include: INCLUDE_PEDIDO_COZINHA,
      });
      if (cozinha) notificarCozinha(app, user.cervejariaId!, cozinha, true);
    }
    const eventoId = eventoIdDaComanda(comanda);
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_ADICIONADO',
      usuarioId: user.sub,
      eventoId,
      comandaId: id,
      entidadeTipo: 'Produto',
      entidadeId: body.produtoId,
      metadata: {
        produtoNome: produto.nome,
        volumeMl: body.volumeMl,
        quantidade: body.quantidade,
        precoUnit,
        tapId: body.tapId ?? null,
      },
      payload: updated,
    });
    emitToEvento(app.io, eventoId, { type: 'item:added', data: updated });
    emitToComanda(app.io, id, { type: 'item:added', data: { comandaId: id } });
    if (isChope) {
      emitRankingUpdated(app.io, user.cervejariaId!, eventoId);
    }
    return reply.status(201).send(updated);
  });

  app.post('/:id/itens/lancar', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = addItemsSchema.parse(request.body);

    const resultado = await prisma.$transaction(async (tx) => {
      await lockComandaItemsInTx(tx, id);
      const comanda = await tx.comanda.findFirst({
        where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId! } },
      });
      if (!comanda) throw Object.assign(new Error('Comanda não encontrada ou fechada'), { statusCode: 404 });

      const itensAdicionados: Array<{ produto: { id: string; nome: string }; precoUnit: number; isChope: boolean; pedidoCozinha: { id: string } | null; item: z.infer<typeof addItemSchema> }> = [];
      for (const item of body.itens) {
        const result = await addItemToComandaInTx(tx, {
          comandaId: id,
          cervejariaId: user.cervejariaId!,
          eventoId: eventoIdDaComanda(comanda),
          item,
          criadoPorId: user.sub,
        });
        if ('error' in result) throw Object.assign(new Error(result.error), { statusCode: 400 });
        itensAdicionados.push({ produto: result.produto, precoUnit: result.precoUnit, isChope: result.isChope, pedidoCozinha: result.pedidoCozinha, item });
      }

      const atualizada = await tx.comanda.findUniqueOrThrow({ where: { id }, include: comandaDetailInclude });
      return { eventoId: eventoIdDaComanda(comanda), atualizada, itensAdicionados };
    }, { maxWait: 15_000, timeout: 20_000 });

    for (const adicionado of resultado.itensAdicionados) {
      if (adicionado.pedidoCozinha) {
        const cozinha = await prisma.pedidoOperacao.findUnique({
          where: { id: adicionado.pedidoCozinha.id },
          include: INCLUDE_PEDIDO_COZINHA,
        });
        if (cozinha) notificarCozinha(app, user.cervejariaId!, cozinha, true);
      }
      await registrarTransacao({
        cervejariaId: user.cervejariaId!,
        tipo: 'COMANDA_ITEM_ADICIONADO',
        usuarioId: user.sub,
        eventoId: resultado.eventoId,
        comandaId: id,
        entidadeTipo: 'Produto',
        entidadeId: adicionado.item.produtoId,
        metadata: {
          produtoNome: adicionado.produto.nome,
          volumeMl: adicionado.item.volumeMl,
          quantidade: adicionado.item.quantidade,
          precoUnit: adicionado.precoUnit,
          tapId: adicionado.item.tapId ?? null,
        },
        payload: resultado.atualizada,
      });
    }
    emitToEvento(app.io, resultado.eventoId, { type: 'item:added', data: resultado.atualizada });
    emitToComanda(app.io, id, { type: 'item:added', data: { comandaId: id } });
    if (resultado.itensAdicionados.some((item) => item.isChope)) {
      emitRankingUpdated(app.io, user.cervejariaId!, resultado.eventoId);
    }
    return reply.status(201).send(resultado.atualizada);
  });

  app.delete('/:id/itens/:itemId', { preHandler: [requirePermissao(app, 'command.item.cancel')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id, itemId } = request.params as { id: string; itemId: string };

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId! } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou fechada' });

    const result = await removeItemFromComanda({
      comandaId: id,
      itemId,
      cervejariaId: user.cervejariaId!,
      eventoId: eventoIdDaComanda(comanda),
      registradoPorId: user.sub,
    });

    if ('error' in result) {
      return reply.status(404).send({ error: result.error });
    }

    const { comanda: updated, item, cancelamentoPendente } = result;
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_ITEM_REMOVIDO',
      usuarioId: user.sub,
      eventoId: eventoIdDaComanda(comanda),
      comandaId: id,
      entidadeTipo: 'ItemComanda',
      entidadeId: itemId,
      metadata: {
        produtoNome: item.produto!.nome,
        volumeMl: item.volumeMl,
        quantidade: item.quantidade,
        precoUnit: toNumber(item.precoUnit),
        cancelamentoPendente,
      },
      payload: { comanda: updated, itemRemovido: item },
    });
    const chopeAfetado = isBebidaChope(item.produto!.tipo, item.produto!.formato);
    const eventoId = eventoIdDaComanda(comanda);
    emitToEvento(app.io, eventoId, { type: 'item:removed', data: updated });
    if (cancelamentoPendente && item.pedidoCozinhaId) {
      const pedidoCozinha = await prisma.pedidoOperacao.findUnique({
        where: { id: item.pedidoCozinhaId },
        include: INCLUDE_PEDIDO_COZINHA,
      });
      if (pedidoCozinha) notificarCozinha(app, user.cervejariaId!, pedidoCozinha, false);
    }
    if (chopeAfetado) {
      emitRankingUpdated(app.io, user.cervejariaId!, eventoId);
    }
    return updated;
  });

  app.patch('/:id/desconto', { preHandler: [requirePermissao(app, 'discount.apply')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = descontoSchema.parse(request.body);

    try {
      await assertPodeDarDescontoOperacao(user);
    } catch (err) {
      if (err instanceof DescontoInvalidoError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    const result = await aplicarDescontoComanda({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      desconto: body.desconto,
    });

    if ('error' in result) {
      const status = result.error === 'Comanda não encontrada ou fechada' ? 404 : 409;
      return reply.status(status).send({ error: result.error });
    }

    const { comanda: updated, subtotal } = result;
    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'COMANDA_DESCONTO_APLICADO',
      usuarioId: user.sub,
      eventoId: eventoIdDaComanda(updated),
      comandaId: id,
      metadata: { desconto: body.desconto, subtotal },
      payload: updated,
    });

    emitToEvento(app.io, eventoIdDaComanda(updated), { type: 'comanda:updated', data: updated });
    return updated;
  });

  app.post('/:id/cancelar', { preHandler: [requirePermissao(app, 'command.cancel')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const result = await cancelarComandaVazia({
      comandaId: id,
      cervejariaId: user.cervejariaId!,
      fechadoPorId: user.sub,
      motivo: 'manual',
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    emitToEvento(app.io, result.eventoId!, { type: 'comanda:closed', data: result.comanda });
    return result.comanda;
  });

  app.get('/:id', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: {
        id,
        evento: { cervejariaId: user.cervejariaId! },
      },
      include: comandaDetailInclude,
    });

    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    return comanda;
  });

  app.post('/', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const body = createComandaSchema.parse(request.body);

    const evento = await prisma.evento.findFirst({
      where: { id: body.eventoId, cervejariaId: user.cervejariaId!, status: 'ABERTO' },
      select: { id: true, comandasContadorDesde: true },
    });
    if (!evento) return reply.status(400).send({ error: 'Evento não encontrado ou fechado' });

    const telefone = body.clienteTelefone ? normalizePhone(body.clienteTelefone) : null;
    if (body.clienteTelefone && !telefone) {
      return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).' });
    }
    if (telefone && isTelefoneClienteAvulsoReservado(telefone)) {
      return reply.status(400).send({ error: 'Telefone reservado pelo sistema' });
    }

    if (body.clienteId) {
      const clienteSelecionado = await prisma.cliente.findFirst({
        where: {
          id: body.clienteId,
          cervejariaId: user.cervejariaId!,
          isSistema: false,
          ativo: true,
        },
        select: { telefone: true },
      });
      if (!clienteSelecionado) {
        return reply.status(400).send({ error: 'Cliente não encontrado' });
      }
      if (!clienteSelecionado.telefone && !telefone) {
        return reply.status(400).send({
          error: 'Cliente sem telefone — informe o telefone para vincular ao cadastro',
        });
      }
    }

    let cliente;
    try {
      cliente = await resolveClienteParaComanda({
        cervejariaId: user.cervejariaId!,
        nome: body.clienteNome,
        ...(telefone ? { telefone } : {}),
        ...(body.clienteId ? { clienteId: body.clienteId } : {}),
      });
    } catch (err) {
      if (err instanceof TelefoneConflitoError) {
        return reply.status(409).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Dados do cliente inválidos';
      return reply.status(400).send({ error: message });
    }

    const comandaAberta = await prisma.comanda.findFirst({
      where: {
        eventoId: body.eventoId,
        clienteId: cliente.id,
        status: 'ABERTA',
      },
      select: { id: true },
    });
    if (comandaAberta) {
      return comandaAbertaResponse(reply, comandaAberta.id);
    }

    let comanda;
    try {
      comanda = await prisma.$transaction(async (tx) => {
        const numero = await proximoNumeroComandaEvento(tx, body.eventoId, evento.comandasContadorDesde);
        return tx.comanda.create({
          data: {
            eventoId: body.eventoId,
            clienteId: cliente.id,
            numero,
          },
          include: comandaDetailInclude,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const dup = await prisma.comanda.findFirst({
          where: {
            eventoId: body.eventoId,
            clienteId: cliente.id,
            status: 'ABERTA',
          },
          select: { id: true },
        });
        if (dup) return comandaAbertaResponse(reply, dup.id);
      }
      throw err;
    }

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
      payload: comanda,
    });

    emitToEvento(app.io, body.eventoId, { type: 'comanda:created', data: comanda });
    return reply.status(201).send(comanda);
  });
}
