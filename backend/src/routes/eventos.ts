import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { emitToCervejaria } from '../lib/realtime.js';
import { emitPortalSessionExpired } from '../lib/cliente-session.js';
import { isSerie, todayDateString, todayWeekday, reabrirPrazoExpirado, REABRIR_PRAZO_EXPIRADO_MSG, comandaImpedeExclusaoWhere } from '../lib/evento-utils.js';
import { buildEventoDashboard } from '../lib/evento-dashboard.js';
import { buildEventoResumoExecutivo } from '../lib/evento-resumo-executivo.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';
import { findTrailerForTenant, trailerSelect } from '../lib/trailer-utils.js';
import {
  findSerieTrailerConflict,
  findSessaoTrailerConflict,
  trailerScheduleConflictMessage,
} from '../lib/evento-overlap.js';
import {
  findEventoSessao,
  listTapsComChopeAtual,
  listTapsMontagemPrevista,
  posicionarChopeNoTap,
  removerChopeDoTap,
  ensureMontagemEvento,
  inicializarMontagemEvento,
  setTapAtivoNoEvento,
} from '../lib/tap-montagem.js';
import { ensureDefaultTaps, assertTrailerChopeDisponivel } from '../lib/trailer-defaults.js';
import { registrarTransacao, listTransacoesEvento, transacoesToCsv } from '../lib/transacao-log.js';
import { reverterEventoParaAgendado } from '../lib/evento-reverter.js';
import {
  getEventoCardapio,
  salvarCardapioEvento,
  aplicarCardapioInicialEvento,
  aplicarCardapioCatalogoSeVazio,
  copiarCardapioEntreEventos,
} from '../lib/evento-cardapio.js';
import { getProdutoIdsFromCardapio, validateProdutosCardapio } from '../lib/cardapio.js';

const createEventoSchema = z
  .object({
    nome: z.string().min(1),
    local: z.string().min(1),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    recorrencia: z.enum(['NENHUMA', 'SEMANAL']).default('NENHUMA'),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    diaSemana: z.number().int().min(0).max(6).optional(),
    abrirAgora: z.boolean().optional().default(true),
    trailerId: z.string().min(1),
    cardapioId: z.string().optional(),
    produtoIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.cardapioId && data.produtoIds?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escolha um cardápio salvo ou monte na hora, não os dois',
        path: ['cardapioId'],
      });
    }
    if (data.recorrencia === 'NENHUMA' && !data.data) {
      ctx.addIssue({ code: 'custom', message: 'Informe a data do evento', path: ['data'] });
    }
    if (data.recorrencia === 'SEMANAL' && data.diaSemana === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Informe o dia da semana', path: ['diaSemana'] });
    }
  });

const updateEventoSchema = z.object({
  nome: z.string().min(1),
  local: z.string().min(1),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  diaSemana: z.number().int().min(0).max(6).optional(),
});

function parseDateOnly(dateStr: string) {
  return new Date(dateStr + 'T12:00:00');
}

function dateOnlyToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekdayFromDateKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

async function validarCardapioCriacao(
  cervejariaId: string,
  cardapioId?: string,
  produtoIds?: string[],
) {
  if (cardapioId) return getProdutoIdsFromCardapio(cardapioId, cervejariaId);
  if (produtoIds?.length) return validateProdutosCardapio(cervejariaId, produtoIds);
  return { ok: true as const, produtoIds: [] as string[] };
}

const eventoInclude = {
  trailer: { select: trailerSelect },
  serie: { select: { id: true, nome: true, diaSemana: true } },
} as const;

const eventoListCount = {
  comandas: { where: comandaImpedeExclusaoWhere },
  ocorrencias: true,
} as const;

