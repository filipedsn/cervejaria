import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { allocatePagamentosToComandas, type PagamentoInput } from '../../lib/fechar-comanda.js';
import {
  centavos,
  criarPedido,
  diaOperacional,
  QUIOSQUE_VENDA_TX,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
  subtotalComandaEmCentavos,
} from '../../lib/quiosque/venda.js';
import {
  STATUS_NA_FILA,
  notificarPedidoNovo,
  notificarPedidosDaComanda,
  temPedidoCozinhaPendente,
} from '../../lib/quiosque/cozinha.js';
import { assertCaixaAberto, lockCaixaEmTx } from '../../lib/quiosque/caixa.js';
import { proximoNumeroComandaQuiosqueTurno } from '../../lib/comanda-numero.js';
import { assertPodeDarDescontoQuiosque, DescontoInvalidoError } from '../../lib/quiosque/desconto.js';
import { inventoryService } from '../../services/inventory-service.js';
import {
  removeItemFromComandaQuiosque,
  updateItemQuantidadeComandaQuiosque,
} from '../../lib/quiosque/comanda-itens.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import {
  INCLUDE_COMANDA_QUIOSQUE,
  fecharComandaQuiosqueInTx,
  recalcComandaTotalQuiosque,
  whereComandaQuiosque,
} from '../../lib/quiosque/comanda-adapter.js';
import { lockComandaItemsInTx, lockComandasInTx } from '../../lib/comanda-service.js';

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
  pagamentos: z.array(pagamentoSchema),
});

const descontoSchema = z.object({
  desconto: z.number().min(0),
});

const itemQuantidadeSchema = z.object({
  quantidade: z.number().int().positive().max(999),
});

const fecharGrupoSchema = z.object({
  comandaIds: z.array(z.string().min(1)).min(2),
  pagamentos: z.array(pagamentoSchema).min(1),
});

