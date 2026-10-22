import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { isSerie } from '../lib/evento-utils.js';
import { diaOperacional } from '../lib/operacao/venda.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../lib/canonical-pdv-operational-config.js';
import { getOperationalProfile } from '../lib/operational-profile.js';
import { requirePermissao } from '../lib/operacao/permissoes.js';
import {
  aggregateChopeRanking,
  mesToDateRange,
  mesesDisponiveisFromDates,
  withRankingPosicao,
} from '../lib/chope-ranking.js';

export async function rankingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const pdvScope = async (cervejariaId: string, pontoVendaId: string, reply: FastifyReply) => {
    const [settings, profile] = await Promise.all([
      readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId),
      getOperationalProfile(cervejariaId),
    ]);
    if (!settings || !settings.tapsEnabled || settings.pointId !== pontoVendaId
      || profile?.operationMode !== 'CAIXA' || !profile.capabilities.cashRegister || !profile.capabilities.taps) {
      reply.status(404).send({ error: 'PDV com ranking de chope não encontrado' });
      return null;
    }
    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId, ativo: true },
      select: { id: true, nome: true },
    });
    if (!pontoVenda) {
      reply.status(404).send({ error: 'PDV com ranking de chope não encontrado' });
      return null;
    }
    return pontoVenda;
  };

  const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use uma data válida no formato YYYY-MM-DD.');

  app.get('/pdv/:pontoVendaId', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { pontoVendaId } = z.object({ pontoVendaId: z.string().min(1) }).parse(request.params);
    const query = z.object({ dia: isoDay.optional(), ocorrenciaId: z.string().min(1).optional() }).parse(request.query);
    const pontoVenda = await pdvScope(user.cervejariaId!, pontoVendaId, reply);
    if (!pontoVenda) return reply;

    let day = query.dia ? new Date(`${query.dia}T00:00:00.000Z`) : diaOperacional();
    let occurrence: { id: string; nome: string; data: Date } | null = null;
    if (query.ocorrenciaId) {
      occurrence = await prisma.ocorrenciaOperacional.findFirst({
        where: { id: query.ocorrenciaId, cervejariaId: user.cervejariaId!, pontoVendaId },
        select: { id: true, nome: true, data: true },
      });
      if (!occurrence) return reply.status(404).send({ error: 'Ocorrência não encontrada neste PDV' });
      day = occurrence.data;
    }
    const nextDay = new Date(day);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const comandas = await prisma.comanda.findMany({
      where: {
        pontoVendaId,
        origem: 'CAIXA',
        tipo: { in: ['COMANDA', 'MESA', 'FICHA', 'APELIDO'] },
        ...(occurrence ? { ocorrenciaId: occurrence.id } : { diaOperacional: { gte: day, lt: nextDay } }),
      },
      include: { cliente: true, itens: { include: { produto: true } } },
    });
    return {
      pontoVenda,
      dia: day.toISOString().slice(0, 10),
      ocorrencia: occurrence,
      ranking: withRankingPosicao(aggregateChopeRanking(comandas)),
    };
  });

  app.get('/pdv/:pontoVendaId/periodo', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { pontoVendaId } = z.object({ pontoVendaId: z.string().min(1) }).parse(request.params);
    const { mes } = z.object({ mes: z.string().optional() }).parse(request.query);
    const pontoVenda = await pdvScope(user.cervejariaId!, pontoVendaId, reply);
    if (!pontoVenda) return reply;
    const sessions = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId: user.cervejariaId!, pontoVendaId },
      select: { diaOperacional: true },
    });
    const mesesDisponiveis = mesesDisponiveisFromDates(sessions.map((session) => session.diaOperacional));
    let range: { gte: Date; lt: Date } | null = null;
    let mesSelecionado: string | null = null;
    if (mes) {
      range = mesToDateRange(mes);
      if (!range) return reply.status(400).send({ error: 'Parâmetro mes inválido. Use YYYY-MM.' });
      mesSelecionado = mes;
    }
    const comandas = await prisma.comanda.findMany({
      where: {
        pontoVendaId,
        origem: 'CAIXA',
        tipo: { in: ['COMANDA', 'MESA', 'FICHA', 'APELIDO'] },
        diaOperacional: range ? { gte: range.gte, lt: range.lt } : { not: null },
      },
      include: { cliente: true, itens: { include: { produto: true } } },
    });
    return {
      pontoVenda,
      escopo: range ? 'mensal' : 'geral',
      mes: mesSelecionado,
      mesesDisponiveis,
      entries: withRankingPosicao(aggregateChopeRanking(comandas)),
    };
  });

  app.get('/evento/:eventoId', async (request, reply) => {
    const user = getTenantUser(app, request);
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
    const user = getTenantUser(app, request);
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
    const user = getTenantUser(app, request);
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
