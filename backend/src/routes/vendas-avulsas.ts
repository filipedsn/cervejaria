import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToEvento } from '../lib/realtime.js';
import { toNumber } from '../lib/utils.js';
import { ensureClienteAvulso } from '../lib/cliente-avulso.js';
import { addItemToComandaInTx, recalcComandaTotalInTx } from '../lib/comanda-service.js';
import {
  fecharComandaComPagamentos,
  type PagamentoInput,
} from '../lib/fechar-comanda.js';
import { registrarTransacao } from '../lib/transacao-log.js';
import { assertPodeDarDescontoOperacao, DescontoInvalidoError } from '../lib/operacao/desconto.js';
import { bloquearCaixaEvento, obterCaixaAtualEvento } from '../lib/evento-caixa.js';

const itemSchema = z.object({
  produtoId: z.string(),
  volumeMl: z.number().int().positive(),
  quantidade: z.number().int().positive().default(1),
  tapId: z.string().optional(),
});

const pagamentoSchema = z.object({
  forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
  valor: z.number().positive(),
});

const vendaAvulsaSchema = z.object({
  eventoId: z.string(),
  itens: z.array(itemSchema).min(1),
  pagamentos: z.array(pagamentoSchema),
  desconto: z.number().min(0).optional(),
});

export async function vendasAvulsasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = vendaAvulsaSchema.parse(request.body);
    const desconto = body.desconto ?? 0;

    if (desconto > 0) {
      try {
        await assertPodeDarDescontoOperacao(user);
      } catch (err) {
        if (err instanceof DescontoInvalidoError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    }

    const evento = await prisma.evento.findFirst({
      where: { id: body.eventoId, cervejariaId: user.cervejariaId!, status: 'ABERTO' },
    });
    if (!evento) {
      return reply.status(400).send({ error: 'Evento não encontrado ou fechado' });
    }

    const fechadaEm = new Date();

    try {
      const comanda = await prisma.$transaction(async (tx) => {
        await bloquearCaixaEvento(tx, body.eventoId);
        const caixa = await obterCaixaAtualEvento(body.eventoId, tx);
        if (!caixa) throw Object.assign(new Error('Abra o caixa do evento antes de registrar vendas'), { statusCode: 409 });
        const cliente = await ensureClienteAvulso(tx, user.cervejariaId!);

        const created = await tx.comanda.create({
          data: {
            eventoId: body.eventoId,
            clienteId: cliente.id,
            tipo: 'AVULSA',
          },
        });

        for (const item of body.itens) {
          const result = await addItemToComandaInTx(tx, {
            comandaId: created.id,
            cervejariaId: user.cervejariaId!,
            eventoId: body.eventoId,
            item,
            criadoPorId: user.sub,
          });
          if ('error' in result) {
            throw Object.assign(new Error(result.error), { statusCode: 400 });
          }
        }

        let comandaComItens = await tx.comanda.findUniqueOrThrow({
          where: { id: created.id },
          include: { itens: { include: { produto: true } } },
        });

        const subtotal = comandaComItens.itens.reduce(
          (sum, item) => sum + toNumber(item.precoUnit) * item.quantidade,
          0,
        );
        if (desconto > subtotal + 0.001) {
          throw Object.assign(
            new Error('O desconto não pode ser maior que o subtotal da comanda'),
            { statusCode: 400 },
          );
        }

        if (desconto > 0) {
          await tx.comanda.update({
            where: { id: created.id },
            data: { desconto },
          });
          await recalcComandaTotalInTx(tx, created.id);
          comandaComItens = await tx.comanda.findUniqueOrThrow({
            where: { id: created.id },
            include: { itens: { include: { produto: true } } },
          });
        }

        const total = toNumber(comandaComItens.total);
        if (total <= 0.001) {
          if (body.pagamentos.length > 0) {
            throw Object.assign(new Error('Conta zerada não exige pagamento'), { statusCode: 400 });
          }
        } else {
          if (body.pagamentos.length === 0) {
            throw Object.assign(new Error('Informe como o cliente pagou'), { statusCode: 400 });
          }
          const totalPagamentos = body.pagamentos.reduce((sum, p) => sum + p.valor, 0);
          if (Math.abs(totalPagamentos - total) > 0.01) {
            throw Object.assign(
              new Error(
                `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total (R$ ${total.toFixed(2)})`,
              ),
              { statusCode: 400 },
            );
          }
        }

        await registrarTransacao(
          {
            cervejariaId: user.cervejariaId!,
            tipo: 'COMANDA_CRIADA',
            usuarioId: user.sub,
            eventoId: body.eventoId,
            comandaId: created.id,
            metadata: {
              tipo: 'AVULSA',
              total,
              ...(desconto > 0 ? { desconto } : {}),
            },
            payload: comandaComItens,
          },
          tx,
        );

        return fecharComandaComPagamentos(tx, {
          comanda: {
            ...comandaComItens,
            tipo: 'AVULSA',
            desconto: comandaComItens.desconto,
          },
          pagamentos: body.pagamentos as PagamentoInput[],
          cervejariaId: user.cervejariaId!,
          usuarioId: user.sub,
          fechadaEm,
          sessaoCaixaEventoId: caixa.id,
        });
      });

      emitToEvento(app.io, body.eventoId, { type: 'comanda:closed', data: comanda });
      return reply.status(201).send(comanda);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      if (statusCode === 404) {
        return reply.status(404).send({ error: (err as Error).message });
      }
      if (statusCode === 409) return reply.status(409).send({ error: (err as Error).message });
      throw err;
    }
  });
}
