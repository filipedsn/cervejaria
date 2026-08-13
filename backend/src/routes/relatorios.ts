import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { csvRow } from '../lib/csv.js';
import { getAuthUser } from '../types/auth.js';
import { toNumber } from '../lib/utils.js';
import { isBebidaChope } from '../lib/produto-utils.js';

export async function relatoriosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireDono);

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const comandas = await prisma.comanda.findMany({
      where: { eventoId, status: 'FECHADA' },
      include: {
        itens: { include: { produto: true } },
        pagamentos: true,
      },
    });

    let totalVendido = 0;
    let totalMl = 0;
    const porBebida = new Map<string, { produtoId: string; nome: string; quantidade: number; totalMl: number; valor: number }>();
    const porPagamento = new Map<string, number>();

    for (const comanda of comandas) {
      totalVendido += toNumber(comanda.total);
      for (const item of comanda.itens) {
        if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
          totalMl += item.volumeMl * item.quantidade;
        }
        const key = item.produtoId;
        const current = porBebida.get(key) ?? {
          produtoId: item.produtoId,
          nome: item.produto.nome,
          quantidade: 0,
          totalMl: 0,
          valor: 0,
        };
        current.quantidade += item.quantidade;
        if (isBebidaChope(item.produto.tipo, item.produto.formato)) {
          current.totalMl += item.volumeMl * item.quantidade;
        }
        current.valor += toNumber(item.precoUnit) * item.quantidade;
        porBebida.set(key, current);
      }
      for (const pag of comanda.pagamentos) {
        const key = pag.forma;
        porPagamento.set(key, (porPagamento.get(key) ?? 0) + toNumber(pag.valor));
      }
    }

    return {
      evento: { id: evento.id, nome: evento.nome, local: evento.local, data: evento.data, status: evento.status },
      resumo: {
        comandasFechadas: comandas.length,
        totalVendido,
        totalMl,
      },
      porBebida: Array.from(porBebida.values()).sort((a, b) => b.valor - a.valor),
      porPagamento: Array.from(porPagamento.entries()).map(([forma, valor]) => ({ forma, valor })),
    };
  });

  app.get('/evento/:eventoId/csv', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const comandas = await prisma.comanda.findMany({
      where: { eventoId, status: 'FECHADA' },
      include: {
        cliente: true,
        itens: { include: { produto: true } },
        pagamentos: true,
      },
      orderBy: { updatedAt: 'asc' },
    });

    const lines = ['cliente,telefone,produto,volume_ml,quantidade,preco_unit,subtotal,forma_pagamento,valor_pago,fechado_em'];

    for (const comanda of comandas) {
      const formas = comanda.pagamentos.map((p) => `${p.forma}:${toNumber(p.valor).toFixed(2)}`).join('|');
      for (const item of comanda.itens) {
        const subtotal = toNumber(item.precoUnit) * item.quantidade;
        lines.push(
          csvRow([
            comanda.cliente.nome,
            comanda.cliente.telefone ?? '',
            item.produto.nome,
            item.volumeMl,
            item.quantidade,
            toNumber(item.precoUnit).toFixed(2),
            subtotal.toFixed(2),
            formas,
            toNumber(comanda.total).toFixed(2),
            comanda.updatedAt.toISOString(),
          ]),
        );
      }
    }

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="relatorio-${evento.id}.csv"`);
    return '\uFEFF' + lines.join('\n');
  });
}
