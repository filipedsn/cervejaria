import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import { allocatePagamentosToComandas, type PagamentoInput } from '../../lib/fechar-comanda.js';
import {
  centavos,
  criarPedidos,
  diaOperacional,
  CAIXA_VENDA_TX,
  resolverItens,
  resolverPagamentos,
  resumoComanda,
  subtotalComandaEmCentavos,
} from '../../lib/operacao/venda.js';
import {
  STATUS_NA_FILA,
  notificarPedidoNovo,
  notificarPedidosDaComanda,
  notificarComandaOperacaoAtualizada,
  temPedidoCozinhaPendente,
} from '../../lib/operacao/cozinha.js';
import { assertCaixaAberto, lockCaixaEmTx } from '../../lib/operacao/caixa.js';
import { proximoNumeroComandaOperacaoTurno } from '../../lib/comanda-numero.js';
import { assertPodeDarDescontoOperacao, DescontoInvalidoError } from '../../lib/operacao/desconto.js';
import { inventoryService } from '../../services/inventory-service.js';
import {
  removeItemFromComandaOperacao,
  updateItemQuantidadeComandaOperacao,
} from '../../lib/operacao/comanda-itens.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordPaymentRequestTransition } from '../../lib/payment-request-observability.js';
import {
  INCLUDE_COMANDA_OPERACAO,
  fecharComandaOperacaoInTx,
  recalcComandaTotalOperacao,
  whereComandaOperacao,
} from '../../lib/operacao/comanda-adapter.js';
import { lockComandaItemsInTx, lockComandasInTx } from '../../lib/comanda-service.js';
import { resolveClienteParaComanda, TelefoneConflitoError } from '../../lib/cliente-resolver.js';
import { normalizePhone } from '../../lib/phone.js';
import { assertCommandOccurrenceMatchesSession, cashOccurrenceContextEnabled } from '../../lib/operacao/contexto-ocorrencia.js';
import { requireFechamentoGrupo, requirePermissao, requirePermissaoOuDono, requirePermissaoQuantidadeItem } from '../../lib/operacao/permissoes.js';

const itemSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().positive().max(999),
  tapId: z.string().min(1).optional(),
  volumeMl: z.number().int().positive().optional(),
  paraViagem: z.boolean().default(false),
  observacao: z.string().trim().max(280).optional(),
  opcionais: z.array(z.object({ opcionalId: z.string().min(1), quantidade: z.number().int().positive().max(99).optional() })).optional(),
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
  clienteId: z.string().min(1).optional(),
  clienteNome: z.string().trim().min(1).max(120).optional(),
  clienteTelefone: z.string().optional(),
  paraViagem: z.boolean().default(false),
  observacao: z.string().trim().max(280).optional(),
  ocorrenciaId: z.never().optional(),
});

const adicionarPedidoSchema = z.object({
  itens: z.array(itemSchema).min(1),
  paraViagem: z.boolean().default(false),
  observacao: z.string().trim().max(280).optional(),
  ocorrenciaId: z.never().optional(),
});

const pagarSchema = z.object({
  pagamentos: z.array(pagamentoSchema).default([]),
  deixarPendente: z.boolean().default(false),
});

const descontoSchema = z.object({
  desconto: z.number().min(0),
});

const itemQuantidadeSchema = z.object({
  quantidade: z.number().int().positive().max(999),
});

const cancelarItemSchema = z.object({
  quantidade: z.number().int().positive().max(999).optional(),
  quantidadeEsperada: z.number().int().positive().max(999).optional(),
  motivo: z.string().trim().min(3).max(500).optional(),
  tratamentoEstoque: z.enum(['ERRO_LANCAMENTO', 'PREPARADO_ENTREGUE_OU_PERDIDO']).optional(),
  idempotencyKey: z.string().uuid().optional(),
}).default({});

const clienteSchema = z.object({ clienteId: z.string().min(1).nullable() });

const fecharGrupoSchema = z.object({
  comandaIds: z.array(z.string().min(1)).min(2),
  pagamentos: z.array(pagamentoSchema).min(1),
});