export async function eventosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const user = getAuthUser(request);
    const eventos = await prisma.evento.findMany({
      where: { cervejariaId: user.cervejariaId },
      orderBy: [{ data: 'desc' }, { horaInicio: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: eventoListCount },
        ...eventoInclude,
      },
    });

    const series = eventos.filter((e) => isSerie(e));
    const sessoes = eventos.filter((e) => !isSerie(e));

    const agendamentoExclusoes = await prisma.eventoSerieExclusao.findMany({
      where: { cervejariaId: user.cervejariaId },
      select: { serieId: true, data: true },
    });

    return {
      series,
      sessoes,
      agendamentoExclusoes: agendamentoExclusoes.map((e) => ({
        serieId: e.serieId,
        data: dateOnlyToKey(e.data),
      })),
    };
  });

  app.get('/ativos', async (request) => {
    const user = getAuthUser(request);
    const query = z
      .object({
        trailerId: z.string().min(1).optional(),
      })
      .parse(request.query);

    return prisma.evento.findMany({
      where: {
        cervejariaId: user.cervejariaId,
        status: 'ABERTO',
        data: { not: null },
        ...(query.trailerId ? { trailerId: query.trailerId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: eventoInclude,
    });
  });

  app.get('/ativo', async (request) => {
    const user = getAuthUser(request);
    return prisma.evento.findFirst({
      where: {
        cervejariaId: user.cervejariaId,
        status: 'ABERTO',
        data: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      include: eventoInclude,
    });
  });

  app.get('/:id/dashboard', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const dashboard = await buildEventoDashboard(id, user.cervejariaId!);
    if (!dashboard) return reply.status(404).send({ error: 'Evento não encontrado' });
    return dashboard;
  });

  app.get('/:id/resumo-executivo', { preHandler: app.requireDono }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const result = await buildEventoResumoExecutivo(id, user.cervejariaId!);
    if (!result) return reply.status(404).send({ error: 'Evento não encontrado' });
    if ('forbidden' in result) {
      return reply.status(403).send({ error: 'Resumo disponível apenas para eventos encerrados' });
    }
    return result;
  });

  app.get('/:id/transacoes', { preHandler: app.requireDono }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }).parse(request.query);

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      select: { id: true },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    return listTransacoesEvento({
      eventoId: id,
      cervejariaId: user.cervejariaId!,
      limit: query.limit,
    });
  });

  app.get('/:id/transacoes/csv', { preHandler: app.requireDono }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      select: { id: true, nome: true },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    const rows = await listTransacoesEvento({
      eventoId: id,
      cervejariaId: user.cervejariaId!,
      limit: 500,
    });
    const csv = transacoesToCsv(rows);
    const filename = `transacoes-${evento.nome.replace(/\s+/g, '-').slice(0, 40)}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send('\uFEFF' + csv);
  });

  app.get('/:id/taps', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await findEventoSessao(id, user.cervejariaId!);
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    if (evento.status === 'ABERTO') {
      await ensureMontagemEvento(evento.id, evento.trailerId, user.cervejariaId!);
      return listTapsComChopeAtual(evento.id, evento.trailerId);
    }

    return listTapsMontagemPrevista(evento.trailerId);
  });

  app.put('/:id/taps/:tapId/chope', async (request, reply) => {
    const user = getAuthUser(request);
    const { id, tapId } = request.params as { id: string; tapId: string };
    const body = z.object({ produtoId: z.string().min(1) }).parse(request.body);

    const evento = await findEventoSessao(id, user.cervejariaId!);
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    if (evento.status !== 'ABERTO') {
      return reply.status(400).send({ error: 'Só é possível montar taps em eventos abertos' });
    }

    const result = await posicionarChopeNoTap({
      eventoId: evento.id,
      trailerId: evento.trailerId,
      tapId,
      produtoId: body.produtoId,
      cervejariaId: user.cervejariaId!,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'TAP_CHOPE_POSICIONADO',
      usuarioId: user.sub,
      eventoId: evento.id,
      entidadeTipo: 'Tap',
      entidadeId: tapId,
      metadata: {
        tapNumero: result.tapNumero,
        chopeAnterior: result.chopeAnterior,
        chopeNovo: result.chopeNovo,
        produtoId: body.produtoId,
      },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'tap-montagem:updated', data: { eventoId: id } });
    const taps = await listTapsComChopeAtual(evento.id, evento.trailerId);
    return {
      taps,
      message: `Tap ${result.tapNumero}: ${result.chopeAnterior ?? 'vazio'} → ${result.chopeNovo}`,
    };
  });

  app.delete('/:id/taps/:tapId/chope', async (request, reply) => {
    const user = getAuthUser(request);
    const { id, tapId } = request.params as { id: string; tapId: string };

    const evento = await findEventoSessao(id, user.cervejariaId!);
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    if (evento.status !== 'ABERTO') {
      return reply.status(400).send({ error: 'Só é possível desmontar taps em eventos abertos' });
    }

    const result = await removerChopeDoTap({
      eventoId: evento.id,
      trailerId: evento.trailerId,
      tapId,
      cervejariaId: user.cervejariaId!,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'TAP_CHOPE_REMOVIDO',
      usuarioId: user.sub,
      eventoId: evento.id,
      entidadeTipo: 'Tap',
      entidadeId: tapId,
      metadata: { tapNumero: result.tapNumero },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'tap-montagem:updated', data: { eventoId: id } });
    return listTapsComChopeAtual(evento.id, evento.trailerId);
  });

  app.patch('/:id/taps/:tapId/ativo', async (request, reply) => {
    const user = getAuthUser(request);
    const { id, tapId } = request.params as { id: string; tapId: string };
    const body = z.object({ ativo: z.boolean() }).parse(request.body);

    const evento = await findEventoSessao(id, user.cervejariaId!);
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    if (evento.status !== 'ABERTO') {
      return reply.status(400).send({ error: 'Só é possível alterar taps em eventos abertos' });
    }

    const result = await setTapAtivoNoEvento({
      eventoId: evento.id,
      trailerId: evento.trailerId,
      tapId,
      ativo: body.ativo,
      cervejariaId: user.cervejariaId!,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'TAP_ATIVO_ALTERADO',
      usuarioId: user.sub,
      eventoId: evento.id,
      entidadeTipo: 'Tap',
      entidadeId: tapId,
      metadata: { tapNumero: result.tapNumero, ativo: body.ativo },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'tap-montagem:updated', data: { eventoId: id } });
    const taps = await listTapsComChopeAtual(evento.id, evento.trailerId);
    return {
      taps,
      message: body.ativo ? `Tap ${result.tapNumero} reativada` : `Tap ${result.tapNumero} inativada`,
    };
  });

  app.get('/:id/cardapio', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const cardapio = await getEventoCardapio(id, user.cervejariaId!);
    if (!cardapio) return reply.status(404).send({ error: 'Evento não encontrado' });
    return cardapio;
  });

  app.put('/:id/cardapio', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        cardapioId: z.string().optional(),
        produtoIds: z.array(z.string().min(1)).optional(),
      })
      .refine((data) => !(data.cardapioId && data.produtoIds !== undefined), {
        message: 'Escolha um cardápio salvo ou monte na hora, não os dois',
      })
      .parse(request.body);

    const result = await salvarCardapioEvento({
      eventoId: id,
      cervejariaId: user.cervejariaId!,
      cardapioId: body.cardapioId,
      produtoIds: body.produtoIds,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_CARDAPIO_ATUALIZADO',
      usuarioId: user.sub,
      eventoId: id,
      metadata: {
        cardapioId: body.cardapioId ?? null,
        produtoIds: body.produtoIds ?? null,
      },
    });

    const cardapio = await getEventoCardapio(id, user.cervejariaId!);
    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento-cardapio:updated', data: { eventoId: id } });
    return cardapio;
  });

  app.get('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      include: {
        _count: { select: eventoListCount },
        ...eventoInclude,
      },
    });

    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    return evento;
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
    const body = createEventoSchema.parse(request.body);

    const trailer = await findTrailerForTenant(body.trailerId, user.cervejariaId!, { requireAtivo: true });
    if (!trailer) return reply.status(400).send({ error: 'Trailer inválido ou inativo' });

    const cardapioCheck = await validarCardapioCriacao(user.cervejariaId!, body.cardapioId, body.produtoIds);
    if ('error' in cardapioCheck) return reply.status(400).send({ error: cardapioCheck.error });

    if (body.recorrencia === 'SEMANAL') {
      const conflitoSerie = await findSerieTrailerConflict({
        cervejariaId: user.cervejariaId!,
        trailerId: body.trailerId,
        diaSemana: body.diaSemana!,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim,
      });
      if (conflitoSerie) {
        return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSerie) });
      }

      const serie = await prisma.evento.create({
        data: {
          nome: body.nome,
          local: body.local,
          horaInicio: body.horaInicio,
          horaFim: body.horaFim,
          recorrencia: 'SEMANAL',
          diaSemana: body.diaSemana,
          status: 'FECHADO',
          cervejariaId: user.cervejariaId!,
          trailerId: body.trailerId,
          cardapioId: body.cardapioId ?? null,
        },
        include: eventoInclude,
      });

      await aplicarCardapioInicialEvento({
        eventoId: serie.id,
        cervejariaId: user.cervejariaId!,
        cardapioId: body.cardapioId,
        produtoIds: body.produtoIds,
      });

      await registrarTransacao({
        cervejariaId: user.cervejariaId!,
        tipo: 'EVENTO_CRIADO',
        usuarioId: user.sub,
        eventoId: serie.id,
        metadata: { nome: serie.nome, recorrencia: 'SEMANAL' },
      });

      emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: serie });
      return reply.status(201).send(serie);
    }

    const dataEvento = parseDateOnly(body.data!);
    const conflitoSessao = await findSessaoTrailerConflict({
      cervejariaId: user.cervejariaId!,
      trailerId: body.trailerId,
      data: dataEvento,
      horaInicio: body.horaInicio,
      horaFim: body.horaFim,
    });
    if (conflitoSessao) {
      return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSessao) });
    }

    if (body.abrirAgora) {
      const chopeCheck = await assertTrailerChopeDisponivel(body.trailerId, user.cervejariaId!);
      if ('error' in chopeCheck) return reply.status(400).send({ error: chopeCheck.error });
    }

    const evento = await prisma.evento.create({
      data: {
        nome: body.nome,
        local: body.local,
        data: dataEvento,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim,
        recorrencia: 'NENHUMA',
        status: body.abrirAgora ? 'ABERTO' : 'FECHADO',
        cervejariaId: user.cervejariaId!,
        trailerId: body.trailerId,
        cardapioId: body.cardapioId ?? null,
      },
      include: eventoInclude,
    });

    await aplicarCardapioInicialEvento({
      eventoId: evento.id,
      cervejariaId: user.cervejariaId!,
      cardapioId: body.cardapioId,
      produtoIds: body.produtoIds,
    });
    await aplicarCardapioCatalogoSeVazio(evento.id, user.cervejariaId!);

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_CRIADO',
      usuarioId: user.sub,
      eventoId: evento.id,
      metadata: {
        nome: evento.nome,
        status: evento.status,
        abrirAgora: body.abrirAgora ?? false,
      },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: evento });
    if (evento.status === 'ABERTO') {
      await ensureDefaultTaps(evento.trailerId, user.cervejariaId!);
      await inicializarMontagemEvento(evento.id, evento.trailerId);
    }
    return reply.status(201).send(evento);
  });

  app.post('/:id/iniciar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const serie = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId, recorrencia: 'SEMANAL', serieId: null },
    });

    if (!serie) {
      return reply.status(404).send({ error: 'Agenda recorrente não encontrada' });
    }

    if (serie.diaSemana !== todayWeekday()) {
      return reply.status(400).send({
        error: `Esta agenda é para ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][serie.diaSemana!]}. Hoje não é o dia correto.`,
      });
    }

    const hoje = todayDateString();
    const excluidoHoje = await prisma.eventoSerieExclusao.findUnique({
      where: { serieId_data: { serieId: id, data: parseDateOnly(hoje) } },
    });
    if (excluidoHoje) {
      return reply.status(400).send({ error: 'O agendamento de hoje foi cancelado.' });
    }

    const existente = await prisma.evento.findFirst({
      where: { serieId: id, data: parseDateOnly(hoje) },
    });

    if (existente?.status === 'ABERTO') {
      await ensureMontagemEvento(existente.id, existente.trailerId, user.cervejariaId!);
      return existente;
    }

    if (existente?.status === 'FECHADO') {
      return reply.status(409).send({ error: 'A sessão de hoje já foi encerrada.' });
    }

    const conflitoSessao = await findSessaoTrailerConflict({
      cervejariaId: user.cervejariaId!,
      trailerId: serie.trailerId,
      data: parseDateOnly(hoje),
      horaInicio: serie.horaInicio,
      horaFim: serie.horaFim,
    });
    if (conflitoSessao) {
      return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSessao) });
    }

    const chopeCheck = await assertTrailerChopeDisponivel(serie.trailerId, user.cervejariaId!);
    if ('error' in chopeCheck) return reply.status(400).send({ error: chopeCheck.error });

    let sessao;
    try {
      sessao = await prisma.evento.create({
        data: {
          nome: serie.nome,
          local: serie.local,
          data: parseDateOnly(hoje),
          horaInicio: serie.horaInicio,
          horaFim: serie.horaFim,
          recorrencia: 'NENHUMA',
          serieId: serie.id,
          status: 'ABERTO',
          cervejariaId: user.cervejariaId!,
          trailerId: serie.trailerId,
          cardapioId: serie.cardapioId,
        },
        include: eventoInclude,
      });
      await copiarCardapioEntreEventos(serie.id, sessao.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'Já existe uma sessão nesta data para esta agenda.' });
      }
      throw err;
    }

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: sessao });
    await aplicarCardapioCatalogoSeVazio(sessao.id, user.cervejariaId!);
    await ensureDefaultTaps(sessao.trailerId, user.cervejariaId!);
    await inicializarMontagemEvento(sessao.id, sessao.trailerId);

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_SESSAO_INICIADA',
      usuarioId: user.sub,
      eventoId: sessao.id,
      metadata: { nome: sessao.nome, serieId: serie.id },
    });

    return reply.status(201).send(sessao);
  });

  app.post('/:id/cancelar-agendamento', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.body);

    const serie = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId, recorrencia: 'SEMANAL', serieId: null },
    });

    if (!serie) {
      return reply.status(404).send({ error: 'Agenda recorrente não encontrada' });
    }

    if (serie.diaSemana !== weekdayFromDateKey(body.data)) {
      return reply.status(400).send({ error: 'A data informada não corresponde ao dia da semana desta agenda.' });
    }

    if (body.data < todayDateString()) {
      return reply.status(400).send({ error: 'Não é possível cancelar agendamentos de datas passadas.' });
    }

    const sessaoExistente = await prisma.evento.findFirst({
      where: { serieId: id, data: parseDateOnly(body.data) },
    });
    if (sessaoExistente) {
      return reply.status(409).send({ error: 'Já existe uma sessão nesta data para esta agenda.' });
    }

    const exclusao = await prisma.eventoSerieExclusao.upsert({
      where: { serieId_data: { serieId: id, data: parseDateOnly(body.data) } },
      create: {
        serieId: id,
        data: parseDateOnly(body.data),
        cervejariaId: user.cervejariaId!,
      },
      update: {},
    });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_ATUALIZADO',
      usuarioId: user.sub,
      eventoId: serie.id,
      metadata: { acao: 'cancelar_agendamento', data: body.data, nome: serie.nome },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: serie });

    return reply.status(201).send({
      serieId: exclusao.serieId,
      data: dateOnlyToKey(exclusao.data),
    });
  });

  app.patch('/:id/fechar', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    if (isSerie(evento)) {
      return reply.status(400).send({ error: 'Agendas recorrentes não são encerradas — encerre a sessão do dia.' });
    }

    const abertas = await prisma.comanda.count({
      where: { eventoId: id, status: 'ABERTA' },
    });
    if (abertas > 0) {
      return reply.status(409).send({ error: `Existem ${abertas} comanda(s) aberta(s). Feche-as antes de encerrar o evento.` });
    }

    const updated = await prisma.evento.update({
      where: { id },
      data: { status: 'FECHADO', encerradoEm: new Date(), portalGeneration: { increment: 1 } },
    });

    emitPortalSessionExpired(app.io, id, 'evento_fechado');

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_FECHADO',
      usuarioId: user.sub,
      eventoId: id,
      metadata: { nome: evento.nome },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: updated });
    return updated;
  });

  app.patch('/:id/reabrir', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });
    if (isSerie(evento)) {
      return reply.status(400).send({ error: 'Agendas recorrentes não são reabertas — reabra a sessão do dia.' });
    }
    if (evento.status !== 'FECHADO') {
      return reply.status(400).send({ error: 'Este evento já está aberto.' });
    }
    if (!evento.data) {
      return reply.status(400).send({ error: 'Evento sem data não pode ser reaberto.' });
    }

    if (reabrirPrazoExpirado(evento.encerradoEm)) {
      return reply.status(400).send({ error: REABRIR_PRAZO_EXPIRADO_MSG });
    }

    const conflitoSessao = await findSessaoTrailerConflict({
      cervejariaId: user.cervejariaId!,
      trailerId: evento.trailerId,
      data: evento.data,
      horaInicio: evento.horaInicio,
      horaFim: evento.horaFim,
      excludeEventoId: id,
    });
    if (conflitoSessao) {
      return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSessao) });
    }

    const chopeCheck = await assertTrailerChopeDisponivel(evento.trailerId, user.cervejariaId!);
    if ('error' in chopeCheck) return reply.status(400).send({ error: chopeCheck.error });

    const updated = await prisma.evento.update({
      where: { id },
      data: { status: 'ABERTO', encerradoEm: null, portalGeneration: { increment: 1 } },
      include: eventoInclude,
    });

    emitPortalSessionExpired(app.io, id, 'evento_reaberto');

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: updated });
    await ensureDefaultTaps(updated.trailerId, user.cervejariaId!);
    await inicializarMontagemEvento(updated.id, updated.trailerId);

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_REABERTO',
      usuarioId: user.sub,
      eventoId: id,
      metadata: { nome: updated.nome },
    });

    return updated;
  });

  app.patch('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = updateEventoSchema.parse(request.body);

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    if (isSerie(evento)) {
      if (body.diaSemana === undefined) {
        return reply.status(400).send({ error: 'Informe o dia da semana' });
      }

      const conflitoSerie = await findSerieTrailerConflict({
        cervejariaId: user.cervejariaId!,
        trailerId: evento.trailerId,
        diaSemana: body.diaSemana,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim,
        excludeEventoId: id,
      });
      if (conflitoSerie) {
        return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSerie) });
      }

      const updated = await prisma.evento.update({
        where: { id },
        data: {
          nome: body.nome,
          local: body.local,
          horaInicio: body.horaInicio,
          horaFim: body.horaFim || null,
          diaSemana: body.diaSemana,
        },
        include: {
          _count: { select: eventoListCount },
        },
      });

      await registrarTransacao({
        cervejariaId: user.cervejariaId!,
        tipo: 'EVENTO_ATUALIZADO',
        usuarioId: user.sub,
        eventoId: id,
        metadata: { nome: updated.nome, recorrencia: 'SEMANAL' },
      });

      emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: updated });
      return updated;
    }

    if (!body.data) {
      return reply.status(400).send({ error: 'Informe a data do evento' });
    }

    const novaData = parseDateOnly(body.data);
    if (evento.serieId) {
      const conflito = await prisma.evento.findFirst({
        where: {
          serieId: evento.serieId,
          data: novaData,
          id: { not: id },
        },
      });
      if (conflito) {
        return reply.status(409).send({ error: 'Já existe uma sessão nesta data para esta agenda.' });
      }
    }

    const conflitoSessao = await findSessaoTrailerConflict({
      cervejariaId: user.cervejariaId!,
      trailerId: evento.trailerId,
      data: novaData,
      horaInicio: body.horaInicio,
      horaFim: body.horaFim,
      excludeEventoId: id,
    });
    if (conflitoSessao) {
      return reply.status(409).send({ error: trailerScheduleConflictMessage(conflitoSessao) });
    }

    const updated = await prisma.evento.update({
      where: { id },
      data: {
        nome: body.nome,
        local: body.local,
        data: novaData,
        horaInicio: body.horaInicio,
        horaFim: body.horaFim || null,
      },
      include: {
        _count: { select: eventoListCount },
        ...eventoInclude,
      },
    });

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_ATUALIZADO',
      usuarioId: user.sub,
      eventoId: id,
      metadata: { nome: updated.nome },
    });

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:updated', data: updated });
    return updated;
  });

  app.post('/:id/reverter-para-agendado', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const result = await reverterEventoParaAgendado({
      eventoId: id,
      cervejariaId: user.cervejariaId!,
      usuarioId: user.sub,
      io: app.io,
    });

    if (!('ok' in result) || !result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }

    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:deleted', data: { id } });

    return {
      modo: result.modo,
      serieId: result.serieId,
      data: result.dataKey,
      mensagem: result.mensagem,
    };
  });

  app.delete('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const evento = await prisma.evento.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
      include: { _count: { select: eventoListCount } },
    });

    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' });

    if (isSerie(evento)) {
      if (evento._count.ocorrencias > 0) {
        return reply.status(409).send({ error: 'Esta agenda já teve sessões. Não é possível remover.' });
      }
    } else {
      const abertas = await prisma.comanda.count({
        where: { eventoId: id, status: 'ABERTA' },
      });
      if (abertas > 0) {
        return reply.status(409).send({
          error: `Existem ${abertas} comanda(s) aberta(s). Feche-as antes de excluir o evento.`,
        });
      }
      const comandasComVenda = await prisma.comanda.count({
        where: { eventoId: id, ...comandaImpedeExclusaoWhere },
      });
      if (comandasComVenda > 0) {
        return reply.status(409).send({
          error: 'Evento com vendas registradas não pode ser excluído.',
        });
      }
    }

    await registrarTransacao({
      cervejariaId: user.cervejariaId!,
      tipo: 'EVENTO_EXCLUIDO',
      usuarioId: user.sub,
      eventoId: id,
      metadata: { nome: evento.nome, recorrencia: evento.recorrencia },
    });

    await prisma.evento.delete({ where: { id } });
    emitToCervejaria(app.io, user.cervejariaId!, { type: 'evento:deleted', data: { id } });
    return reply.status(204).send();
  });
}
