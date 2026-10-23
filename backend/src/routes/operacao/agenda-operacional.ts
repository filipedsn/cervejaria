import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { canonicalPdvQaActivationEnabled, readCanonicalPdvOperationalSettingsIfEnabled } from '../../lib/canonical-pdv-operational-config.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';
import { getAuthUser } from '../../types/auth.js';
import { archiveAgenda, assertNoAgendaConflict, cancelOccurrence, generateAgendaDates, lockAgendaPdv, lockAgendaResource, occurrenceBlock, occurrenceRestoreBlock, occurrencesOutsideRange, restoreOccurrence, resumeAgenda, saveAgendamento, saveAndActivateAgenda, stopAgenda, validateAgendaInterval } from '../../lib/operacao/agenda.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato AAAA-MM-DD');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const agendaCreateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: timeSchema,
  horaFim: timeSchema,
  primeiraData: dateSchema,
  ultimaData: dateSchema.nullable().optional(),
  local: z.string().trim().max(160).nullable().optional(),
}).strict();
const agendaUpdateSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  diaSemana: z.number().int().min(0).max(6).optional(),
  horaInicio: timeSchema.optional(),
  horaFim: timeSchema.optional(),
  ultimaData: dateSchema.nullable().optional(),
  local: z.string().trim().max(160).nullable().optional(),
}).strict();
const occurrenceCreateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  data: dateSchema,
  horaInicio: timeSchema,
  horaFim: timeSchema,
  local: z.string().trim().max(160).nullable().optional(),
}).strict();
const generationSchema = z.object({ inicio: dateSchema, fim: dateSchema }).strict();
const restorationSchema = z.object({ requestId: z.string().uuid(), data: dateSchema.optional(), horaInicio: timeSchema.nullable().optional(), horaFim: timeSchema.nullable().optional() }).strict();
const resumeSchema = z.object({ requestId: z.string().uuid(), aPartirDe: dateSchema.optional() }).strict();
const activateAgendaSchema = z.object({ requestId: z.string().uuid(), aPartirDe: dateSchema.optional(), nome: z.string().trim().min(1).max(120), diaSemana: z.number().int().min(0).max(6), horaInicio: timeSchema, horaFim: timeSchema, local: z.string().trim().max(160).nullable(), ultimaData: dateSchema.nullable() }).strict();
const schedulingSchema = occurrenceCreateSchema.extend({
  horaInicio: timeSchema.optional(), horaFim: timeSchema.nullable().optional(),
  requestId: z.string().uuid(), repetirSemanalmente: z.boolean(),
  diaSemana: z.number().int().min(0).max(6).optional(), ocorrenciaId: z.string().min(1).optional(),
  fim: dateSchema.nullable().optional(), gerarDatas: z.boolean().optional(),
}).strict();

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error('Data de calendário inválida'), { statusCode: 400 });
  }
  return date;
}

async function canonicalPointId(cervejariaId: string): Promise<string | null> {
  const settings = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId);
  return settings?.pointId ?? null;
}

