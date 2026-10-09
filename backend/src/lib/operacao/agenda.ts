import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Scope = { cervejariaId: string; pontoVendaId: string; usuarioId: string };
export type AgendamentoInput = { requestId: string; nome: string; data: string; horaInicio: string; horaFim?: string | null; local?: string | null; ocorrenciaId?: string; repetirSemanalmente: boolean; agendaId?: string; fim?: string; gerarDatas?: boolean };
type Resultado = { agendaId?: string; ocorrenciaId?: string; criadas: number; datas: string[] };
export function agendaError(message: string, statusCode = 409) { return Object.assign(new Error(message), { statusCode }); }
export function parseAgendaDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw agendaError('Data de calendário inválida', 400);
  return date;
}
export async function lockAgendaResource(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, scope: Pick<Scope, 'cervejariaId' | 'pontoVendaId'>, kind: string, id: string) {
  const digest = createHash('sha256').update(`agenda:${scope.cervejariaId}:${scope.pontoVendaId}:${kind}:${id}`).digest();
  const key = BigInt.asIntN(64, digest.readBigUInt64BE(0));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;
}
export function occurrenceBlock(occurrence: { status: string; _count: { sessoesCaixa: number; comandas: number } }) {
  if (occurrence._count.sessoesCaixa || occurrence._count.comandas) return 'Este agendamento possui histórico operacional ou de caixa. Seus dados e status são preservados.';
  if (occurrence.status !== 'PROGRAMADA') return 'Somente agendamentos programados e sem histórico operacional podem ser editados ou cancelados.';
  return null;
}
export async function generateAgendaDates(tx: Prisma.TransactionClient, scope: Pick<Scope, 'cervejariaId' | 'pontoVendaId'>, agendaId: string, inicio: string, fim: string) {
  const start = parseAgendaDate(inicio); const end = parseAgendaDate(fim);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (days < 0 || days > 366) throw agendaError('Informe um período válido de até 366 dias', 400);
  await lockAgendaResource(tx, scope, 'regra', agendaId);
  const agenda = await tx.agendaOperacional.findFirst({ where: { id: agendaId, ...scope } });
  if (!agenda) throw agendaError('Repetição não encontrada', 404);
  if (!agenda.ativa) throw agendaError('Esta repetição está inativa. Nenhuma nova data pode ser agendada.');
  const dates: Date[] = [];
  for (let offset = 0; offset <= days; offset++) {
    const date = new Date(start.getTime() + offset * 86400000);
    if (date.getUTCDay() === agenda.diaSemana) dates.push(date);
  }
  const inserted = dates.length ? await tx.ocorrenciaOperacional.createMany({
    data: dates.map((data) => ({ ...scope, agendaId, nome: agenda.nome, data, horaInicio: agenda.horaInicio, horaFim: agenda.horaFim, local: agenda.local, status: 'PROGRAMADA' as const })), skipDuplicates: true,
  }) : { count: 0 };
  return { criadas: inserted.count, datas: dates.map((date) => date.toISOString().slice(0, 10)) };
}

