import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { canonicalPdvQaActivationEnabled, readCanonicalPdvOperationalSettingsIfEnabled } from '../../lib/canonical-pdv-operational-config.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato AAAA-MM-DD');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const agendaCreateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: timeSchema.default('18:00'),
  horaFim: timeSchema.nullable().optional(),
  local: z.string().trim().max(160).nullable().optional(),
  ativa: z.boolean().default(true),
}).strict();
const agendaUpdateSchema = agendaCreateSchema.partial().strict();
const occurrenceCreateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  data: dateSchema,
  horaInicio: timeSchema.default('18:00'),
  horaFim: timeSchema.nullable().optional(),
  local: z.string().trim().max(160).nullable().optional(),
}).strict();
const generationSchema = z.object({ inicio: dateSchema, fim: dateSchema }).strict();

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
      include: { agenda: { select: { id: true, nome: true, frequencia: true, diaSemana: true } } },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { nome: 'asc' }],
    });
    const agendas = await prisma.agendaOperacional.findMany({ where: { cervejariaId: request.operacao.cervejariaId, pontoVendaId }, orderBy: [{ diaSemana: 'asc' }, { nome: 'asc' }] });
    return { agendas, ocorrencias: ocorrencias.map((o) => ({ ...o, data: o.data.toISOString().slice(0, 10) })) };
  });

  app.post('/agendas', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const body = agendaCreateSchema.parse(request.body);
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const agenda = await prisma.agendaOperacional.create({ data: { ...body, frequencia: 'SEMANAL', cervejariaId: request.operacao.cervejariaId, pontoVendaId } });
    return reply.status(201).send(agenda);
  });

  app.patch('/agendas/:agendaId', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const { agendaId } = z.object({ agendaId: z.string().min(1) }).parse(request.params);
    const body = agendaUpdateSchema.parse(request.body);
    if (Object.keys(body).length === 0) return reply.status(400).send({ error: 'Informe pelo menos um campo para editar' });
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const result = await prisma.agendaOperacional.updateMany({ where: { id: agendaId, cervejariaId: request.operacao.cervejariaId, pontoVendaId }, data: body });
    if (result.count !== 1) return reply.status(404).send({ error: 'Agenda não encontrada' });
    return prisma.agendaOperacional.findFirst({ where: { id: agendaId, cervejariaId: request.operacao.cervejariaId, pontoVendaId } });
  });

  app.post('/ocorrencias', { preHandler: [requirePermissaoOuDono(app, 'agenda.manage')] }, async (request, reply) => {
    if (!canonicalPdvQaActivationEnabled()) return reply.status(404).send({ code: 'OPERATIONAL_SCHEDULE_DISABLED', error: 'Agenda operacional indisponível nesta instalação' });
    const body = occurrenceCreateSchema.parse(request.body);
    const pontoVendaId = await canonicalPointId(request.operacao.cervejariaId);
    if (!pontoVendaId) return reply.status(409).send({ code: 'CANONICAL_PDV_UNAVAILABLE', error: 'A empresa precisa ter exatamente um PDV ativo' });
    const ocorrencia = await prisma.ocorrenciaOperacional.create({ data: { ...body, data: parseDateOnly(body.data), cervejariaId: request.operacao.cervejariaId, pontoVendaId } });
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
      const agenda = await tx.agendaOperacional.findFirst({ where: { id: agendaId, cervejariaId: request.operacao.cervejariaId, pontoVendaId, ativa: true } });
      if (!agenda) return null;
      const dates: Date[] = [];
      for (let offset = 0; offset <= dayCount; offset += 1) {
        const date = new Date(inicio.getTime() + offset * 86400000);
        if (date.getUTCDay() === agenda.diaSemana) dates.push(date);
      }
      const inserted = dates.length ? await tx.ocorrenciaOperacional.createMany({
        data: dates.map((data) => ({ cervejariaId: agenda.cervejariaId, pontoVendaId: agenda.pontoVendaId, agendaId: agenda.id, nome: agenda.nome, data, horaInicio: agenda.horaInicio, horaFim: agenda.horaFim, local: agenda.local, status: 'PROGRAMADA' as const })),
        skipDuplicates: true,
      }) : { count: 0 };
      return { criadas: inserted.count, ocorrencias: dates.map((date) => date.toISOString().slice(0, 10)) };
    });
    if (!result) return reply.status(404).send({ error: 'Agenda semanal ativa não encontrada' });
    return result;
  });
}
