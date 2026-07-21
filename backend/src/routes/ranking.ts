import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { isSerie } from '../lib/evento-utils.js';
import {
  aggregateChopeRanking,
  mesToDateRange,
  mesesDisponiveisFromDates,
  withRankingPosicao,
} from '../lib/chope-ranking.js';

export async function rankingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const comandas = await prisma.comanda.findMany({
      where: { eventoId, tipo: 'COMANDA' },
      include: {
        cliente: true,
        itens: { include: { produto: true } },
      },
    });

    const ranking = withRankingPosicao(aggregateChopeRanking(comandas));

    return {
      evento: {
        id: evento.id,
        nome: evento.nome,
        local: evento.local,
        data: evento.data,
        horaInicio: evento.horaInicio,
        horaFim: evento.horaFim,
        serieId: evento.serieId,
        trailerId: evento.trailerId,
      },
      ranking,
    };
  });

  app.get('/evento/:eventoId/periodo', async (request, reply) => {
    const user = getAuthUser(request);
    const { eventoId } = request.params as { eventoId: string };
    const { mes } = request.query as { mes?: string };

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId: user.cervejariaId },
      include: { trailer: { select: { id: true, nome: true, identificador: true } } },
    });
    if (!evento || !evento.data) {
      return reply.status(404).send({ error: 'Evento não encontrado' });
    }

    const todosEventos = await prisma.evento.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        trailerId: evento.trailerId,
        data: { not: null },
      },
      select: { id: true, data: true },
    });

    const mesesDisponiveis = mesesDisponiveisFromDates(todosEventos.map((e) => e.data));

    let eventoIds = todosEventos.map((e) => e.id);
    let escopo: 'mensal' | 'geral' = 'geral';
    let mesSelecionado: string | null = null;

    if (mes) {
      const range = mesToDateRange(mes);
      if (!range) {
        return reply.status(400).send({ error: 'Parâmetro mes inválido. Use YYYY-MM.' });
      }
      escopo = 'mensal';
      mesSelecionado = mes;
      eventoIds = todosEventos
        .filter((e) => e.data && e.data >= range.gte && e.data < range.lt)
        .map((e) => e.id);
    }

    const comandas =
      eventoIds.length === 0
        ? []
        : await prisma.comanda.findMany({
            where: { eventoId: { in: eventoIds }, tipo: 'COMANDA' },
            include: {
              cliente: true,
              itens: { include: { produto: true } },
            },
          });

    const entries = withRankingPosicao(aggregateChopeRanking(comandas));

    return {
      evento: {
        id: evento.id,
        nome: evento.nome,
        local: evento.local,
        data: evento.data,
        trailerId: evento.trailerId,
        trailer: evento.trailer,
      },
      escopo,
      mes: mesSelecionado,
      mesesDisponiveis,
      entries,
    };
  });

  app.get('/serie/:serieId', async (request, reply) => {
    const user = getAuthUser(request);
    const { serieId } = request.params as { serieId: string };
    const { mes } = request.query as { mes?: string };

    const serie = await prisma.evento.findFirst({
      where: { id: serieId, cervejariaId: user.cervejariaId },
    });
    if (!serie || !isSerie(serie)) {
      return reply.status(404).send({ error: 'Agenda fixa não encontrada' });
    }

    const todasSessoes = await prisma.evento.findMany({
      where: { serieId, cervejariaId: user.cervejariaId },
      select: { id: true, data: true },
    });

    const mesesDisponiveis = mesesDisponiveisFromDates(todasSessoes.map((s) => s.data));

    let sessaoIds = todasSessoes.map((s) => s.id);
    let escopo: 'mensal' | 'geral' = 'geral';
    let mesSelecionado: string | null = null;

    if (mes) {
      const range = mesToDateRange(mes);
      if (!range) {
        return reply.status(400).send({ error: 'Parâmetro mes inválido. Use YYYY-MM.' });
      }
      escopo = 'mensal';
      mesSelecionado = mes;
      sessaoIds = todasSessoes
        .filter((s) => s.data && s.data >= range.gte && s.data < range.lt)
        .map((s) => s.id);
    }

    const comandas =
      sessaoIds.length === 0
        ? []
        : await prisma.comanda.findMany({
            where: { eventoId: { in: sessaoIds }, tipo: 'COMANDA' },
            include: {
              cliente: true,
              itens: { include: { produto: true } },
            },
          });

    const entries = withRankingPosicao(aggregateChopeRanking(comandas));

    return {
      serie: {
        id: serie.id,
        nome: serie.nome,
        local: serie.local,
        diaSemana: serie.diaSemana,
      },
      escopo,
      mes: mesSelecionado,
      mesesDisponiveis,
      entries,
    };
  });
}
