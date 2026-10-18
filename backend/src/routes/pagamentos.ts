import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { emitToComanda, emitToEvento } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { cancelarComandaVazia } from '../lib/comanda-cancelar.js';
import {
  allocatePagamentosToComandas,
  cancelarComandaVaziaInTx,
  comandaFechadaInclude,
  fecharComandaComPagamentos,
  newGrupoPagamentoId,
  type PagamentoInput,
} from '../lib/fechar-comanda.js';
import { lockComandasInTx } from '../lib/comanda-service.js';
import { bloquearCaixaEvento, obterCaixaAtualEvento } from '../lib/evento-caixa.js';
import { requireFechamentoComanda, requireFechamentoGrupo } from '../lib/operacao/permissoes.js';

const pagamentoSchema = z.object({
  forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
  valor: z.number().positive(),
});

const fecharComandaSchema = z.object({
  pagamentos: z.array(pagamentoSchema),
  deixarPendente: z.boolean().optional().default(false),
});

const fecharGrupoSchema = z.object({
  comandaIds: z.array(z.string().min(1)).min(2),
  pagamentos: z.array(pagamentoSchema),
});

export async function pagamentosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/comandas/:id/fechar', { preHandler: [requireFechamentoComanda(app)] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = fecharComandaSchema.parse(request.body);

    const comanda = await prisma.comanda.findFirst({
      where: { id, status: 'ABERTA', evento: { cervejariaId: user.cervejariaId } },
      include: { itens: { include: { produto: true } }, evento: { select: { id: true, status: true } } },
    });
    if (!comanda) return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada' });

    const eventoId = comanda.eventoId;
    if (!eventoId) return reply.status(404).send({ error: 'Comanda sem evento' });
    if (comanda.evento?.status !== 'ABERTO') return reply.status(409).send({ error: 'O evento está fechado' });

    if (comanda.itens.length === 0) {
      const cancelled = await cancelarComandaVazia({
        comandaId: id,
        cervejariaId: user.cervejariaId!,
        fechadoPorId: user.sub,
        motivo: 'empty_on_close',
      });
      if ('error' in cancelled) return reply.status(400).send({ error: cancelled.error });
      emitToEvento(app.io, cancelled.eventoId, { type: 'comanda:closed', data: cancelled.comanda });
      emitToComanda(app.io, id, { type: 'comanda:closed', data: cancelled.comanda });
      return cancelled.comanda;
    }

    const total = toNumber(comanda.total);
    if (body.deixarPendente) {
      if (body.pagamentos.length > 0 || total <= 0.001) {
        return reply.status(400).send({ error: 'Conta pendente exige saldo positivo e nenhum pagamento no fechamento' });
      }
    } else if (total <= 0.001) {
      if (body.pagamentos.length > 0) {
        return reply.status(400).send({ error: 'Conta zerada não exige pagamento' });
      }
    } else {
      if (body.pagamentos.length === 0) {
        return reply.status(400).send({ error: 'Informe como o cliente pagou' });
      }
      const totalPagamentos = body.pagamentos.reduce((sum, p) => sum + p.valor, 0);
      if (Math.abs(totalPagamentos - total) > 0.01) {
        return reply.status(400).send({
          error: `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total da comanda (R$ ${total.toFixed(2)})`,
        });
      }
    }

    let updated;
    try {
      const fechadaEm = new Date();
      updated = await prisma.$transaction(async (tx) => {
        await bloquearCaixaEvento(tx, eventoId);
        const caixa = await obterCaixaAtualEvento(eventoId, tx);
        if (!caixa) throw Object.assign(new Error('Abra o caixa do evento antes de fechar comandas'), { statusCode: 409 });
        return fecharComandaComPagamentos(tx, {
          comanda,
          pagamentos: body.pagamentos as PagamentoInput[],
          cervejariaId: user.cervejariaId!,
          usuarioId: user.sub,
          fechadaEm,
          sessaoCaixaEventoId: caixa.id,
          deixarPendente: body.deixarPendente,
        });
      });
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        return reply.status(404).send({ error: 'Comanda não encontrada ou já fechada' });
      }
      if (statusCode === 400) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      if (statusCode === 409) return reply.status(409).send({ error: (err as Error).message });
      throw err;
    }

    emitToEvento(app.io, eventoId, { type: 'comanda:closed', data: updated });
    emitToComanda(app.io, id, { type: 'comanda:closed', data: updated });
    return updated;
  });

  app.post('/fechar-grupo', { preHandler: [requireFechamentoGrupo(app)] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = fecharGrupoSchema.parse(request.body);
    const uniqueIds = [...new Set(body.comandaIds)];
    if (uniqueIds.length !== body.comandaIds.length) {
      return reply.status(400).send({ error: 'Lista de comandas contém IDs duplicados' });
    }

    const comandas = await prisma.comanda.findMany({
      where: {
        id: { in: uniqueIds },
        status: 'ABERTA',
        evento: { cervejariaId: user.cervejariaId, status: 'ABERTO' },
      },
      include: { itens: { include: { produto: true } }, evento: { select: { id: true, status: true } } },
    });

    if (comandas.length !== uniqueIds.length) {
      return reply.status(404).send({
        error: 'Uma ou mais comandas não foram encontradas, já foram fechadas ou pertencem a outro evento',
      });
    }

    if (comandas.some((c) => c.tipo === 'AVULSA')) {
      return reply.status(400).send({ error: 'Vendas avulsas não podem entrar em pagamento conjunto' });
    }

    const eventoIds = new Set(comandas.map((c) => c.eventoId));
    if (eventoIds.size !== 1) {
      return reply.status(400).send({ error: 'Todas as comandas devem ser do mesmo evento' });
    }

    const eventoId = comandas[0]?.eventoId;
    if (!eventoId) return reply.status(404).send({ error: 'Comandas sem evento' });
    const comandasComItens = comandas.filter((c) => c.itens.length > 0);
    const comandasVazias = comandas.filter((c) => c.itens.length === 0);
    const totalGrupo = comandasComItens.reduce((sum, c) => sum + toNumber(c.total), 0);
    const totalPagamentos = body.pagamentos.reduce((sum, p) => sum + p.valor, 0);

    if (totalGrupo > 0 && body.pagamentos.length === 0) {
      return reply.status(400).send({ error: 'Informe ao menos uma forma de pagamento' });
    }

    if (totalGrupo > 0 && Math.abs(totalPagamentos - totalGrupo) > 0.01) {
      return reply.status(400).send({
        error: `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total do grupo (R$ ${totalGrupo.toFixed(2)})`,
      });
    }

    if (totalGrupo === 0 && totalPagamentos > 0.01) {
      return reply.status(400).send({
        error: 'Comandas vazias não exigem pagamento',
      });
    }

    const grupoPagamentoId = comandasComItens.length > 0 ? newGrupoPagamentoId() : undefined;
    const fechadaEm = new Date();

    let allocation: Map<string, PagamentoInput[]>;
    try {
      allocation = allocatePagamentosToComandas(
        comandasComItens.map((c) => ({ id: c.id, total: toNumber(c.total) })),
        body.pagamentos as PagamentoInput[],
      );
    } catch {
      return reply.status(400).send({ error: 'Falha ao alocar pagamentos entre comandas' });
    }

    let fechadas: Awaited<ReturnType<typeof fecharComandaComPagamentos>>[] = [];
    let canceladas: Awaited<ReturnType<typeof cancelarComandaVaziaInTx>>['comanda'][] = [];

    try {
      const result = await prisma.$transaction(async (tx) => {
        await bloquearCaixaEvento(tx, eventoId);
        const caixa = await obterCaixaAtualEvento(eventoId, tx);
        if (!caixa) throw Object.assign(new Error('Abra o caixa do evento antes de fechar comandas'), { statusCode: 409 });
        await lockComandasInTx(tx, uniqueIds);
        const closed: typeof fechadas = [];
        const cancelled: typeof canceladas = [];

        for (const comanda of comandasVazias) {
          const res = await cancelarComandaVaziaInTx(tx, {
            comandaId: comanda.id,
            cervejariaId: user.cervejariaId!,
            fechadoPorId: user.sub,
            motivo: 'empty_on_group_close',
          });
          cancelled.push(res.comanda);
        }

        for (const comanda of comandasComItens) {
          const pagamentos = allocation.get(comanda.id) ?? [];
          const updated = await fecharComandaComPagamentos(tx, {
            comanda,
            pagamentos,
            cervejariaId: user.cervejariaId!,
            usuarioId: user.sub,
            fechadaEm,
            grupoPagamentoId,
            comandaIdsGrupo: uniqueIds,
            sessaoCaixaEventoId: caixa.id,
          });
          closed.push(updated);
        }

        return { closed, cancelled };
      });
      fechadas = result.closed;
      canceladas = result.cancelled;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        return reply.status(404).send({
          error: 'Uma ou mais comandas não foram encontradas ou já foram fechadas',
        });
      }
      if (statusCode === 400) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      if (statusCode === 409) return reply.status(409).send({ error: (err as Error).message });
      throw err;
    }

    for (const comanda of [...fechadas, ...canceladas]) {
      emitToEvento(app.io, eventoId, { type: 'comanda:closed', data: comanda });
      emitToComanda(app.io, comanda.id, { type: 'comanda:closed', data: comanda });
    }

    return {
      totalGrupo,
      comandas: fechadas,
      canceladas,
    };
  });
}
