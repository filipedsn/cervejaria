import { createHash } from 'node:crypto';
import { buildPdvPlanningGraph, readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { planPdvMigration } from './pdv-unico-migration-planner.js';

export const PDV_MIGRATION_SCOPE = 'PDV_AGENDA_OCORRENCIA_V1';
export const PDV_TRANSFORM_VERSION = 1;
const SOURCE_TYPES = ['PDV', 'TRAILER', 'EVENTO'] as const;
type SourceType = typeof SOURCE_TYPES[number];
type DestinationType = 'PONTO_VENDA' | 'AGENDA_OPERACIONAL' | 'OCORRENCIA_OPERACIONAL';
type AnyDb = any;

export class PdvMigrationBlocker extends Error {
  constructor(readonly code: string, readonly sourceType: string | null, readonly sourceId: string | null, message: string) {
    super(message);
    this.name = 'PdvMigrationBlocker';
  }
}

const stable = (value: unknown): string => {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const hash = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const dateOnly = (value: Date | null): string | null => value == null ? null : value.toISOString().slice(0, 10);
const iso = (value: Date | null): string | null => value == null ? null : value.toISOString();
const eventRole = (event: any): 'AGENDA' | 'OCORRENCIA' => event.serieId != null ? 'OCORRENCIA' : event.recorrencia === 'SEMANAL' ? 'AGENDA' : 'OCORRENCIA';
const key = (type: string, id: string) => `${type}:${id}`;
const scopeLock = (companyId: string) => `pdv-business-migration:${PDV_MIGRATION_SCOPE}:${companyId}`;

function scopePayload(snapshot: any) {
  return {
    companyId: snapshot.companyId,
    pdvs: snapshot.pdvs.map((row: any) => ({ id: row.id, cervejariaId: snapshot.companyId })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    trailers: snapshot.trailers.map((row: any) => ({ id: row.id, cervejariaId: row.cervejariaId, nome: row.nome, ativo: row.ativo, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    events: snapshot.events.map((row: any) => ({
      id: row.id, cervejariaId: row.cervejariaId, trailerId: row.trailerId, serieId: row.serieId,
      recorrencia: row.recorrencia, diaSemana: row.diaSemana, data: dateOnly(row.data),
      nome: row.nome, local: row.local, horaInicio: row.horaInicio, horaFim: row.horaFim,
      status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      trailerTenantId: row.trailer?.cervejariaId ?? null,
      seriesTenantId: row.serie?.cervejariaId ?? null,
    })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
  };
}

async function readScopeSnapshot(tx: AnyDb, companyId: string) {
  const raw = await readPdvPlanningSourceSnapshot(tx, companyId);
  if (!raw.trailers.length) return raw;
  const maps = await tx.pdvMigrationMap.findMany({ where: { sourceType: 'TRAILER', sourceId: { in: raw.trailers.map((row: any) => row.id) }, cervejariaId: companyId }, select: { sourceId: true, destinationId: true, lastRunId: true, lastBatchId: true } });
  const createdPdvIds = new Set<string>();
  for (const map of maps) {
    if (!map.lastBatchId) throw new PdvMigrationBlocker('MAP_CHECKPOINT_MISSING', 'TRAILER', map.sourceId, 'Mapa de Trailer não aponta para lote confirmado.');
    const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
    const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === 'TRAILER' && entry.sourceId === map.sourceId);
    if (!batch || batch.status !== 'CONFIRMED' || !receipt) throw new PdvMigrationBlocker('MAP_CHECKPOINT_MISSING', 'TRAILER', map.sourceId, 'Lote do mapa de Trailer não comprova o destino confirmado.');
    if (receipt.destinationCreated === true) createdPdvIds.add(map.destinationId);
  }
  return { ...raw, pdvs: raw.pdvs.filter((row: any) => !createdPdvIds.has(row.id)) };
}

function getSourcePayload(type: SourceType, row: any, companyId: string, canonicalPdvId: string) {
  if (type === 'PDV') return { transformVersion: PDV_TRANSFORM_VERSION, type, sourceId: row.id, companyId, canonicalPdvId: row.id };
  if (type === 'TRAILER') return { transformVersion: PDV_TRANSFORM_VERSION, type, sourceId: row.id, companyId, canonicalPdvId, name: row.nome, active: row.ativo, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
  const role = eventRole(row);
  return {
    transformVersion: PDV_TRANSFORM_VERSION, type, sourceId: row.id, companyId, canonicalPdvId,
    role, trailerId: row.trailerId, seriesId: row.serieId,
    recurrence: row.recorrencia, weekday: row.diaSemana, date: dateOnly(row.data),
    name: row.nome, location: row.local, start: row.horaInicio, end: row.horaFim,
    status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function expectedDestination(type: SourceType, row: any, companyId: string, pdvId: string, agendaId: string | null): { type: DestinationType; id: string; data: Record<string, unknown> } {
  if (type === 'PDV') return { type: 'PONTO_VENDA', id: pdvId, data: { id: pdvId, cervejariaId: companyId } };
  if (type === 'TRAILER') return { type: 'PONTO_VENDA', id: pdvId, data: { id: pdvId, cervejariaId: companyId, nome: row.nome, ativo: row.ativo, createdAt: row.createdAt, updatedAt: row.updatedAt } };
  if (eventRole(row) === 'AGENDA') {
    if (row.diaSemana == null) throw new PdvMigrationBlocker('AGENDA_WEEKDAY_MISSING', type, row.id, 'Definição semanal sem dia da semana de origem.');
    return { type: 'AGENDA_OPERACIONAL', id: row.id, data: { id: row.id, cervejariaId: companyId, pontoVendaId: pdvId, nome: row.nome, frequencia: 'SEMANAL', diaSemana: row.diaSemana, horaInicio: row.horaInicio, horaFim: row.horaFim, local: row.local, ativa: row.status === 'ABERTO', createdAt: row.createdAt, updatedAt: row.updatedAt } };
  }
  if (row.data == null) throw new PdvMigrationBlocker('EVENT_DATE_MISSING', type, row.id, 'Evento sem data não pode virar ocorrência datada.');
  return { type: 'OCORRENCIA_OPERACIONAL', id: row.id, data: { id: row.id, cervejariaId: companyId, pontoVendaId: pdvId, agendaId, nome: row.nome, data: row.data, horaInicio: row.horaInicio, horaFim: row.horaFim, local: row.local, status: row.status === 'ABERTO' ? 'ABERTA' : 'FECHADA', createdAt: row.createdAt, updatedAt: row.updatedAt } };
}

function normalizeDestination(type: DestinationType, row: any) {
  if (type === 'PONTO_VENDA') return { id: row.id, cervejariaId: row.cervejariaId, ...(row.nome != null ? { nome: row.nome } : {}), ...(row.ativo != null ? { ativo: row.ativo } : {}), ...(row.createdAt ? { createdAt: iso(row.createdAt) } : {}), ...(row.updatedAt ? { updatedAt: iso(row.updatedAt) } : {}) };
  if (type === 'AGENDA_OPERACIONAL') return { id: row.id, cervejariaId: row.cervejariaId, pontoVendaId: row.pontoVendaId, nome: row.nome, frequencia: row.frequencia, diaSemana: row.diaSemana, horaInicio: row.horaInicio, horaFim: row.horaFim, local: row.local, ativa: row.ativa, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
  return { id: row.id, cervejariaId: row.cervejariaId, pontoVendaId: row.pontoVendaId, agendaId: row.agendaId, nome: row.nome, data: dateOnly(row.data), horaInicio: row.horaInicio, horaFim: row.horaFim, local: row.local, status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

async function readDestination(tx: AnyDb, expected: { type: DestinationType; id: string }) {
  if (expected.type === 'PONTO_VENDA') return tx.pontoVenda.findUnique({ where: { id: expected.id } });
  if (expected.type === 'AGENDA_OPERACIONAL') return tx.agendaOperacional.findUnique({ where: { id: expected.id } });
  return tx.ocorrenciaOperacional.findUnique({ where: { id: expected.id } });
}

async function createDestination(tx: AnyDb, expected: { type: DestinationType; id: string; data: Record<string, unknown> }) {
  if (expected.type === 'PONTO_VENDA') {
    const row = await tx.pontoVenda.findUnique({ where: { id: expected.id } });
    if (row) {
      if (row.cervejariaId !== expected.data.cervejariaId) throw new PdvMigrationBlocker('DESTINATION_ID_COLLISION', null, expected.id, 'ID de PDV destino já pertence a outra empresa.');
      return false;
    }
    if (expected.data.nome === undefined) throw new PdvMigrationBlocker('CANONICAL_PDV_MISSING', 'PDV', expected.id, 'PDV canônico esperado não existe.');
    await tx.pontoVenda.create({ data: expected.data });
    return true;
  }
  const existing = await readDestination(tx, expected);
  if (existing) throw new PdvMigrationBlocker('DESTINATION_ID_COLLISION', expected.type === 'AGENDA_OPERACIONAL' ? 'EVENTO' : 'EVENTO', expected.id, 'ID de destino já existe sem mapa de origem confirmado.');
  if (expected.type === 'AGENDA_OPERACIONAL') await tx.agendaOperacional.create({ data: expected.data });
  else await tx.ocorrenciaOperacional.create({ data: expected.data });
  return true;
}

function recordsForScope(snapshot: any, graph: any, companyId: string) {
  const pdvs = [...snapshot.pdvs].sort((a: any, b: any) => a.id.localeCompare(b.id));
  const trailers = [...snapshot.trailers].sort((a: any, b: any) => a.id.localeCompare(b.id));
  if (pdvs.length > 1) throw new PdvMigrationBlocker('MULTIPLE_CANONICAL_PDVS', null, companyId, 'A empresa possui múltiplos PDVs e exige decisão manual.');
  if (trailers.length > 1) throw new PdvMigrationBlocker('MULTIPLE_TRAILERS_REQUIRES_MANUAL_COALESCING', null, companyId, 'A transformação não escolhe nem agrupa múltiplos Trailers sem decisão manual.');
  if (pdvs.length === 0 && trailers.length !== 1) throw new PdvMigrationBlocker(trailers.length === 0 ? 'CANONICAL_PDV_UNPROVEN' : 'MULTIPLE_TRAILERS_NO_CANONICAL_PDV', null, companyId, 'Sem PDV canônico, é necessário exatamente um Trailer do tenant.');
  const canonicalPdvId = pdvs[0]?.id ?? trailers[0].id;

  const graphRecords = new Map<string, any>(graph.records.map((record: any) => [key(record.type, record.id), record]));
  const planned = planPdvMigration({ companyId, pdvIds: pdvs.map((row: any) => row.id), trailerIds: trailers.map((row: any) => row.id), records: graph.records });
  const plannedByKey = new Map<string, any>(planned.map((row: any) => [key(row.sourceType, row.sourceId), row]));
  const items: Array<{ type: SourceType; id: string; row: any; role: string; expected: ReturnType<typeof expectedDestination>; payloadHash: string; dependencies: string[] }> = [];
  for (const point of pdvs) {
    const plan = plannedByKey.get(key('PDV', point.id)) as any;
    if (plan?.sourceValidation.status !== 'VALID') throw new PdvMigrationBlocker(plan?.sourceValidation.blocker?.code ?? 'SOURCE_GRAPH_BLOCKED', 'PDV', point.id, plan?.sourceValidation.blocker?.evidence ?? 'PDV bloqueado no grafo de origem.');
    const payload = getSourcePayload('PDV', point, companyId, canonicalPdvId);
    items.push({ type: 'PDV', id: point.id, row: point, role: 'PDV', expected: expectedDestination('PDV', point, companyId, canonicalPdvId, null), payloadHash: hash(payload), dependencies: [] });
  }
  for (const trailer of trailers) {
    const graphRow = graphRecords.get(key('TRAILER', trailer.id));
    const plan = plannedByKey.get(key('TRAILER', trailer.id)) as any;
    if (graphRow?.tenantId !== companyId || plan?.sourceValidation.status !== 'VALID') throw new PdvMigrationBlocker(plan?.sourceValidation.blocker?.code ?? 'SOURCE_TENANT_MISMATCH', 'TRAILER', trailer.id, plan?.sourceValidation.blocker?.evidence ?? 'Trailer não validado no tenant de origem.');
    const payload = getSourcePayload('TRAILER', trailer, companyId, canonicalPdvId);
    items.push({ type: 'TRAILER', id: trailer.id, row: trailer, role: 'TRAILER', expected: expectedDestination('TRAILER', trailer, companyId, canonicalPdvId, null), payloadHash: hash(payload), dependencies: pdvs.length ? [key('PDV', canonicalPdvId)] : [] });
  }
  const events = [...snapshot.events].sort((a: any, b: any) => a.id.localeCompare(b.id));
  for (const event of events) {
    const plan = plannedByKey.get(key('EVENTO', event.id)) as any;
    if (plan?.sourceValidation.status !== 'VALID') throw new PdvMigrationBlocker(plan?.sourceValidation.blocker?.code ?? 'SOURCE_GRAPH_BLOCKED', 'EVENTO', event.id, plan?.sourceValidation.blocker?.evidence ?? 'Evento bloqueado no grafo de origem.');
    const role = eventRole(event);
    if (role === 'AGENDA' && event.diaSemana == null) throw new PdvMigrationBlocker('AGENDA_WEEKDAY_MISSING', 'EVENTO', event.id, 'Definição semanal sem dia da semana de origem.');
    if (role === 'OCORRENCIA' && event.data == null) throw new PdvMigrationBlocker('EVENT_DATE_MISSING', 'EVENTO', event.id, 'Evento sem data não pode virar ocorrência datada.');
    if (role === 'OCORRENCIA' && event.serieId) {
      const parent = events.find((candidate: any) => candidate.id === event.serieId);
      if (!parent || parent.serieId != null || parent.recorrencia !== 'SEMANAL') throw new PdvMigrationBlocker('SERIES_DEFINITION_INVALID', 'EVENTO', event.id, 'Ocorrência aponta para uma definição semanal ausente ou inválida.');
    }
    const payload = getSourcePayload('EVENTO', event, companyId, canonicalPdvId);
    const deps = [key('TRAILER', event.trailerId)];
    if (role === 'OCORRENCIA' && event.serieId) deps.push(key('EVENTO', event.serieId));
    items.push({ type: 'EVENTO', id: event.id, row: event, role, expected: expectedDestination('EVENTO', event, companyId, canonicalPdvId, null), payloadHash: hash(payload), dependencies: deps });
  }
  items.sort((a, b) => {
    const order = (item: typeof a) => item.type === 'PDV' ? 0 : item.type === 'TRAILER' ? 1 : item.role === 'AGENDA' ? 2 : 3;
    return order(a) - order(b) || a.id.localeCompare(b.id);
  });
  for (const item of items) {
    if (item.type === 'EVENTO' && item.role === 'OCORRENCIA' && item.row.serieId) {
      const agendaItem = items.find((candidate) => candidate.type === 'EVENTO' && candidate.id === item.row.serieId && candidate.role === 'AGENDA');
      if (!agendaItem) throw new PdvMigrationBlocker('SERIES_AGENDA_UNMAPPED', 'EVENTO', item.id, 'A agenda recorrente da ocorrência não está mapeada.');
      item.expected = expectedDestination('EVENTO', item.row, companyId, canonicalPdvId, agendaItem.id);
    }
  }
  return { canonicalPdvId, items };
}

async function acquireScopeLock(tx: AnyDb, companyId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeLock(companyId)}, 0)) IS NULL AS acquired`;
}

async function getConfirmedDependency(tx: AnyDb, companyId: string, pdvId: string, sourceType: string, sourceId: string) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pdvId || !map.lastBatchId) throw new PdvMigrationBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Dependência de origem ainda não tem mapa confirmado para o tenant/PDV.');
  const expectedType = sourceType === 'EVENTO' ? 'AGENDA_OPERACIONAL' : 'PONTO_VENDA';
  if (map.destinationType !== expectedType) throw new PdvMigrationBlocker('DEPENDENCY_DESTINATION_TYPE_MISMATCH', sourceType, sourceId, 'Mapa da dependência aponta para tipo de destino incompatível.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  if (!batch || batch.status !== 'CONFIRMED') throw new PdvMigrationBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Lote da dependência não está confirmado.');
  const receipt = (batch.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === sourceType && entry.sourceId === sourceId);
  if (!receipt || receipt.destinationId !== map.destinationId || receipt.destinationType !== map.destinationType) throw new PdvMigrationBlocker('DEPENDENCY_CHECKPOINT_DIVERGED', sourceType, sourceId, 'Checkpoint da dependência não confirma a identidade do mapa.');
  const target = await readDestination(tx, { type: map.destinationType as DestinationType, id: map.destinationId });
  if (!target || hash(normalizeDestination(map.destinationType as DestinationType, target)) !== receipt.destinationHash) throw new PdvMigrationBlocker('DEPENDENCY_DESTINATION_DIVERGED', sourceType, sourceId, 'Destino da dependência ausente ou adulterado.');
  return map;
}

async function verifyExistingMap(tx: AnyDb, item: any, companyId: string, pdvId: string) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: item.type, sourceId: item.id } } });
  if (!map) return null;
  if (map.cervejariaId !== companyId || map.pontoVendaId !== pdvId || map.destinationType !== item.expected.type || map.destinationId !== item.expected.id) throw new PdvMigrationBlocker('MAP_IDENTITY_MISMATCH', item.type, item.id, 'Mapa persistido aponta para empresa, PDV ou destino diferente do contrato atual.');
  if (map.transformVersion !== PDV_TRANSFORM_VERSION || map.payloadHash !== item.payloadHash) throw new PdvMigrationBlocker('SOURCE_PAYLOAD_CHANGED', item.type, item.id, 'Versão/hash do payload diverge do mapa persistido; destino não será sobrescrito.');
  if (!map.lastBatchId) throw new PdvMigrationBlocker('MAP_CHECKPOINT_MISSING', item.type, item.id, 'Mapa persistido não aponta para lote confirmado.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  if (!batch || batch.status !== 'CONFIRMED') throw new PdvMigrationBlocker('MAP_CHECKPOINT_MISSING', item.type, item.id, 'Mapa não referencia lote confirmado.');
  const checkpoint = batch.checkpoint as any;
  const receipt = checkpoint?.receipts?.find((entry: any) => entry.sourceType === item.type && entry.sourceId === item.id);
  if (!receipt || receipt.destinationType !== item.expected.type || receipt.destinationId !== item.expected.id || receipt.payloadHash !== item.payloadHash) throw new PdvMigrationBlocker('MAP_CHECKPOINT_MISSING', item.type, item.id, 'Checkpoint confirmado não comprova este destino e payload.');
  const destination = await readDestination(tx, item.expected);
  if (!destination) throw new PdvMigrationBlocker('MAPPED_DESTINATION_MISSING', item.type, item.id, 'Destino registrado no mapa não existe.');
  const actualHash = hash(normalizeDestination(item.expected.type, destination));
  if (actualHash !== receipt.destinationHash) throw new PdvMigrationBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, 'Conteúdo do destino diverge do recibo do lote confirmado.');
  return map;
}

async function validateConfirmedState(tx: AnyDb, input: { run: any; companyId: string; pdvId: string; sourceHash: string; items: any[]; requireComplete?: boolean }) {
  const { run, companyId, pdvId, sourceHash, items } = input;
  const checkpoint = run.checkpoint as any;
  const orderedKeys = items.map((item) => key(item.type, item.id));
  const expectedCheckpoint = makeRunCheckpoint(companyId, sourceHash, items);
  if (run.transformVersion !== PDV_TRANSFORM_VERSION || run.sourceSnapshotHash !== sourceHash || checkpoint?.scope !== PDV_MIGRATION_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.sourceSnapshotHash !== sourceHash || checkpoint?.transformVersion !== PDV_TRANSFORM_VERSION || checkpoint?.totalRecords !== items.length || stable(checkpoint?.scopeCounts) !== stable(expectedCheckpoint.scopeCounts) || stable(checkpoint?.sourceTypes) !== stable([...SOURCE_TYPES])) {
    throw new PdvMigrationBlocker('RUN_SCOPE_OR_SNAPSHOT_MISMATCH', null, companyId, 'Run e checkpoint divergem do escopo, versão ou fotografia atuais.');
  }
  const completedKeys: string[] = checkpoint.completedSourceKeys ?? [];
  if (!Array.isArray(checkpoint.completedSourceKeys) || completedKeys.length > orderedKeys.length || completedKeys.some((sourceKey, index) => sourceKey !== orderedKeys[index])) {
    throw new PdvMigrationBlocker('RUN_CHECKPOINT_DIVERGED', null, companyId, 'Checkpoint não é prefixo da ordem determinística da fotografia.');
  }
  const cursor = completedKeys.length;
  if (input.requireComplete && cursor !== orderedKeys.length) throw new PdvMigrationBlocker('RUN_SCOPE_INCOMPLETE', null, companyId, 'O run concluído não contém todas as origens do escopo em ordem.');
  if ((checkpoint.lastSourceKey ?? null) !== (completedKeys.at(-1) ?? null)) throw new PdvMigrationBlocker('RUN_CHECKPOINT_DIVERGED', null, companyId, 'lastSourceKey diverge do prefixo confirmado.');

  const batches = await tx.pdvMigrationBatch.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } });
  if ((checkpoint.lastConfirmedBatch ?? 0) !== batches.length) throw new PdvMigrationBlocker('RUN_BATCH_ORDER_DIVERGED', null, companyId, 'A quantidade de lotes diverge do checkpoint confirmado.');
  let covered = 0;
  const batchForKey = new Map<string, any>();
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const batchCheckpoint = batch.checkpoint as any;
    const receipts: any[] = batchCheckpoint?.receipts ?? [];
    const before = batchCheckpoint?.sourceCursorBefore;
    const after = batchCheckpoint?.sourceCursorAfter;
    if (batch.sequence !== index + 1 || batch.status !== 'CONFIRMED' || before !== covered || !Number.isInteger(after) || after <= before || after > cursor || receipts.length !== after - before) {
      throw new PdvMigrationBlocker('RUN_BATCH_ORDER_DIVERGED', null, companyId, 'Ordem, estado ou intervalo de um lote confirmado diverge do checkpoint.');
    }
    const batchItems = items.slice(before, after);
    const expectedBatchHash = hash(batchItems.map((item) => ({ sourceType: item.type, sourceId: item.id, payloadHash: item.payloadHash })));
    if (batch.payloadHash !== expectedBatchHash) throw new PdvMigrationBlocker('RUN_RECEIPT_DIVERGED', null, companyId, 'Hash do lote diverge das origens confirmadas.');
    for (let receiptIndex = 0; receiptIndex < batchItems.length; receiptIndex++) {
      const item = batchItems[receiptIndex];
      const receipt = receipts[receiptIndex];
      if (receipt.sourceType !== item.type || receipt.sourceId !== item.id || receipt.destinationType !== item.expected.type || receipt.destinationId !== item.expected.id || receipt.payloadHash !== item.payloadHash || typeof receipt.destinationHash !== 'string' || typeof receipt.destinationCreated !== 'boolean') {
        throw new PdvMigrationBlocker('RUN_RECEIPT_DIVERGED', item.type, item.id, 'Recibo do lote diverge da origem ou do destino esperado.');
      }
      const destination = await readDestination(tx, item.expected);
      if (!destination) throw new PdvMigrationBlocker('MAPPED_DESTINATION_MISSING', item.type, item.id, 'Destino indicado no recibo deste run não existe.');
      if (hash(normalizeDestination(item.expected.type, destination)) !== receipt.destinationHash) throw new PdvMigrationBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, 'Destino diverge do recibo deste run.');
      batchForKey.set(key(item.type, item.id), batch);
    }
    covered = after;
  }
  if (covered !== cursor) throw new PdvMigrationBlocker('RUN_BATCH_ORDER_DIVERGED', null, companyId, 'Lotes confirmados não cobrem exatamente o prefixo do checkpoint.');

  for (const item of items.slice(0, cursor)) {
    for (const dependencyKey of item.dependencies) {
      const [dependencyType, dependencyId] = dependencyKey.split(':', 2);
      if (!completedKeys.includes(dependencyKey)) throw new PdvMigrationBlocker('DEPENDENCY_NOT_CONFIRMED', dependencyType, dependencyId, 'Dependência não aparece antes do registro no prefixo confirmado.');
      await getConfirmedDependency(tx, companyId, pdvId, dependencyType, dependencyId);
    }
    const map = await verifyExistingMap(tx, item, companyId, pdvId);
    if (!map || !batchForKey.has(key(item.type, item.id))) throw new PdvMigrationBlocker('CHECKPOINT_MAP_MISSING', item.type, item.id, 'Origem confirmada não possui mapa íntegro e recibo neste run.');
  }
  return { completedKeys, cursor, batches };
}

function makeRunCheckpoint(companyId: string, sourceHash: string, items: any[]) {
  const counts = { PDV: 0, TRAILER: 0, AGENDA: 0, OCORRENCIA: 0 };
  for (const item of items) {
    if (item.type === 'PDV') counts.PDV++;
    else if (item.type === 'TRAILER') counts.TRAILER++;
    else if (item.role === 'AGENDA') counts.AGENDA++;
    else counts.OCORRENCIA++;
  }
  return { scope: PDV_MIGRATION_SCOPE, companyId, sourceTypes: [...SOURCE_TYPES], sourceSnapshotHash: sourceHash, transformVersion: PDV_TRANSFORM_VERSION, scopeCounts: counts, totalRecords: items.length, completedSourceKeys: [], lastConfirmedBatch: 0, lastSourceKey: null };
}

export async function runPdvBusinessMigration(options: {
  db: AnyDb; companyId: string; runId: string; batchSize?: number; maxBatches?: number;
  afterDestinationWrite?: (entry: { sourceType: string; sourceId: string; destinationId: string }) => Promise<void> | void;
  afterBatchCommit?: (entry: { sequence: number; completedSourceKeys: string[] }) => Promise<void> | void;
  beforeFinalization?: () => Promise<void> | void;
}) {
  const { db, companyId, runId } = options;
  const batchSize = options.batchSize ?? 10;
  if (!companyId || !runId || !Number.isInteger(batchSize) || batchSize < 1) throw new Error('companyId, runId e batchSize válido são obrigatórios.');
  const initialSnapshot = await db.$transaction((tx: AnyDb) => readScopeSnapshot(tx, companyId), { isolationLevel: 'RepeatableRead' });
  const graph = buildPdvPlanningGraph(initialSnapshot);
  const sourceProjection = scopePayload(initialSnapshot);
  const sourceHash = hash(sourceProjection);
  let plan: ReturnType<typeof recordsForScope>;
  let preflightBlocker: PdvMigrationBlocker | null = null;
  try { plan = recordsForScope(initialSnapshot, graph, companyId); }
  catch (error) {
    if (!(error instanceof PdvMigrationBlocker)) throw error;
    preflightBlocker = error;
    plan = { canonicalPdvId: initialSnapshot.pdvs[0]?.id ?? initialSnapshot.trailers[0]?.id ?? '', items: [] };
  }
  const initialCheckpoint = makeRunCheckpoint(companyId, sourceHash, plan.items);
  let run: AnyDb;
  let processedBatches = 0;
  let cursor = 0;
  try {
    run = await db.$transaction(async (tx: AnyDb) => {
      await acquireScopeLock(tx, companyId);
      const currentSnapshot = await readScopeSnapshot(tx, companyId);
      if (hash(scopePayload(currentSnapshot)) !== sourceHash) throw new PdvMigrationBlocker('SOURCE_SNAPSHOT_CHANGED', null, companyId, 'A fotografia de origem mudou antes da inicialização/retomada do run.');
      return await tx.pdvMigrationRun.findUnique({ where: { id: runId } }) ?? await tx.pdvMigrationRun.create({ data: { id: runId, transformVersion: PDV_TRANSFORM_VERSION, sourceSnapshotHash: sourceHash, checkpoint: initialCheckpoint } });
    });
    if (preflightBlocker) throw preflightBlocker;
    const initialState = await db.$transaction(async (tx: AnyDb) => {
      await acquireScopeLock(tx, companyId);
      const liveSnapshot = await readScopeSnapshot(tx, companyId);
      if (hash(scopePayload(liveSnapshot)) !== sourceHash) throw new PdvMigrationBlocker('SOURCE_SNAPSHOT_CHANGED', null, companyId, 'A fotografia de origem mudou durante a retomada.');
      const liveRun = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
      const state = await validateConfirmedState(tx, { run: liveRun, companyId, pdvId: plan.canonicalPdvId, sourceHash, items: plan.items, requireComplete: liveRun.status === 'COMPLETED' });
      if (state.cursor > 0) {
        const canonical = await tx.pontoVenda.findUnique({ where: { id: plan.canonicalPdvId } });
        if (!canonical || canonical.cervejariaId !== companyId) throw new PdvMigrationBlocker('CANONICAL_PDV_MISSING', null, plan.canonicalPdvId, 'PDV canônico ausente ou de outra empresa.');
      }
      return { run: liveRun, state };
    });
    run = initialState.run;
    cursor = initialState.state.cursor;
    if (run.status === 'COMPLETED') return { status: 'COMPLETED', runId, checkpoint: run.checkpoint, reusedCompletedRun: true };
    while (cursor < plan.items.length && (options.maxBatches == null || processedBatches < options.maxBatches)) {
      let batchEnd = Math.min(cursor + batchSize, plan.items.length);
      const inBatch = new Set(plan.items.slice(cursor, batchEnd).map((item) => key(item.type, item.id)));
      for (let index = cursor; index < batchEnd; index++) {
        if (plan.items[index].dependencies.some((dependency) => inBatch.has(dependency))) { batchEnd = index; break; }
      }
      if (batchEnd === cursor) batchEnd = cursor + 1;
      const batchItems = plan.items.slice(cursor, batchEnd);
      const result = await db.$transaction(async (tx: AnyDb) => {
        await acquireScopeLock(tx, companyId);
        const liveSnapshot = await readScopeSnapshot(tx, companyId);
        if (hash(scopePayload(liveSnapshot)) !== sourceHash) throw new PdvMigrationBlocker('SOURCE_SNAPSHOT_CHANGED', null, companyId, 'A fotografia de origem mudou após iniciar ou retomar o run.');
        const point = liveSnapshot.pdvs.find((row: any) => row.id === plan.canonicalPdvId);
        const trailer = liveSnapshot.trailers.find((row: any) => row.id === plan.canonicalPdvId);
        if (!point && !trailer) throw new PdvMigrationBlocker('CANONICAL_PDV_SOURCE_MISSING', null, companyId, 'A origem do PDV canônico não existe mais.');
        const previous = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
        const currentState = await validateConfirmedState(tx, { run: previous, companyId, pdvId: plan.canonicalPdvId, sourceHash, items: plan.items, requireComplete: previous.status === 'COMPLETED' });
        if (previous.status === 'COMPLETED') return { alreadyCompleted: true, checkpoint: previous.checkpoint, cursor: currentState.cursor, receipts: [] };
        if (currentState.cursor > cursor) return { advanced: true, checkpoint: previous.checkpoint, cursor: currentState.cursor, receipts: [] };
        if (currentState.cursor < cursor) throw new PdvMigrationBlocker('RUN_CHECKPOINT_DIVERGED', null, companyId, 'Checkpoint confirmado regrediu durante esta execução.');
        if (currentState.cursor > 0) {
          const canonical = await tx.pontoVenda.findUnique({ where: { id: plan.canonicalPdvId } });
          if (!canonical || canonical.cervejariaId !== companyId) throw new PdvMigrationBlocker('CANONICAL_PDV_MISSING', null, plan.canonicalPdvId, 'PDV canônico ausente ou de outra empresa.');
        }
        const currentCheckpoint = previous.checkpoint as any;
        const currentKeys: string[] = currentState.completedKeys;
        const batchSequence = (currentCheckpoint.lastConfirmedBatch ?? 0) + 1;
        const plannedReceipts: any[] = [];
        const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence: batchSequence, status: 'PROCESSING', payloadHash: hash(batchItems.map((item) => ({ sourceType: item.type, sourceId: item.id, payloadHash: item.payloadHash }))), checkpoint: { scope: PDV_MIGRATION_SCOPE, sourceCursorBefore: cursor, sourceCursorAfter: cursor + batchItems.length, receipts: [] } } });
        for (const item of batchItems) {
          for (const dependencyKey of item.dependencies) {
            const [dependencyType, dependencyId] = dependencyKey.split(':', 2);
            await getConfirmedDependency(tx, companyId, plan.canonicalPdvId, dependencyType, dependencyId);
          }
          const oldMap = await verifyExistingMap(tx, item, companyId, plan.canonicalPdvId);
          const createdDestination = oldMap ? false : await createDestination(tx, item.expected);
          if (options.afterDestinationWrite) await options.afterDestinationWrite({ sourceType: item.type, sourceId: item.id, destinationId: item.expected.id });
          const destination = await readDestination(tx, item.expected);
          if (!destination) throw new PdvMigrationBlocker('DESTINATION_WRITE_MISSING', item.type, item.id, 'Destino não foi encontrado após criar ou reutilizar.');
          const destinationHash = hash(normalizeDestination(item.expected.type, destination));
          let reusedCreatedFlag = false;
          if (oldMap) {
            const priorBatch = await tx.pdvMigrationBatch.findFirst({ where: { id: oldMap.lastBatchId, runId: oldMap.lastRunId } });
            const priorReceipt = (priorBatch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === item.type && entry.sourceId === item.id);
            if (!priorReceipt || priorReceipt.destinationHash !== destinationHash) throw new PdvMigrationBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, 'Destino mapeado diverge do conteúdo confirmado anteriormente.');
            reusedCreatedFlag = priorReceipt.destinationCreated === true;
          }
          plannedReceipts.push({ sourceType: item.type, sourceId: item.id, destinationType: item.expected.type, destinationId: item.expected.id, payloadHash: item.payloadHash, destinationHash, destinationCreated: oldMap ? reusedCreatedFlag : createdDestination });
        }
        await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope: PDV_MIGRATION_SCOPE, sourceCursorBefore: cursor, sourceCursorAfter: cursor + batchItems.length, receipts: plannedReceipts } } });
        for (let offset = 0; offset < batchItems.length; offset++) {
          const item = batchItems[offset];
          const receipt = plannedReceipts[offset];
          const existing = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: item.type, sourceId: item.id } } });
          const mapData = { destinationType: receipt.destinationType, destinationId: receipt.destinationId, cervejariaId: companyId, pontoVendaId: plan.canonicalPdvId, transformVersion: PDV_TRANSFORM_VERSION, payloadHash: item.payloadHash, lastRunId: runId, lastBatchId: batch.id };
          if (existing) await tx.pdvMigrationMap.update({ where: { id: existing.id }, data: mapData });
          else await tx.pdvMigrationMap.create({ data: { sourceType: item.type, sourceId: item.id, ...mapData } });
        }
        const nextKeys = [...currentKeys, ...batchItems.map((item) => key(item.type, item.id))];
        const nextCheckpoint = { ...currentCheckpoint, completedSourceKeys: nextKeys, lastConfirmedBatch: batchSequence, lastSourceKey: nextKeys.at(-1) ?? null };
        await tx.pdvMigrationRun.update({ where: { id: runId }, data: { checkpoint: nextCheckpoint } });
        return { checkpoint: nextCheckpoint, receipts: plannedReceipts, cursor: nextKeys.length };
      });
      if ('alreadyCompleted' in result && result.alreadyCompleted) return { status: 'COMPLETED', runId, processedBatches, checkpoint: result.checkpoint, reusedCompletedRun: true };
      if ('advanced' in result && result.advanced) { cursor = result.cursor; continue; }
      cursor = result.cursor;
      processedBatches++;
      if (options.afterBatchCommit) await options.afterBatchCommit({ sequence: (result.checkpoint as any).lastConfirmedBatch, completedSourceKeys: (result.checkpoint as any).completedSourceKeys });
    }
    if (cursor < plan.items.length) return { status: 'RUNNING', runId, processedBatches, checkpoint: (await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } })).checkpoint };
    if (options.beforeFinalization) await options.beforeFinalization();
    const finalRun = await db.$transaction(async (tx: AnyDb) => {
      await acquireScopeLock(tx, companyId);
      const finalSnapshot = await readScopeSnapshot(tx, companyId);
      if (hash(scopePayload(finalSnapshot)) !== sourceHash) throw new PdvMigrationBlocker('SOURCE_SNAPSHOT_CHANGED', null, companyId, 'Fotografia mudou antes de concluir o escopo.');
      const point = await tx.pontoVenda.findUnique({ where: { id: plan.canonicalPdvId } });
      if (!point || point.cervejariaId !== companyId) throw new PdvMigrationBlocker('CANONICAL_PDV_MISSING', null, plan.canonicalPdvId, 'PDV canônico ausente ou de outra empresa antes da finalização.');
      const row = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
      await validateConfirmedState(tx, { run: row, companyId, pdvId: plan.canonicalPdvId, sourceHash, items: plan.items, requireComplete: true });
      return tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
    });
    return { status: 'COMPLETED', runId, processedBatches, checkpoint: finalRun.checkpoint, counts: (finalRun.checkpoint as any).scopeCounts };
  } catch (error) {
    if (error instanceof PdvMigrationBlocker) {
      const persistedRun = await db.pdvMigrationRun.findUnique({ where: { id: runId } });
      if (persistedRun?.checkpoint && (persistedRun.checkpoint as any).companyId === companyId) {
        await db.$transaction(async (tx: AnyDb) => {
          await acquireScopeLock(tx, companyId);
          await tx.pdvMigrationRun.updateMany({ where: { id: runId }, data: { status: 'BLOCKED', finishedAt: null } });
        });
      }
      return { status: 'BLOCKED', runId, checkpoint: persistedRun?.checkpoint ?? null, blocker: { code: error.code, sourceType: error.sourceType, sourceId: error.sourceId, message: error.message } };
    }
    throw error;
  }
}