export async function agendaOperacionalRoutes(app: FastifyInstance) {
  app.get('/ocorrencias', async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const query = z.object({ inicio: dateSchema, fim: dateSchema }).strict().parse(request.query);
    const inicio = parseDateOnly(query.inicio);
    const fim = parseDateOnly(query.fim);
    if (fim < inicio || fim.getTime() - inicio.getTime() > 366 * 86400000) return reply.status(400).send({ error: 'Informe um período válido de até 366 dias' });
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const ocorrencias = await prisma.ocorrenciaOperacional.findMany({
      where: { cervejariaId: request.operacao.cervejariaId, pontoVendaId, data: { gte: inicio, lte: fim } },
      include: { agenda: { select: { id: true, nome: true, frequencia: true, diaSemana: true, archivedAt: true } }, _count: { select: { sessoesCaixa: true, comandas: true } } },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { nome: 'asc' }],
    });
    const agendas = await prisma.agendaOperacional.findMany({ where: { cervejariaId: request.operacao.cervejariaId, pontoVendaId, archivedAt: null }, include: { _count: { select: { ocorrencias: true } } }, orderBy: [{ diaSemana: 'asc' }, { nome: 'asc' }] });
    return { agendas, ocorrencias: ocorrencias.map((o) => ({ ...o, data: o.data.toISOString().slice(0, 10), bloqueio: occurrenceBlock(o), podeEditar: !occurrenceBlock(o), podeCancelar: !occurrenceBlock(o), podeRestaurar: !occurrenceRestoreBlock(o), bloqueioRestauracao: occurrenceRestoreBlock(o) })) };
  });

  app.get('/agendas/arquivadas', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'PDV canônico indisponível' });
    return { agendas: await prisma.agendaOperacional.findMany({ where: { cervejariaId, pontoVendaId, archivedAt: { not: null } }, include: { _count: { select: { ocorrencias: true } } }, orderBy: [{ archivedAt: 'desc' }, { nome: 'asc' }] }) };
  });
  app.post('/agendas/:id/arquivar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'PDV canônico indisponível' });
    return prisma.$transaction((tx) => archiveAgenda(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id), { timeout: 15000 });
  });

  app.post('/agendamentos', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const body = schedulingSchema.parse(request.body);
    const cervejariaId = request.operacao.cervejariaId;
    const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'A empresa precisa ter exatamente um PDV ativo' });
    try {
      return await prisma.$transaction((tx) => saveAgendamento(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, body), { timeout: 15000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return reply.status(409).send({ error: 'Esta repetição já possui um agendamento nessa data.' });
      throw error;
    }
  });

  app.post('/ocorrencias/:id/cancelar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'PDV canônico indisponível' });
    return prisma.$transaction((tx) => cancelOccurrence(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id), { timeout: 15000 });
  });
  app.post('/ocorrencias/:id/restaurar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = restorationSchema.parse(request.body);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'PDV canônico indisponível' });
    return prisma.$transaction((tx) => restoreOccurrence(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id, body), { timeout: 15000 });
  });
  app.post('/agendas/:id/interromper', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponível nesta instalação' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ error: 'PDV canônico indisponível' });
    return prisma.$transaction((tx) => stopAgenda(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id), { timeout: 15000 });
  });

  app.post('/agendas/:id/retomar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponÃ­vel nesta instalaÃ§Ã£o' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = resumeSchema.parse(request.body);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'PDV canÃ´nico indisponÃ­vel' });
    return prisma.$transaction((tx) => resumeAgenda(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id, body), { timeout: 15000 });
  });

  app.post('/agendas/:id/salvar-e-ativar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ error: 'Agenda operacional indisponÃ­vel nesta instalaÃ§Ã£o' });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = activateAgendaSchema.parse(request.body);
    const cervejariaId = request.operacao.cervejariaId; const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'PDV canÃ´nico indisponÃ­vel' });
    return prisma.$transaction((tx) => saveAndActivateAgenda(tx, { cervejariaId, pontoVendaId, usuarioId: getAuthUser(request).sub }, id, body), { timeout: 20000 });
  });

  app.post('/agendas', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const body = agendaCreateSchema.parse(request.body);
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    validateAgendaInterval(body.horaInicio, body.horaFim);
    if (body.ultimaData && body.ultimaData < body.primeiraData) return reply.status(400).send({ code: 'AGENDA_PERIODO_INVALIDO', error: 'O término deve ser igual ou posterior ao início.' });
    const first = parseDateOnly(body.primeiraData); const last = body.ultimaData ? parseDateOnly(body.ultimaData) : null;
    const cervejariaId = request.operacao.cervejariaId; const usuarioId = getAuthUser(request).sub;
    const agenda = await prisma.$transaction(async (tx) => {
      const scope = { cervejariaId, pontoVendaId };
      await lockAgendaPdv(tx, scope);
      const created = await tx.agendaOperacional.create({ data: { ...body, primeiraData: first, ultimaData: last, ativa: false, frequencia: 'SEMANAL', cervejariaId, pontoVendaId } });
      await tx.transacaoLog.create({ data: { cervejariaId, usuarioId, tipo: 'EVENTO_ATUALIZADO', entidadeTipo: 'AgendaOperacional', entidadeId: created.id, metadata: { acao: 'REPETICAO_DEFINIDA', pontoVendaId, atorId: usuarioId, primeiraData: body.primeiraData, ultimaData: body.ultimaData, ativa: false } } });
      return created;
    }, { timeout: 15000 });
    return reply.status(201).send(agenda);
  });

  app.patch('/agendas/:agendaId', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const { agendaId } = z.object({ agendaId: z.string().min(1) }).parse(request.params);
    const body = agendaUpdateSchema.parse(request.body);
    if (Object.keys(body).length === 0) return reply.status(400).send({ error: 'Informe pelo menos um campo para editar' });
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const updated = await prisma.$transaction(async (tx) => {
      await lockAgendaPdv(tx, { cervejariaId: request.operacao.cervejariaId, pontoVendaId });
      await lockAgendaResource(tx, { cervejariaId: request.operacao.cervejariaId, pontoVendaId }, 'regra', agendaId);
      const current = await tx.agendaOperacional.findFirst({ where: { id: agendaId, cervejariaId: request.operacao.cervejariaId, pontoVendaId, archivedAt: null } });
      if (!current) return null;
      const nextFirst = current.primeiraData?.toISOString().slice(0, 10) ?? null;
      const nextLast = body.ultimaData !== undefined ? body.ultimaData : (current.ultimaData?.toISOString().slice(0, 10) ?? null);
      const first = current.primeiraData; const last = nextLast ? parseDateOnly(nextLast) : null;
      if (nextFirst && nextLast && nextLast < nextFirst) throw Object.assign(new Error('O tÃ©rmino deve ser igual ou posterior ao inÃ­cio.'), { statusCode: 400, code: 'AGENDA_PERIODO_INVALIDO' });
      if (body.horaInicio !== undefined || body.horaFim !== undefined) {
        validateAgendaInterval(body.horaInicio ?? current.horaInicio, body.horaFim ?? current.horaFim);
      }
      const foraDoPeriodo = body.ultimaData !== undefined ? await occurrencesOutsideRange(tx, { cervejariaId: request.operacao.cervejariaId, pontoVendaId }, agendaId, first, last) : [];
      const data = { ...body, ...(body.ultimaData !== undefined ? { ultimaData: last } : {}) };
      const agenda = await tx.agendaOperacional.update({ where: { id: agendaId }, data });
      await tx.transacaoLog.create({ data: { cervejariaId: request.operacao.cervejariaId, usuarioId: getAuthUser(request).sub, tipo: 'EVENTO_ATUALIZADO', entidadeTipo: 'AgendaOperacional', entidadeId: agendaId, metadata: { acao: 'REPETICAO_DEFINICAO_ATUALIZADA', pontoVendaId, atorId: getAuthUser(request).sub, campos: Object.keys(body), primeiraData: agenda.primeiraData?.toISOString().slice(0, 10) ?? null, ultimaData: agenda.ultimaData?.toISOString().slice(0, 10) ?? null } } });
      return { agenda, foraDoPeriodo };
    });
    if (!updated) return reply.status(404).send({ error: 'Agenda não encontrada' });
    return { ...updated.agenda, ...(updated.foraDoPeriodo.length ? { foraDoPeriodo: updated.foraDoPeriodo } : {}) };
  });

  app.post('/ocorrencias', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const body = occurrenceCreateSchema.parse(request.body);
    validateAgendaInterval(body.horaInicio, body.horaFim);
    const cervejariaId = request.operacao.cervejariaId;
    const pontoVendaId = await canonicalPointId(cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const data = parseDateOnly(body.data);
    const ocorrencia = await prisma.$transaction(async (tx) => {
      const scope = { cervejariaId, pontoVendaId };
      await lockAgendaPdv(tx, scope);
      await assertNoAgendaConflict(tx, scope, { data, horaInicio: body.horaInicio, horaFim: body.horaFim });
      return tx.ocorrenciaOperacional.create({ data: { ...body, data, cervejariaId, pontoVendaId } });
    }, { timeout: 15000 });
    return reply.status(201).send({ ...ocorrencia, data: ocorrencia.data.toISOString().slice(0, 10) });
  });

  app.post('/agendas/:agendaId/gerar', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const { agendaId } = z.object({ agendaId: z.string().min(1) }).parse(request.params);
    const body = generationSchema.parse(request.body);
    const inicio = parseDateOnly(body.inicio);
    const fim = parseDateOnly(body.fim);
    const dayCount = Math.floor((fim.getTime() - inicio.getTime()) / 86400000);
    if (dayCount < 0 || dayCount > 366) return reply.status(400).send({ error: 'Informe um período válido de até 366 dias' });
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const result = await prisma.$transaction(async (tx) => {
      const generated = await generateAgendaDates(tx, { cervejariaId: request.operacao.cervejariaId, pontoVendaId }, agendaId, body.inicio, body.fim);
      return { criadas: generated.criadas, ocorrencias: generated.datas };
    });
    return result;
  });
}