export async function comandasOperacaoRoutes(app: FastifyInstance) {
  app.delete('/:id/solicitacao-pagamento', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await prisma.comanda.updateMany({
      where: whereComandaOperacao(cervejariaId, { id, status: 'ABERTA', solicitacaoPagamentoEm: { not: null } }),
      data: { solicitacaoPagamentoEm: null },
    });
    if (!result.count) return reply.status(404).send({ error: 'SolicitaÃ§Ã£o pendente nÃ£o encontrada' });
    recordPaymentRequestTransition('resolved', {
      cervejariaId,
      comandaId: id,
      route: request.routeOptions.url ?? request.url.split('?')[0] ?? request.url,
      method: request.method,
      statusCode: 200,
    });
    notificarComandaOperacaoAtualizada(app, cervejariaId, id);
    return { ok: true };
  });

  app.get('/', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { status, pontoVendaId, dia, sessaoCaixaId } = z
      .object({
        status: z.enum(['ABERTA', 'FECHADA', 'CANCELADA']).default('ABERTA'),
        pontoVendaId: z.string().optional(),
        dia: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        sessaoCaixaId: z.string().min(1).optional(),
      })
      .superRefine((query, context) => {
        if (query.sessaoCaixaId && !query.pontoVendaId) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'pontoVendaId é obrigatório com sessaoCaixaId', path: ['pontoVendaId'] });
        }
      })
      .parse(request.query);

    let filtroSessao: Prisma.ComandaWhereInput | undefined;
    if (sessaoCaixaId) {
      const sessao = await prisma.sessaoCaixaOperacao.findFirst({
        where: { id: sessaoCaixaId, cervejariaId, pontoVendaId },
        select: { id: true, diaOperacional: true, abertoEm: true },
      });
      if (!sessao) return reply.status(404).send({ error: 'Sessão de caixa não encontrada neste ponto de venda' });

      const associacoes: Prisma.ComandaWhereInput[] = request.operacao.effectiveSettings.source === 'CANONICAL_PDV'
        ? [{ sessaoCaixaRealizacaoId: sessao.id }]
        : [];
      if (request.operacao.effectiveSettings.source === 'LEGACY') {
        // Compatibility only: older LEGACY rows may lack both explicit links.
        // This mirrors the pre-existing day/turn-time view; it cannot prove which
        // shift owns an unlinked row when multiple shifts share an operational day.
        associacoes.push({
          AND: [
            { diaOperacional: sessao.diaOperacional },
            status === 'ABERTA'
              ? { createdAt: { gte: sessao.abertoEm } }
              : { fechadaEm: { gte: sessao.abertoEm } },
          ],
        });
      }
      filtroSessao = { OR: associacoes };
    }

    const diaOperacionalFiltro = dia
      ? diaOperacional(new Date(`${dia}T12:00:00.000Z`))
      : undefined;

    const comandas = await prisma.comanda.findMany({
      where: whereComandaOperacao(cervejariaId, {
        status,
        ...(pontoVendaId ? { pontoVendaId } : {}),
        ...(diaOperacionalFiltro ? { diaOperacional: diaOperacionalFiltro } : {}),
        ...(filtroSessao ? { AND: [filtroSessao] } : {}),
        ...(status === 'ABERTA' ? { tipo: { not: 'AVULSA' } } : {}),
      }),
      include: INCLUDE_COMANDA_OPERACAO,
      orderBy: { createdAt: 'asc' },
    });

    return comandas.map((comanda) => resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch));
  });

  app.post('/fechar-grupo', { preHandler: [requireFechamentoGrupo(app)] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = fecharGrupoSchema.parse(request.body);
    const uniqueIds = [...new Set(body.comandaIds)];
    if (uniqueIds.length !== body.comandaIds.length) {
      return reply.status(400).send({ error: 'Lista de comandas contém IDs duplicados' });
    }

    const comandas = await prisma.comanda.findMany({
      where: whereComandaOperacao(cervejariaId, {
        id: { in: uniqueIds },
        status: 'ABERTA',
        tipo: { not: 'AVULSA' },
      }),
      include: INCLUDE_COMANDA_OPERACAO,
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

    const allowCloseWithPendingKitchen = request.operacao.effectiveSettings;
    if (
      !(allowCloseWithPendingKitchen?.allowCloseComandaWithPendingKitchenOrders && allowCloseWithPendingKitchen.kitchenItemsChargeAtLaunch) &&
      comandas.some((comanda) => temPedidoCozinhaPendente(comanda.pedidosOperacao))
    ) {
      return reply.status(409).send({
        error: 'Aguarde a entrega dos itens da cozinha antes de fechar as comandas',
      });
    }

    const resumos = comandas.map((comanda) => resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch));
    const comandasComItens = resumos.filter((c) => c.total > 0);
    const comandasVazias = resumos.filter((c) => {
      const comanda = comandas.find((item) => item.id === c.id)!;
      return c.total === 0 && !comanda.pedidosOperacao.some((pedido) => pedido.status !== 'CANCELADO');
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
      const sessao = await assertCaixaAberto(cervejariaId, pontoVendaId, dia, tx);
      await lockComandasInTx(tx, uniqueIds);
      const fechadas = [];
      const canceladas = [];

      for (const resumo of comandasVazias) {
        const comanda = await tx.comanda.findUniqueOrThrow({
          where: { id: resumo.id },
          include: INCLUDE_COMANDA_OPERACAO,
        });
        assertCommandOccurrenceMatchesSession(comanda, sessao);
        if (comanda.status !== 'ABERTA' || comanda.itens.length > 0) {
          throw Object.assign(new Error('Uma ou mais comandas foram alteradas antes do fechamento'), { statusCode: 409 });
        }
        await inventoryService.reverseComanda(tx, {
          context: 'CAIXA',
          moduleEnabled: request.operacao.controlaEstoque,
          cervejariaId,
          comandaId: comanda.id,
          registradoPorId: user.sub,
        });
        const pedidosParaCancelar = await tx.pedidoOperacao.findMany({
          where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
          select: { id: true },
        });
        await tx.pedidoOperacao.updateMany({
          where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
          data: { status: 'CANCELAMENTO_PENDENTE' },
        });
        if (pedidosParaCancelar.length) {
          await tx.pedidoOperacaoStatusHistorico.createMany({
            data: pedidosParaCancelar.map(({ id }) => ({ pedidoId: id, status: 'CANCELAMENTO_PENDENTE' })),
          });
        }
        const cancelada = await tx.comanda.update({
          where: { id: comanda.id },
          data: { status: 'CANCELADA', fechadaEm, fechadoPorId: user.sub },
          include: INCLUDE_COMANDA_OPERACAO,
        });
        canceladas.push(resumoComanda(cancelada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch));
      }

      for (const resumo of comandasComItens) {
        const pagamentosInput = allocation.get(resumo.id) ?? [];
        const pagamentos = resolverPagamentos(
          pagamentosInput as Parameters<typeof resolverPagamentos>[0],
          centavos(resumo.total),
        );
        const comandaCompleta = comandas.find((c) => c.id === resumo.id)!;
        assertCommandOccurrenceMatchesSession(comandaCompleta, sessao);
        await fecharComandaOperacaoInTx(tx, {
          comanda: comandaCompleta,
          pagamentos,
          cervejariaId,
          usuarioId: user.sub,
          fechadaEm,
          sessaoCaixaId: sessao.id,
          kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch,
        });
        const fechada = await tx.comanda.findUniqueOrThrow({
          where: { id: resumo.id },
          include: INCLUDE_COMANDA_OPERACAO,
        });
        fechadas.push(resumoComanda(fechada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch));
      }

      return { fechadas, canceladas };
    });

    for (const c of resultado.canceladas) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'COMANDA_CANCELADA',
        usuarioId: user.sub,
        comandaId: c.id,
        metadata: { identificador: c.identificador, grupo: true, motivo: 'vazia' },
        payload: c,
      });
    }

    for (const c of resultado.fechadas) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'COMANDA_FECHADA',
        usuarioId: user.sub,
        comandaId: c.id,
        metadata: { total: c.total, grupo: true },
        payload: c,
      });
    }

    void registrarTransacao({
      cervejariaId,
      tipo: 'COMANDA_GRUPO_FECHADO',
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

    for (const c of [...resultado.fechadas, ...resultado.canceladas]) notificarComandaOperacaoAtualizada(app, cervejariaId, c.id);

    return {
      comandas: resultado.fechadas,
      canceladas: resultado.canceladas,
      totalGrupo,
    };
  });

  app.get('/:id', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id }),
      include: INCLUDE_COMANDA_OPERACAO,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });

    return resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
  });

  app.patch('/:id/pedidos/:pedidoId/cliente-avisado', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id: comandaId, pedidoId } = request.params as { id: string; pedidoId: string };
    const configuracao = request.operacao.effectiveSettings;
    if (!configuracao?.whatsappPedidoProntoEnabled || configuracao.whatsappPedidoProntoNaCozinha) {
      return reply.status(409).send({ error: 'O aviso pelo WhatsApp não está configurado para a comanda.' });
    }

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id: comandaId, status: 'ABERTA' }),
      select: { id: true, cliente: { select: { telefone: true } } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada.' });
    if (!comanda.cliente?.telefone) {
      return reply.status(409).send({ error: 'Associe um cliente com telefone antes de marcar o aviso.' });
    }

    const agora = new Date();
    const atualizado = await prisma.pedidoOperacao.updateMany({
      where: {
        id: pedidoId,
        comandaId,
        cervejariaId,
        status: 'PRONTO',
        clienteAvisadoEm: null,
        itensComanda: {
          some: {
            exigePreparo: true,
            cancelamentoPendenteEm: null,
            canceladoEm: null,
          },
        },
      },
      data: { clienteAvisadoEm: agora },
    });
    if (atualizado.count === 0) {
      const pedidoAtual = await prisma.pedidoOperacao.findFirst({
        where: { id: pedidoId, comandaId, cervejariaId, status: 'PRONTO' },
        select: { clienteAvisadoEm: true },
      });
      if (!pedidoAtual) return reply.status(409).send({ error: 'Este pedido não está mais pronto.' });
      if (!pedidoAtual.clienteAvisadoEm) return reply.status(409).send({ error: 'Não foi possível atualizar o aviso.' });
      return { clienteAvisadoEm: pedidoAtual.clienteAvisadoEm };
    }

    notificarComandaOperacaoAtualizada(app, cervejariaId, comandaId);
    return { clienteAvisadoEm: agora };
  });

  app.patch('/:id/cliente', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { id } = request.params as { id: string };
    const body = clienteSchema.parse(request.body);
    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id, status: 'ABERTA' }),
      select: { id: true },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada' });

    if (body.clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: body.clienteId, cervejariaId, ativo: true, isSistema: false },
        select: { id: true },
      });
      if (!cliente) return reply.status(404).send({ error: 'Cliente não encontrado' });
    }

    const atualizada = await prisma.comanda.update({
      where: { id: comanda.id },
      data: { clienteId: body.clienteId },
      include: INCLUDE_COMANDA_OPERACAO,
    });
    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);
    return resumoComanda(atualizada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
  });

  app.post('/', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque, tapsEnabled } = request.operacao;
    const user = getAuthUser(request);
    const body = abrirComandaSchema.parse(request.body);
    const dia = diaOperacional();

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: body.pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    let clienteResolvido: { id: string } | null = null;
    if (body.clienteNome || body.clienteId) {
      const telefone = body.clienteTelefone ? normalizePhone(body.clienteTelefone) : null;
      if (body.clienteTelefone && !telefone) {
        return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).' });
      }
      try {
        const cliente = await resolveClienteParaComanda({
          cervejariaId,
          nome: body.clienteNome ?? 'Cliente',
          ...(telefone ? { telefone } : {}),
          ...(body.clienteId ? { clienteId: body.clienteId } : {}),
          cadastradoVia: 'COMANDA',
        });
        clienteResolvido = { id: cliente.id };
      } catch (err) {
        if (err instanceof TelefoneConflitoError) return reply.status(409).send({ error: err.message });
        return reply.status(400).send({ error: err instanceof Error ? err.message : 'Dados do cliente inválidos' });
      }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, body.pontoVendaId, dia);
      const sessao = await assertCaixaAberto(cervejariaId, body.pontoVendaId, dia, tx);
      const diaTurno = sessao.diaOperacional;
      const occurrenceScoped = cashOccurrenceContextEnabled();
      const jaAberta = await tx.comanda.findFirst({
        where: whereComandaOperacao(cervejariaId, {
          pontoVendaId: body.pontoVendaId,
          tipo: body.tipo,
          identificador: body.identificador,
          status: 'ABERTA',
          ...(occurrenceScoped ? { ocorrenciaId: sessao.ocorrenciaId ?? null } : {}),
        }),
      });
      if (jaAberta) return { kind: 'conflito' as const, jaAberta };

      const numero = await proximoNumeroComandaOperacaoTurno(
        tx,
        cervejariaId,
        body.pontoVendaId,
        sessao.abertoEm,
      );
      const criada = await tx.comanda.create({
        data: {
          origem: 'CAIXA',
          pontoVendaId: body.pontoVendaId,
          ...(request.operacao.effectiveSettings.source === 'CANONICAL_PDV' ? { sessaoCaixaRealizacaoId: sessao.id } : {}),
          ...(occurrenceScoped ? { ocorrenciaId: sessao.ocorrenciaId ?? null } : {}),
          tipo: body.tipo,
          identificador: body.identificador,
          ...(clienteResolvido ? { clienteId: clienteResolvido.id } : {}),
          numero,
          diaOperacional: diaTurno,
          abertaPorId: user.sub,
          status: 'ABERTA',
          total: 0,
        },
      });

      let pedidosCriados: Awaited<ReturnType<typeof criarPedidos>> = [];
      if (body.itens.length > 0) {
        const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessao.id, tapsEnabled });
        pedidosCriados = await criarPedidos(tx, {
          cervejariaId,
          comandaId: criada.id,
          pontoVendaId: body.pontoVendaId,
          dia: diaTurno,
          criadoPorId: user.sub,
          paraViagem: body.paraViagem,
          observacao: body.observacao,
          itens,
          temCozinha,
        });

        for (const { pedido, itens: itensPedido } of pedidosCriados) await inventoryService.consumeSale(tx, {
          context: 'CAIXA', moduleEnabled: controlaEstoque, cervejariaId,
          pontoVendaId: body.pontoVendaId, pedidoId: pedido.id, registradoPorId: user.sub, items: itensPedido,
        });
        await recalcComandaTotalOperacao(tx, criada.id, { kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch });
      }

      return {
        kind: 'criada' as const,
        comanda: await tx.comanda.findUniqueOrThrow({
          where: { id: criada.id },
          include: INCLUDE_COMANDA_OPERACAO,
        }),
        pedidos: pedidosCriados.map((item) => item.pedido),
      };
    }, CAIXA_VENDA_TX);

    if (resultado.kind === 'conflito') {
      return reply.status(409).send({
        error: `Já existe uma comanda aberta para ${body.identificador}`,
        comandaId: resultado.jaAberta.id,
      });
    }

    const { comanda, pedidos } = resultado;

    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);
    if (temCozinha) for (const pedido of pedidos) await notificarPedidoNovo(app, cervejariaId, pedido);

    const resumo = resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    void registrarTransacao({
      cervejariaId,
      tipo: 'COMANDA_CRIADA',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { identificador: body.identificador, tipo: body.tipo, numero: resumo.numero },
      payload: resumo,
    });

    for (const pedido of pedidos) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'KITCHEN_ORDER_CREATED',
        usuarioId: user.sub,
        comandaId: comanda.id,
        entidadeId: pedido.id,
        metadata: { pedidoNumero: pedido.numero, qtdItens: body.itens.length, abertura: true },
        payload: { comanda: resumo, pedido, observacao: body.observacao ?? null },
      });
    }

    return reply.status(201).send(resumo);
  });

  app.post('/:id/pedidos', { preHandler: [requirePermissao(app, 'command.operate')] }, async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque, tapsEnabled } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = adicionarPedidoSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id }),
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const { atualizada, pedidos } = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);
      const sessaoAtual = await assertCaixaAberto(
        cervejariaId,
        comanda.pontoVendaId!,
        comanda.diaOperacional!,
        tx,
      );
      await lockComandaItemsInTx(tx, id);
      const comandaAtual = await tx.comanda.findFirst({
        where: whereComandaOperacao(cervejariaId, { id, status: 'ABERTA' }),
      });
      if (!comandaAtual) {
        throw Object.assign(new Error('Esta comanda já foi fechada'), { statusCode: 409 });
      }
      assertCommandOccurrenceMatchesSession(comandaAtual, sessaoAtual);

      const itens = await resolverItens(tx, cervejariaId, body.itens, { sessaoCaixaId: sessaoAtual.id, tapsEnabled });
      const pedidosCriados = await criarPedidos(tx, {
        cervejariaId,
        comandaId: comandaAtual.id,
        pontoVendaId: comandaAtual.pontoVendaId!,
        dia: comandaAtual.diaOperacional!,
        criadoPorId: user.sub,
        paraViagem: body.paraViagem,
        observacao: body.observacao,
        itens,
        temCozinha,
      });

      for (const { pedido, itens: itensPedido } of pedidosCriados) await inventoryService.consumeSale(tx, {
        context: 'CAIXA', moduleEnabled: controlaEstoque, cervejariaId,
        pontoVendaId: comandaAtual.pontoVendaId!, pedidoId: pedido.id, registradoPorId: user.sub, items: itensPedido,
      });

      await recalcComandaTotalOperacao(tx, comandaAtual.id, { kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch });

      return {
        atualizada: await tx.comanda.findUniqueOrThrow({
          where: { id: comandaAtual.id },
          include: INCLUDE_COMANDA_OPERACAO,
        }),
        pedidos: pedidosCriados.map((item) => item.pedido),
      };
    }, CAIXA_VENDA_TX);

    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);
    if (temCozinha) for (const pedido of pedidos) await notificarPedidoNovo(app, cervejariaId, pedido);

    const resumo = resumoComanda(atualizada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    void registrarTransacao({
      cervejariaId,
      tipo: 'KITCHEN_ORDER_CREATED',
      usuarioId: user.sub,
      comandaId: comanda.id,
      entidadeId: pedidos[0]?.id,
      metadata: { pedidos: pedidos.map((pedido) => ({ id: pedido.id, numero: pedido.numero })), qtdItens: body.itens.length },
      payload: { comanda: resumo, pedidos, observacao: body.observacao ?? null },
    });

    return reply.status(201).send(resumo);
  });

  app.delete('/:comandaId/itens/:itemId', { preHandler: [requirePermissao(app, 'command.item.cancel')] }, async (request, reply) => {
    const { cervejariaId, controlaEstoque } = request.operacao;
    const user = getAuthUser(request);
    const { comandaId, itemId } = request.params as { comandaId: string; itemId: string };
    const body = cancelarItemSchema.parse(request.body ?? {});

    const result = await removeItemFromComandaOperacao({
      app,
      cervejariaId,
      comandaId,
      itemId,
      quantidade: body.quantidade,
      registradoPorId: user.sub,
      moduloControlaEstoque: controlaEstoque,
      user,
      motivo: body.motivo,
      tratamentoEstoque: body.tratamentoEstoque,
      idempotencyKey: body.idempotencyKey,
      quantidadeEsperada: body.quantidadeEsperada,
    });

    if ('error' in result) {
      const status = result.error === 'Item não encontrado' ? 404 : 409;
      return reply.status(status).send({ error: result.error });
    }

    return result.comanda;
  });

  app.patch('/:comandaId/itens/:itemId', { preHandler: [requirePermissaoQuantidadeItem(app)] }, async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.operacao;
    const user = getAuthUser(request);
    const { comandaId, itemId } = request.params as { comandaId: string; itemId: string };
    const body = itemQuantidadeSchema.parse(request.body);

    const result = await updateItemQuantidadeComandaOperacao({
      app,
      cervejariaId,
      comandaId,
      itemId,
      quantidade: body.quantidade,
      user: getAuthUser(request),
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

  app.patch('/:id/desconto', { preHandler: [requirePermissao(app, 'discount.apply')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = descontoSchema.parse(request.body);

    await assertPodeDarDescontoOperacao(user);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id }),
      include: INCLUDE_COMANDA_OPERACAO,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Só é possível alterar desconto em comanda aberta' });
    }
    if (comanda.tipo === 'AVULSA') {
      return reply.status(409).send({ error: 'Venda avulsa não permite desconto' });
    }

    const cozinhaAoLancar = request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch;
    const subtotalEmCents = subtotalComandaEmCentavos(comanda, cozinhaAoLancar);
    const descontoEmCents = centavos(body.desconto);
    if (descontoEmCents > subtotalEmCents) {
      throw new DescontoInvalidoError('O desconto não pode ser maior que o subtotal da comanda');
    }

    const atualizada = await prisma.$transaction(async (tx) => {
      await lockComandaItemsInTx(tx, comanda.id);
      const comandaAtual = await tx.comanda.findFirst({
        where: whereComandaOperacao(cervejariaId, { id: comanda.id, status: 'ABERTA' }),
        include: { itens: true, pedidosOperacao: { include: { itensComanda: { include: { opcionais: true } } } } },
      });
      if (!comandaAtual) {
        throw Object.assign(new Error('Só é possível alterar desconto em comanda aberta'), { statusCode: 409 });
      }
      if (comandaAtual.tipo === 'AVULSA') {
        throw Object.assign(new Error('Venda avulsa não permite desconto'), { statusCode: 409 });
      }
      const subtotalAtualEmCents = subtotalComandaEmCentavos(comandaAtual, cozinhaAoLancar);
      if (descontoEmCents > subtotalAtualEmCents) {
        throw new DescontoInvalidoError('O desconto não pode ser maior que o subtotal da comanda');
      }
      await tx.comanda.update({
        where: { id: comanda.id },
        data: { desconto: body.desconto },
      });
      await recalcComandaTotalOperacao(tx, comanda.id, { kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch });
      return tx.comanda.findUniqueOrThrow({
        where: { id: comanda.id },
        include: INCLUDE_COMANDA_OPERACAO,
      });
    }, CAIXA_VENDA_TX);

    const resumoAtualizado = resumoComanda(atualizada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);
    void registrarTransacao({
      cervejariaId,
      tipo: 'COMANDA_DESCONTO_APLICADO',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { desconto: body.desconto, subtotal: resumoAtualizado.subtotal },
      payload: resumoAtualizado,
    });

    return resumoAtualizado;
  });

  app.post('/:id/pagamentos', { preHandler: [requirePermissao(app, ['command.close', 'payment.receive'])] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = pagarSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id }),
      include: INCLUDE_COMANDA_OPERACAO,
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'ABERTA') {
      return reply.status(409).send({ error: 'Esta comanda já foi fechada' });
    }

    const resumo = resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    if (comanda.itens.length === 0) {
      return reply.status(409).send({ error: 'Lance ao menos um item antes de cobrar' });
    }

    const allowCloseWithPendingKitchen = request.operacao.effectiveSettings;
    if (
      !(allowCloseWithPendingKitchen?.allowCloseComandaWithPendingKitchenOrders && allowCloseWithPendingKitchen.kitchenItemsChargeAtLaunch) &&
      temPedidoCozinhaPendente(comanda.pedidosOperacao)
    ) {
      return reply.status(409).send({
        error: 'Aguarde a entrega dos itens da cozinha antes de fechar a comanda',
      });
    }

    if (body.deixarPendente) {
      if (resumo.total <= 0) {
        return reply.status(400).send({ error: 'Uma conta sem valor não pode ficar pendente' });
      }
      const cliente = comanda.clienteId
        ? await prisma.cliente.findFirst({
            where: { id: comanda.clienteId, cervejariaId, ativo: true, isSistema: false },
            select: { telefone: true },
          })
        : null;
      if (!cliente || !normalizePhone(cliente.telefone)) {
        return reply.status(400).send({
          error: 'Para deixar a conta pendente, associe um cliente cadastrado com telefone válido.',
        });
      }
      if (body.pagamentos.length > 0) {
        return reply.status(400).send({ error: 'Remova os pagamentos para deixar o valor integral pendente' });
      }
    }

    await assertCaixaAberto(cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);

    const totalEmCentavos = centavos(resumo.total);
    const pagamentos = body.deixarPendente ? [] : resolverPagamentos(body.pagamentos, totalEmCentavos);

    const fechada = await prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!);
      const sessao = await assertCaixaAberto(cervejariaId, comanda.pontoVendaId!, comanda.diaOperacional!, tx);
      assertCommandOccurrenceMatchesSession(comanda, sessao);
      await fecharComandaOperacaoInTx(tx, {
        comanda,
        pagamentos,
        cervejariaId,
        usuarioId: user.sub,
        fechadaEm: new Date(),
        sessaoCaixaId: sessao.id,
        deixarPendente: body.deixarPendente,
        kitchenItemsChargeAtLaunch: request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch,
      });

      return tx.comanda.findUniqueOrThrow({
        where: { id: comanda.id },
        include: INCLUDE_COMANDA_OPERACAO,
      });
    }, CAIXA_VENDA_TX);

    const resumoFechada = resumoComanda(fechada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);

    if (!body.deixarPendente) {
      void registrarTransacao({
        cervejariaId,
        tipo: 'SALE_PAYMENT_RECORDED',
        usuarioId: user.sub,
        comandaId: comanda.id,
        metadata: { pagamentos, total: resumoFechada.total },
        payload: resumoFechada,
      });
    }

    return resumoFechada;
  });

  app.post('/:id/cancelar', { preHandler: [requirePermissaoOuDono(app, 'command.cancel')] }, async (request, reply) => {
    const { cervejariaId, temCozinha, controlaEstoque } = request.operacao;
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const comanda = await prisma.comanda.findFirst({
      where: whereComandaOperacao(cervejariaId, { id }),
      include: INCLUDE_COMANDA_OPERACAO,
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
      const pedidosParaCancelar = await tx.pedidoOperacao.findMany({
        where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
        select: { id: true },
      });
      await tx.pedidoOperacao.updateMany({
        where: { comandaId: comanda.id, status: { in: STATUS_NA_FILA } },
        data: { status: 'CANCELAMENTO_PENDENTE' },
      });
      if (pedidosParaCancelar.length) {
        await tx.pedidoOperacaoStatusHistorico.createMany({
          data: pedidosParaCancelar.map(({ id }) => ({ pedidoId: id, status: 'CANCELAMENTO_PENDENTE' })),
        });
      }

      return tx.comanda.update({
        where: { id: comanda.id },
        data: { status: 'CANCELADA', fechadaEm: new Date(), fechadoPorId: user.sub },
        include: INCLUDE_COMANDA_OPERACAO,
      });
    });

    notificarComandaOperacaoAtualizada(app, cervejariaId, comanda.id);
    if (temCozinha) await notificarPedidosDaComanda(app, cervejariaId, comanda.id);

    const resumoCancelada = resumoComanda(cancelada, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch);
    void registrarTransacao({
      cervejariaId,
      tipo: 'COMANDA_CANCELADA',
      usuarioId: user.sub,
      comandaId: comanda.id,
      metadata: { identificador: comanda.identificador },
      payload: resumoCancelada,
    });

    return resumoCancelada;
  });
}