export async function comandasQuiosqueRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const { status, pontoVendaId, dia } = z
      .object({
        status: z.enum(['ABERTA', 'FECHADA', 'CANCELADA']).default('ABERTA'),
        pontoVendaId: z.string().optional(),
        dia: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query);

    const diaOperacionalFiltro = dia
      ? diaOperacional(new Date(`${dia}T12:00:00.000Z`))
      : undefined;

    const comandas = await prisma.comanda.findMany({
      where: whereComandaQuiosque(cervejariaId, {
        status,
        ...(pontoVendaId ? { pontoVendaId } : {}),
        ...(diaOperacionalFiltro ? { diaOperacional: diaOperacionalFiltro } : {}),
        ...(status === 'ABERTA' ? { tipo: { not: 'AVULSA' } } : {}),
      }),
      include: INCLUDE_COMANDA_QUIOSQUE,
      orderBy: { createdAt: 'asc' },
    });

    return comandas.map(resumoComanda);
  });

  app.post('/fechar-grupo', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const body = fecharGrupoSchema.parse(request.body);
    const uniqueIds = [...new Set(body.comandaIds)];
    if (uniqueIds.length !== body.comandaIds.length) {
      return reply.status(400).send({ error: 'Lista de comandas contém IDs duplicados' });
    }

    const comandas = await prisma.comanda.findMany({
      where: whereComandaQuiosque(cervejariaId, {
        id: { in: uniqueIds },
        status: 'ABERTA',
        tipo: { not: 'AVULSA' },
      }),
      include: INCLUDE_COMANDA_QUIOSQUE,
    });

    if (comandas.length !== uniqueIds.length) {
      return reply.status(404).send({
        error: 'Uma ou mais comandas não foram encontradas, já foram fechadas ou são avulsas',
      });
    }

    const pontoIds = new Set(comandas.map((c) => c.pontoVendaId));
    if (pontoIds.size !== 1) {
      return reply.status(400).send({ error: 'Todas as comandas devem ser do mesmo ponto de venda' });
    }

    const pontoVendaId = comandas[0]!.pontoVendaId!;
    const dia = comandas[0]!.diaOperacional!;
    await assertCaixaAberto(cervejariaId, pontoVendaId, dia);

    if (comandas.some((comanda) => temPedidoCozinhaPendente(comanda.pedidosQuiosque))) {
      return reply.status(409).send({
        error: 'Aguarde a entrega dos itens da cozinha antes de fechar as comandas',
      });
    }

    const resumos = comandas.map(resumoComanda);
    const comandasComItens = resumos.filter((c) => c.total > 0);
    const comandasVazias = resumos.filter((c) => {
      const comanda = comandas.find((item) => item.id === c.id)!;
      return c.total === 0 && !comanda.pedidosQuiosque.some((pedido) => pedido.status !== 'CANCELADO');
    });
    const totalGrupo = comandasComItens.reduce((sum, c) => sum + c.total, 0);
    const totalPagamentos = body.pagamentos.reduce((sum, p) => sum + p.valor, 0);

    if (totalGrupo > 0 && Math.abs(totalPagamentos - totalGrupo) > 0.01) {
      return reply.status(400).send({
        error: `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total do grupo (R$ ${totalGrupo.toFixed(2)})`,
      });
    }

    if (totalGrupo === 0 && totalPagamentos > 0.01) {
      return reply.status(400).send({ error: 'Comandas vazias não exigem pagamento' });
    }

    let allocation: Map<string, PagamentoInput[]>;
    try {
      allocation = allocatePagamentosToComandas(
        comandasComItens.map((c) => ({ id: c.id, total: c.total })),
        body.pagamentos,
      );
    } catch {
      return reply.status(400).send({ error: 'Falha ao alocar pagamentos entre comandas' });
    }

    const fechadaEm = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, pontoVendaId, dia);
      await assertCaixaAberto(cervejariaId, pontoVendaId, dia, tx);
      await lockComandasInTx(tx, uniqueIds);
      const fechadas = [];
      const canceladas = [];

      for (const resumo of comandasVazias) {
        const comanda = await tx.comanda.findUniqueOrThrow({
          where: { id: resumo.id },
          include: INCLUDE_COMANDA_QUIOSQUE,
        });
        if (comanda.status !== 'ABERTA' || comanda.itens.length > 0) {
          throw Object.assign(new Error('Uma ou mais comandas foram alteradas antes do fechamento'), { statusCode: 409 });
        }
        await inventoryService.reverseComanda(tx, {
          context: 'CAIXA',
          moduleEnabled: request.quiosque.controlaEstoque,
          cervejariaId,
          comandaId: comanda.id,
          registradoPorId: user.sub,
        });
        await tx.pedidoQuiosque.updateMany({
          where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
          data: { status: 'CANCELADO' },
        });
        const cancelada = await tx.comanda.update({
          where: { id: comanda.id },
          data: { status: 'CANCELADA', fechadaEm, fechadoPorId: user.sub },
          include: INCLUDE_COMANDA_QUIOSQUE,
        });
        canceladas.push(resumoComanda(cancelada));
      }

      for (const resumo of comandasComItens) {
        const pagamentosInput = allocation.get(resumo.id) ?? [];
        const pagamentos = resolverPagamentos(
          pagamentosInput as Parameters<typeof resolverPagamentos>[0],
          centavos(resumo.total),
        );
        const comandaCompleta = comandas.find((c) => c.id === resumo.id)!;
        await fecharComandaQuiosqueInTx(tx, {
          comanda: comandaCompleta,
          pagamentos,
          cervejariaId,
          usuarioId: user.sub,
          fechadaEm,
        });
        const fechada = await tx.comanda.findUniqueOrThrow({
          where: { id: resumo.id },
          include: INCLUDE_COMANDA_QUIOSQUE,
        });
        fechadas.push(resumoComanda(fechada));
      }

      return { fechadas, canceladas };
    });

    for (const c of resultado.canceladas) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'QUIOSQUE_COMANDA_CANCELADA',
        usuarioId: user.sub,
        comandaId: c.id,
        metadata: { identificador: c.identificador, grupo: true, motivo: 'vazia' },
        payload: c,
      });
    }

    for (const c of resultado.fechadas) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'QUIOSQUE_COMANDA_FECHADA',
        usuarioId: user.sub,
        comandaId: c.id,
        metadata: { total: c.total, grupo: true },
        payload: c,
      });
    }

    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_COMANDA_GRUPO_FECHADO',
      usuarioId: user.sub,
      metadata: {
        qtdComandas: resultado.fechadas.length,
        qtdCanceladas: resultado.canceladas.length,
        totalGrupo,
        comandaIds: uniqueIds,
      },
      payload: {
        comandasFechadas: resultado.fechadas,
        comandasCanceladas: resultado.canceladas,
        pagamentos: body.pagamentos,
        totalGrupo,
      },
    });

    return {
      comandas: resultado.fechadas,
      canceladas: resultado.canceladas,
      totalGrupo,
    };
  });

  app.get('/:id', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaQuiosque(cervejariaId, { id }),
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });

    return resumoComanda(comanda);
  });

  app.post('/', async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
    const user = getAuthUser(request);
    const body = abrirComandaSchema.parse(request.body);
    const dia = diaOperacional();

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: body.pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const resultado = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, body.pontoVendaId, dia);
      const sessao = await assertCaixaAberto(cervejariaId, body.pontoVendaId, dia, tx);
      const jaAberta = await tx.comanda.findFirst({
        where: whereComandaQuiosque(cervejariaId, {
          pontoVendaId: body.pontoVendaId,
          tipo: body.tipo,
          identificador: body.identificador,
          status: 'ABERTA',
        }),
      });
      if (jaAberta) return { kind: 'conflito' as const, jaAberta };

      const numero = await proximoNumeroComandaQuiosqueTurno(
        tx,
        cervejariaId,
        body.pontoVendaId,
        sessao.abertoEm,
      );
      const criada = await tx.comanda.create({
        data: {
          origem: 'QUIOSQUE',
          pontoVendaId: body.pontoVendaId,
          tipo: body.tipo,
          identificador: body.identificador,
          numero,
          diaOperacional: dia,
          abertaPorId: user.sub,
          status: 'ABERTA',
          total: 0,
        },
      });

      let pedidoCriado = null;
      if (body.itens.length > 0) {
        const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessao.id });
        pedidoCriado = await criarPedido(tx, {
          cervejariaId,
          comandaId: criada.id,
          pontoVendaId: body.pontoVendaId,
          dia,
          criadoPorId: user.sub,
          observacao: body.observacao,
          itens,
          temCozinha,
        });

        await inventoryService.consumeSale(tx, {
          context: 'CAIXA',
          moduleEnabled: controlaEstoque,
          cervejariaId,
          pontoVendaId: body.pontoVendaId,
          pedidoId: pedidoCriado.id,
          registradoPorId: user.sub,
          items: itens,
        });
        await recalcComandaTotalQuiosque(tx, criada.id);
      }

      return {
        kind: 'criada' as const,
        comanda: await tx.comanda.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA_QUIOSQUE,
        }),
        pedido: pedidoCriado,
      };
    }, QUIOSQUE_VENDA_TX);

    if (resultado.kind === 'conflito') {
      return reply.status(409).send({
        error: `Já existe uma comanda aberta para ${body.identificador}`,
        comandaId: resultado.jaAberta.id,
      });
    }

    const { comanda, pedido } = resultado;

    if (temCozinha && pedido) await notificarPedidoNovo(app, cervejariaId, pedido);

    const resumo = resumoComanda(comanda);
    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_COMANDA_CRIADA',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { identificador: body.identificador, tipo: body.tipo, numero: resumo.numero },
      payload: resumo,
    });

    if (pedido) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'QUIOSQUE_PEDIDO_CRIADO',
        usuarioId: user.sub,
        comandaId: comanda.id,
        entidadeId: pedido.id,
        metadata: { pedidoNumero: pedido.numero, qtdItens: body.itens.length, abertura: true },
        payload: { comanda: resumo, pedido, observacao: body.observacao ?? null },
      });
    }

    return reply.status(201).send(resumo);
  });

  app.post('/:id/pedidos', async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = adicionarPedidoSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaQuiosque(cervejariaId, { id }),
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const { atualizada, pedido } = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);
      const sessaoAtual = await assertCaixaAberto(
        cervejariaId,
        comanda.pontoVendaId!,
        comanda.diaOperacional!,
        tx,
      );
      await lockComandaItemsInTx(tx, id);
      const comandaAtual = await tx.comanda.findFirst({
        where: whereComandaQuiosque(cervejariaId, { id, status: 'ABERTA' }),
      });
      if (!comandaAtual) {
        throw Object.assign(new Error('Esta comanda já foi fechada'), { statusCode: 409 });
      }

      const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessaoAtual.id });
      const pedidoCriado = await criarPedido(tx, {
        cervejariaId,
        comandaId: comandaAtual.id,
        pontoVendaId: comandaAtual.pontoVendaId!,
        dia: comandaAtual.diaOperacional!,
        criadoPorId: user.sub,
        observacao: body.observacao,
        itens,
        temCozinha,
      });

      await inventoryService.consumeSale(tx, {
        context: 'CAIXA',
        moduleEnabled: controlaEstoque,
        cervejariaId,
        pontoVendaId: comandaAtual.pontoVendaId!,
        pedidoId: pedidoCriado.id,
        registradoPorId: user.sub,
        items: itens,
      });

      await recalcComandaTotalQuiosque(tx, comandaAtual.id);

      return {
        atualizada: await tx.comanda.findUniqueOrThrow({
          where: { id: comandaAtual.id },
          include: INCLUDE_COMANDA_QUIOSQUE,
        }),
        pedido: pedidoCriado,
      };
    }, QUIOSQUE_VENDA_TX);

    if (temCozinha) await notificarPedidoNovo(app, cervejariaId, pedido);

    const resumo = resumoComanda(atualizada);
    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_PEDIDO_CRIADO',
      usuarioId: user.sub,
      comandaId: comanda.id,
      entidadeId: pedido.id,
      metadata: { pedidoNumero: pedido.numero, qtdItens: body.itens.length },
      payload: { comanda: resumo, pedido, observacao: body.observacao ?? null },
    });

    return reply.status(201).send(resumo);
  });

  app.delete('/:comandaId/itens/:itemId', async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
    const user = getAuthUser(request);
    const { comandaId, itemId } = request.params as { comandaId: string; itemId: string };

    const result = await removeItemFromComandaQuiosque({
      app,
      cervejariaId,
      comandaId,
      itemId,
      registradoPorId: user.sub,
      moduloControlaEstoque: controlaEstoque,
      temCozinha,
    });

    if ('error' in result) {
      const status = result.error === 'Item não encontrado' ? 404 : 409;
      return reply.status(status).send({ error: result.error });
    }

    return result.comanda;
  });

  app.patch('/:comandaId/itens/:itemId', async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
    const user = getAuthUser(request);
    const { comandaId, itemId } = request.params as { comandaId: string; itemId: string };
    const body = itemQuantidadeSchema.parse(request.body);

    const result = await updateItemQuantidadeComandaQuiosque({
      app,
      cervejariaId,
      comandaId,
      itemId,
      quantidade: body.quantidade,
      registradoPorId: user.sub,
      moduloControlaEstoque: controlaEstoque,
      temCozinha,
    });

    if ('error' in result) {
      const status =
        result.error === 'Item não encontrado'
          ? 404
          : result.error === 'Informe uma quantidade válida'
            ? 400
            : (result.error?.includes('Estoque') ?? false)
              ? 400
              : 409;
      return reply.status(status).send({ error: result.error });
    }

    return result.comanda;
  });

  app.patch('/:id/desconto', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = descontoSchema.parse(request.body);

    await assertPodeDarDescontoQuiosque(user);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaQuiosque(cervejariaId, { id }),
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Só é possível alterar desconto em comanda aberta' });
    }
    if (comanda.tipo === 'AVULSA') {
      return reply.status(409).send({ error: 'Venda avulsa não permite desconto' });
    }

    const subtotalEmCents = subtotalComandaEmCentavos(comanda);
    const descontoEmCents = centavos(body.desconto);
    if (descontoEmCents > subtotalEmCents) {
      throw new DescontoInvalidoError('O desconto não pode ser maior que o subtotal da comanda');
    }

    const atualizada = await prisma.$transaction(async (tx) => {
      await lockComandaItemsInTx(tx, comanda.id);
      const comandaAtual = await tx.comanda.findFirst({
        where: whereComandaQuiosque(cervejariaId, { id: comanda.id, status: 'ABERTA' }),
        include: { itens: true },
      });
      if (!comandaAtual) {
        throw Object.assign(new Error('Só é possível alterar desconto em comanda aberta'), { statusCode: 409 });
      }
      if (comandaAtual.tipo === 'AVULSA') {
        throw Object.assign(new Error('Venda avulsa não permite desconto'), { statusCode: 409 });
      }
      const subtotalAtualEmCents = comandaAtual.itens.reduce(
        (sum, item) => sum + centavos(item.precoUnit) * item.quantidade,
        0,
      );
      if (descontoEmCents > subtotalAtualEmCents) {
        throw new DescontoInvalidoError('O desconto não pode ser maior que o subtotal da comanda');
      }
      await tx.comanda.update({
        where: { id: comanda.id },
        data: { desconto: body.desconto },
      });
      await recalcComandaTotalQuiosque(tx, comanda.id);
      return tx.comanda.findUniqueOrThrow({
        where: { id: comanda.id },
        include: INCLUDE_COMANDA_QUIOSQUE,
      });
    }, QUIOSQUE_VENDA_TX);

    const resumoAtualizado = resumoComanda(atualizada);
    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_DESCONTO_APLICADO',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { desconto: body.desconto, subtotal: resumoAtualizado.subtotal },
      payload: resumoAtualizado,
    });

    return resumoAtualizado;
  });

  app.post('/:id/pagamentos', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = pagarSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaQuiosque(cervejariaId, { id }),
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const resumo = resumoComanda(comanda);
    if (comanda.itens.length === 0) {
      return reply.status(409).send({ error: 'Lance ao menos um item antes de cobrar' });
    }

    if (temPedidoCozinhaPendente(comanda.pedidosQuiosque)) {
      return reply.status(409).send({
        error: 'Aguarde a entrega dos itens da cozinha antes de fechar a comanda',
      });
    }

    await assertCaixaAberto(cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);

    const totalEmCentavos = centavos(resumo.total);
    const pagamentos = resolverPagamentos(body.pagamentos, totalEmCentavos);

    const fechada = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);
      await assertCaixaAberto(cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!, tx);
      await fecharComandaQuiosqueInTx(tx, {
        comanda,
        pagamentos,
        cervejariaId,
        usuarioId: user.sub,
        fechadaEm: new Date(),
      });

      return tx.comanda.findUniqueOrThrow({
        where: { id: comanda.id },
        include: INCLUDE_COMANDA_QUIOSQUE,
      });
    }, QUIOSQUE_VENDA_TX);

    const resumoFechada = resumoComanda(fechada);

    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_PAGAMENTO_REGISTRADO',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: {
        pagamentos,
        total: resumoFechada.total,
      },
      payload: resumoFechada,
    });

    return resumoFechada;
  });

  app.post('/:id/cancelar', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.quiosque;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaQuiosque(cervejariaId, { id }),
      include: INCLUDE_COMANDA_QUIOSQUE,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }
    if (comanda.pagamentos.length > 0) {
      return reply.status(409).send({ error: 'Comanda com pagamento registrado não pode ser cancelada' });
    }

    const cancelada = await prisma.$transaction(async (tx) => {
      await inventoryService.reverseComanda(tx, {
        context: 'CAIXA',
        moduleEnabled: controlaEstoque,
        cervejariaId,
        comandaId: comanda.id,
        registradoPorId: user.sub,
      });

      // Sem isso a rodada continuaria na fila da cozinha de uma conta que nao existe mais.
      await tx.pedidoQuiosque.updateMany({
        where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
        data: { status: 'CANCELADO' },
      });

      return tx.comanda.update({
        where: { id: comanda.id },
        data: { status: 'CANCELADA', fechadaEm: new Date(), fechadoPorId: user.sub },
        include: INCLUDE_COMANDA_QUIOSQUE,
      });
    });

    if (temCozinha) await notificarPedidosDaComanda(app, cervejariaId, comanda.id);

    const resumoCancelada = resumoComanda(cancelada);
    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_COMANDA_CANCELADA',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { identificador: comanda.identificador },
      payload: resumoCancelada,
    });

    return resumoCancelada;
  });
}