/** The audit receipt is also the durable retry result, committed with all domain writes. */
export async function saveAgendamento(tx: Prisma.TransactionClient, scope: Scope, input: AgendamentoInput): Promise<Resultado> {
  const { usuarioId, ...whereScope } = scope;
  const receiptId = `agenda-${createHash('sha256').update(`${scope.cervejariaId}:${scope.pontoVendaId}:${input.requestId}`).digest('hex')}`;
  await lockAgendaResource(tx, scope, 'request', receiptId);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const receipt = await tx.transacaoLog.findUnique({ where: { id: receiptId } });
  if (receipt) {
    const metadata = receipt.metadata as { fingerprint?: string; resultado?: Resultado };
    if (metadata.fingerprint !== fingerprint || !metadata.resultado) throw agendaError('Esta tentativa já foi salva com outros dados. Reabra o formulário para iniciar um novo agendamento.');
    return metadata.resultado;
  }
  const data = parseAgendaDate(input.data);
  const fields = { nome: input.nome, horaInicio: input.horaInicio, ...(input.horaFim !== undefined ? { horaFim: input.horaFim } : {}), ...(input.local !== undefined ? { local: input.local } : {}) };
  let resultado: Resultado;
  if (input.repetirSemanalmente) {
    if (input.ocorrenciaId) throw agendaError('Edite a repetição separadamente deste agendamento.', 400);
    const end = input.fim ? parseAgendaDate(input.fim) : null;
    if (!end || end < data || end.getTime() - data.getTime() > 366 * 86400000) throw agendaError('Informe o término da repetição, em um período de até 366 dias.', 400);
    let agendaId = input.agendaId;
    if (agendaId) {
      await lockAgendaResource(tx, scope, 'regra', agendaId);
      const agenda = await tx.agendaOperacional.findFirst({ where: { id: agendaId, ...whereScope } });
      if (!agenda) throw agendaError('Repetição não encontrada', 404);
      if (!agenda.ativa && input.gerarDatas !== false) throw agendaError('Esta repetição está inativa. Salve somente sua definição, sem agendar novas datas.');
      await tx.agendaOperacional.update({ where: { id: agendaId }, data: { ...fields, diaSemana: data.getUTCDay() } });
    } else {
      const agenda = await tx.agendaOperacional.create({ data: { ...whereScope, ...fields, diaSemana: data.getUTCDay(), frequencia: 'SEMANAL', ativa: true } });
      agendaId = agenda.id;
    }
    const generated = input.agendaId && input.gerarDatas === false ? { criadas: 0, datas: [] } : await generateAgendaDates(tx, whereScope, agendaId, input.data, input.fim!);
    resultado = { agendaId, ...generated };
  } else {
    if (input.agendaId) throw agendaError('Uma repetição existente não pode ser convertida em agendamento único.', 400);
    let ocorrenciaId = input.ocorrenciaId;
    if (ocorrenciaId) {
      await lockAgendaResource(tx, scope, 'ocorrencia', ocorrenciaId);
      const occurrence = await tx.ocorrenciaOperacional.findFirst({ where: { id: ocorrenciaId, ...whereScope }, include: { _count: { select: { sessoesCaixa: true, comandas: true } } } });
      if (!occurrence) throw agendaError('Agendamento não encontrado', 404);
      const block = occurrenceBlock(occurrence); if (block) throw agendaError(block);
      // The series ID and all existing operational history are immutable here.
      await tx.ocorrenciaOperacional.update({ where: { id: ocorrenciaId }, data: { ...fields, data } });
    } else {
      const occurrence = await tx.ocorrenciaOperacional.create({ data: { ...whereScope, ...fields, data } });
      ocorrenciaId = occurrence.id;
    }
    resultado = { ocorrenciaId, criadas: input.ocorrenciaId ? 0 : 1, datas: [input.data] };
  }
  await tx.transacaoLog.create({ data: { id: receiptId, cervejariaId: scope.cervejariaId, usuarioId, tipo: 'EVENTO_ATUALIZADO', entidadeTipo: resultado.agendaId ? 'AgendaOperacional' : 'OcorrenciaOperacional', entidadeId: resultado.agendaId ?? resultado.ocorrenciaId, metadata: { acao: 'AGENDAMENTO_SALVO', pontoVendaId: scope.pontoVendaId, fingerprint, resultado } } });
  return resultado;
}

export async function cancelOccurrence(tx: Prisma.TransactionClient, scope: Scope, id: string) {
  const { usuarioId, ...whereScope } = scope;
  await lockAgendaResource(tx, scope, 'ocorrencia', id);
  const occurrence = await tx.ocorrenciaOperacional.findFirst({ where: { id, ...whereScope }, include: { _count: { select: { sessoesCaixa: true, comandas: true } } } });
  if (!occurrence) throw agendaError('Agendamento não encontrado', 404);
  if (occurrence.status === 'CANCELADA') return { id, status: occurrence.status };
  const block = occurrenceBlock(occurrence); if (block) throw agendaError(block);
  await tx.ocorrenciaOperacional.update({ where: { id }, data: { status: 'CANCELADA' } });
  await tx.transacaoLog.create({ data: { cervejariaId: scope.cervejariaId, usuarioId, tipo: 'EVENTO_ATUALIZADO', entidadeTipo: 'OcorrenciaOperacional', entidadeId: id, metadata: { acao: 'AGENDAMENTO_CANCELADO', pontoVendaId: scope.pontoVendaId, statusAnterior: occurrence.status, status: 'CANCELADA' } } });
  return { id, status: 'CANCELADA' };
}
export async function stopAgenda(tx: Prisma.TransactionClient, scope: Scope, id: string) {
  const { usuarioId, ...whereScope } = scope;
  await lockAgendaResource(tx, scope, 'regra', id);
  const agenda = await tx.agendaOperacional.findFirst({ where: { id, ...whereScope } });
  if (!agenda) throw agendaError('Repetição não encontrada', 404);
  if (agenda.ativa) {
    await tx.agendaOperacional.update({ where: { id }, data: { ativa: false } });
    await tx.transacaoLog.create({ data: { cervejariaId: scope.cervejariaId, usuarioId, tipo: 'EVENTO_ATUALIZADO', entidadeTipo: 'AgendaOperacional', entidadeId: id, metadata: { acao: 'REPETICAO_INTERROMPIDA', pontoVendaId: scope.pontoVendaId, datasExistentesPreservadas: true } } });
  }
  return { id, ativa: false };
}
