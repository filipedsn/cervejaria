import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  centavos,
  criarPedido,
  diaOperacional,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
} from '../../lib/quiosque/venda.js';
import {
  STATUS_NA_FILA,
  notificarPedidoNovo,
  notificarPedidosDaComanda,
} from '../../lib/quiosque/cozinha.js';

const itemSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().positive().max(999),
});

const pagamentoSchema = z.object({
  forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
  valor: z.number().positive(),
  valorRecebido: z.number().positive().optional(),
});

const abrirComandaSchema = z.object({
  pontoVendaId: z.string().min(1),
  tipo: z.enum(['APELIDO', 'MESA', 'FICHA']),
  identificador: z.string().trim().min(1).max(60),
  /** Itens ja no ato de abrir, para o atendente nao precisar de duas telas. */
  itens: z.array(itemSchema).default([]),
  observacao: z.string().trim().max(280).optional(),
});

const adicionarPedidoSchema = z.object({
  itens: z.array(itemSchema).min(1),
  observacao: z.string().trim().max(280).optional(),
});

const pagarSchema = z.object({
  pagamentos: z.array(pagamentoSchema).min(1),
});

const INCLUDE_COMANDA = {
  pedidos: { include: { itens: true }, orderBy: { numero: 'asc' } },
  pagamentos: { orderBy: { pagoEm: 'asc' } },
} as const;

export async function comandasQuiosqueRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const { status, pontoVendaId } = z
      .object({
        status: z.enum(['ABERTA', 'FECHADA', 'CANCELADA']).default('ABERTA'),
        pontoVendaId: z.string().optional(),
      })
      .parse(request.query);

    const comandas = await prisma.comandaQuiosque.findMany({
      where: {
        cervejariaId,
        status,
        ...(pontoVendaId ? { pontoVendaId } : {}),
        // A venda avulsa nasce fechada e polui a lista de contas em aberto.
        ...(status === 'ABERTA' ? { tipo: { not: 'AVULSA' } } : {}),
      },
      include: INCLUDE_COMANDA,
      orderBy: { createdAt: 'asc' },
    });

    return comandas.map(resumoComanda);
  });

  app.get('/:id', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };

    const comanda = await prisma.comandaQuiosque.findFirst({
      where: { id, cervejariaId },
      include: INCLUDE_COMANDA,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });

    return resumoComanda(comanda);
  });

  app.post('/', async (request, reply) => {
    const { cervejariaId, temCozinha } = request.quiosque;
    const user = getAuthUser(request);
    const body = abrirComandaSchema.parse(request.body);
    const dia = diaOperacional();

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: body.pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const jaAberta = await prisma.comandaQuiosque.findFirst({
      where: {
        cervejariaId,
        pontoVendaId: body.pontoVendaId,
        tipo: body.tipo,
        identificador: body.identificador,
        status: 'ABERTA',
      },
    });
    if (jaAberta) {
      return reply.status(409).send({
        error: `Já existe uma comanda aberta para ${body.identificador}`,
        comandaId: jaAberta.id,
      });
    }

    const { comanda, pedido } = await prisma.$transaction(async (tx) => {
      const criada = await tx.comandaQuiosque.create({
        data: {
          cervejariaId,
          pontoVendaId: body.pontoVendaId,
          tipo: body.tipo,
          identificador: body.identificador,
          diaOperacional: dia,
          abertaPorId: user.sub,
        },
      });

      let pedidoCriado = null;
      if (body.itens.length > 0) {
        const itens = await resolverItens(tx, cervejariaId, body.itens);
        pedidoCriado = await criarPedido(tx, {
          cervejariaId,
          comandaId: criada.id,
          pontoVendaId: body.pontoVendaId,
          dia,
          criadoPorId: user.sub,
          observacao: body.observacao,
          itens,
        });
      }

      return {
        comanda: await tx.comandaQuiosque.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA,
        }),
        pedido: pedidoCriado,
      };
    });

    if (temCozinha && pedido) await notificarPedidoNovo(app, cervejariaId, pedido);

    return reply.status(201).send(resumoComanda(comanda));
  });

  app.post('/:id/pedidos', async (request, reply) => {
    const { cervejariaId, temCozinha } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = adicionarPedidoSchema.parse(request.body);

    const comanda = await prisma.comandaQuiosque.findFirst({ where: { id, cervejariaId } });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const { atualizada, pedido } = await prisma.$transaction(async (tx) => {
      const itens = await resolverItens(tx, cervejariaId, body.itens);
      const pedidoCriado = await criarPedido(tx, {
        cervejariaId,
        comandaId: comanda.id,
        pontoVendaId: comanda.pontoVendaId,
        dia: comanda.diaOperacional,
        criadoPorId: user.sub,
        observacao: body.observacao,
        itens,
      });

      return {
        atualizada: await tx.comandaQuiosque.findUniqueOrThrow({
          where: { id: comanda.id },
          include: INCLUDE_COMANDA,
        }),
        pedido: pedidoCriado,
      };
    });

    if (temCozinha) await notificarPedidoNovo(app, cervejariaId, pedido);

    return reply.status(201).send(resumoComanda(atualizada));
  });

  app.post('/:id/pagamentos', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = pagarSchema.parse(request.body);

    const comanda = await prisma.comandaQuiosque.findFirst({
      where: { id, cervejariaId },
      include: INCLUDE_COMANDA,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const resumo = resumoComanda(comanda);
    if (resumo.total === 0) {
      return reply.status(409).send({ error: 'Lance ao menos um item antes de cobrar' });
    }

    const saldoEmCentavos = centavos(resumo.saldo);
    const pagamentos = resolverPagamentos(body.pagamentos, saldoEmCentavos);

    const fechada = await prisma.$transaction(async (tx) => {
      await tx.pagamentoQuiosque.createMany({
        data: pagamentos.map((pagamento) => ({
          comandaId: comanda.id,
          forma: pagamento.forma,
          valor: pagamento.valor,
          valorRecebido: pagamento.valorRecebido ?? null,
          troco: pagamento.troco,
          registradoPorId: user.sub,
        })),
      });

      await tx.comandaQuiosque.update({
        where: { id: comanda.id },
        data: { status: 'FECHADA', fechadaEm: new Date(), fechadaPorId: user.sub },
      });

      return tx.comandaQuiosque.findUniqueOrThrow({
        where: { id: comanda.id },
        include: INCLUDE_COMANDA,
      });
    });

    return resumoComanda(fechada);
  });

  app.post('/:id/cancelar', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId, temCozinha } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comandaQuiosque.findFirst({
      where: { id, cervejariaId },
      include: INCLUDE_COMANDA,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }
    if (comanda.pagamentos.length > 0) {
      return reply.status(409).send({ error: 'Comanda com pagamento registrado não pode ser cancelada' });
    }

    const cancelada = await prisma.$transaction(async (tx) => {
      // Sem isso a rodada continuaria na fila da cozinha de uma conta que nao existe mais.
      await tx.pedidoQuiosque.updateMany({
        where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
        data: { status: 'CANCELADO' },
      });

      return tx.comandaQuiosque.update({
        where: { id: comanda.id },
        data: { status: 'CANCELADA', fechadaEm: new Date(), fechadaPorId: user.sub },
        include: INCLUDE_COMANDA,
      });
    });

    if (temCozinha) await notificarPedidosDaComanda(app, cervejariaId, comanda.id);

    return resumoComanda(cancelada);
  });
}