import { createHash } from 'node:crypto';
import { canonicalPdvPayloadHash } from './pdv-unico-catalog-transform.js';

type Db = any;
const SCOPE = 'PDV_TAP_OWNERSHIP_V1';
const VERSION = 1;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (type: string, id: string) => `${type}:${id}`;

export class PdvTapBlocker extends Error {
  constructor(readonly code: string, readonly sourceType: string | null, readonly sourceId: string | null, message: string) {
    super(message);
    this.name = 'PdvTapBlocker';
  }
}

function normalizedTap(row: any) {
  return { ...row, pontoVendaId: null };
}

function destinationData(type: string, row: any) {
  return type === 'LEGACY_TAP' ? {
    id: row.id, numero: row.numero, nome: row.nome, produtoId: row.produtoId,
    ativo: row.ativo, cervejariaId: row.cervejariaId, trailerId: row.trailerId,
    pontoVendaId: row.pontoVendaId,
  } : row;
}

/**
 * QA rehearsal for the additive Tap-to-PDV ownership migration. Existing IDs,
 * Trailer bridges, mount rows and event/session references are retained.
 */
export async function runPdvTapOwnershipMigration(options: {
  db: Db; companyId: string; pointId: string; runId: string; afterDestinationWrite?: () => Promise<void>;
}) {
  const { db, companyId, pointId, runId } = options;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx: Db) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${SCOPE}:${companyId}:${pointId}`}, 0)) IS NULL AS acquired`;
    const point = await tx.pontoVenda.findFirst({ where: { id: pointId, cervejariaId: companyId }, select: { id: true } });
    if (!point) throw new PdvTapBlocker('PDV_NOT_OWNED_BY_TENANT', 'PONTO_VENDA', pointId, 'O PDV não pertence ao tenant informado.');

    const [trailers, taps, mounts, collisions] = await Promise.all([
      tx.trailer.findMany({ where: { cervejariaId: companyId }, select: { id: true } }),
      tx.tap.findMany({ where: { cervejariaId: companyId }, orderBy: [{ numero: 'asc' }, { id: 'asc' }] }),
      tx.tapMontagem.findMany({ where: { tap: { cervejariaId: companyId } }, orderBy: [{ iniciadoEm: 'asc' }, { id: 'asc' }] }),
      tx.tap.findMany({ where: { pontoVendaId: pointId }, select: { id: true, numero: true, cervejariaId: true } }),
    ]);
    if (taps.length === 0) return { status: 'COMPLETED', runId, taps: 0, mounts: 0, reusedCompletedRun: false };
    if (trailers.length > 1 && taps.some((tap: any) => !tap.pontoVendaId)) throw new PdvTapBlocker('MULTIPLE_TRAILERS_REQUIRE_MANUAL_MAPPING', 'TAP', null, 'Há vários Trailers para Taps sem PDV confirmado; escolha manual é necessária.');
    const trailerIds = new Set(trailers.map((row: any) => row.id));
    const tenantTapIds = new Set(taps.map((row: any) => row.id));
    const numbers = new Set<number>();
    for (const tap of taps) {
      if (numbers.has(tap.numero)) throw new PdvTapBlocker('TAP_NUMBER_COLLISION_WITHIN_PDV', 'TAP', tap.id, 'Há numeração duplicada no conjunto de Taps do tenant.');
      numbers.add(tap.numero);
      if (tap.pontoVendaId && tap.pontoVendaId !== pointId) throw new PdvTapBlocker('TAP_ALREADY_LINKED_TO_OTHER_PDV', 'TAP', tap.id, 'O Tap já está vinculado a outro PDV.');
      if (!tap.pontoVendaId && (!tap.trailerId || !trailerIds.has(tap.trailerId))) throw new PdvTapBlocker('TAP_TRAILER_MAPPING_REQUIRED', 'TAP', tap.id, 'O Trailer legado do Tap não foi comprovado no tenant.');
      if (tap.produtoId) {
        const product = await tx.produto.findFirst({ where: { id: tap.produtoId, cervejariaId: companyId, pontoVendaId: pointId }, select: { id: true } });
        if (!product) throw new PdvTapBlocker('TAP_PRODUCT_NOT_MAPPED_TO_PDV', 'TAP', tap.id, 'O produto do Tap não possui prova de tenant e PDV.');
      }
    }
    for (const row of collisions) {
      if (!tenantTapIds.has(row.id) && numbers.has(row.numero)) throw new PdvTapBlocker('TAP_NUMBER_COLLISION_WITH_PDV', 'TAP', row.id, 'Outro Tap já usa o mesmo número neste PDV.');
    }
    const tapById = new Map(taps.map((row: any) => [row.id, row]));
    for (const mount of mounts) {
      const tap: any = tapById.get(mount.tapId);
      if (!tap) throw new PdvTapBlocker('MOUNT_TAP_TENANT_DIVERGED', 'TAP_MONTAGEM', mount.id, 'A montagem referencia um Tap fora do tenant.');
      const product = await tx.produto.findFirst({ where: { id: mount.produtoId, cervejariaId: companyId, pontoVendaId: pointId }, select: { id: true } });
      if (!product) throw new PdvTapBlocker('MOUNT_PRODUCT_NOT_MAPPED_TO_PDV', 'TAP_MONTAGEM', mount.id, 'O chope histórico da montagem não possui prova de tenant e PDV.');
      if (mount.eventoId) {
        const event = await tx.evento.findFirst({ where: { id: mount.eventoId, cervejariaId: companyId, trailerId: tap.trailerId }, select: { id: true } });
        if (!event) throw new PdvTapBlocker('MOUNT_EVENT_TRAILER_PROOF_MISSING', 'TAP_MONTAGEM', mount.id, 'O vínculo físico/histórico do Evento não foi comprovado para o Trailer do Tap.');
      }
      if (mount.sessaoCaixaId) {
        const session = await tx.sessaoCaixaOperacao.findFirst({ where: { id: mount.sessaoCaixaId, cervejariaId: companyId, pontoVendaId: pointId }, select: { id: true } });
        if (!session) throw new PdvTapBlocker('MOUNT_SESSION_PDV_PROOF_MISSING', 'TAP_MONTAGEM', mount.id, 'A sessão Por Caixa não possui prova de tenant e PDV.');
      }
    }

    const records = [
      ...taps.map((row: any) => ({ sourceType: 'LEGACY_TAP', sourceId: row.id, sourcePayload: normalizedTap(row), targetType: 'TAP' })),
      ...mounts.map((row: any) => ({ sourceType: 'TAP_MONTAGEM', sourceId: row.id, sourcePayload: row, targetType: 'TAP_MONTAGEM' })),
    ];
    const sourceHash = digest(records.map((row) => [row.sourceType, row.sourceId, canonicalPdvPayloadHash(row.sourcePayload)]));
    const scope = `${SCOPE}:${companyId}:${pointId}`;
    const priorRun = await tx.pdvMigrationRun.findUnique({ where: { id: runId }, include: { batches: { orderBy: { sequence: 'asc' } } } });
    if (priorRun) {
      const checkpoint: any = priorRun.checkpoint;
      if (priorRun.status !== 'COMPLETED' || priorRun.scope !== scope || priorRun.transformVersion !== VERSION || priorRun.sourceSnapshotHash !== sourceHash || checkpoint?.scope !== scope || checkpoint?.totalRecords !== records.length || priorRun.batches.length !== 1) {
        throw new PdvTapBlocker('TAP_RUN_SCOPE_OR_SNAPSHOT_DIVERGED', null, runId, 'O run TAP diverge do tenant, PDV, versão ou fotografia de origem.');
      }
      const batch = priorRun.batches[0];
      const receipts = (batch.checkpoint as any)?.receipts ?? [];
      if (batch.status !== 'CONFIRMED' || receipts.length !== records.length) throw new PdvTapBlocker('TAP_RUN_RECEIPT_DIVERGED', null, runId, 'O lote TAP não possui recibos confirmados completos.');
      for (let i = 0; i < records.length; i++) {
        const record = records[i]; const receipt = receipts[i];
        const model = record.targetType === 'TAP' ? tx.tap : tx.tapMontagem;
        const destination = await model.findUnique({ where: { id: record.sourceId } });
        const map = await tx.pdvMigrationMap.findFirst({ where: { sourceType: record.sourceType, sourceId: record.sourceId, lastRunId: runId, pontoVendaId: pointId } });
        if (!destination || !map || receipt.sourceType !== record.sourceType || receipt.sourceId !== record.sourceId || map.payloadHash !== canonicalPdvPayloadHash(record.sourcePayload) || receipt.payloadHash !== map.payloadHash || receipt.destinationHash !== canonicalPdvPayloadHash(destinationData(record.sourceType, destination))) throw new PdvTapBlocker('TAP_RUN_DESTINATION_DIVERGED', record.sourceType, record.sourceId, 'Mapa, recibo ou conteúdo do destino TAP diverge.');
      }
      return { status: 'COMPLETED', runId, taps: taps.length, mounts: mounts.length, reusedCompletedRun: true, reconciledRecords: receipts.map((receipt: any) => ({ type: receipt.sourceType, sourceId: receipt.sourceId, destinationId: receipt.destinationId, destinationHash: receipt.destinationHash })) };
    }
    const priorMaps = await tx.pdvMigrationMap.findMany({ where: { OR: records.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })) }, select: { sourceType: true, sourceId: true, lastRunId: true } });
    if (priorMaps.length) throw new PdvTapBlocker('TAP_SOURCE_ALREADY_MAPPED', priorMaps[0].sourceType, priorMaps[0].sourceId, 'Um Tap ou montagem já pertence a outro recibo de migração.');

    const completedSourceKeys = records.map((row) => key(row.sourceType, row.sourceId));
    const receipts: any[] = [];
    await tx.pdvMigrationRun.create({ data: {
      id: runId, scope, cervejariaId: companyId, pontoVendaId: pointId, status: 'RUNNING', transformVersion: VERSION,
      sourceSnapshotHash: sourceHash,
      checkpoint: { scope, companyId, pointId, transformVersion: VERSION, sourceSnapshotHash: sourceHash, totalRecords: records.length, completedSourceKeys: [], lastConfirmedBatch: 0, lastSourceKey: null },
    } });
    const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence: 1, status: 'PROCESSING', payloadHash: sourceHash, checkpoint: { scope, sourceCursorBefore: 0, sourceCursorAfter: records.length, receipts: [] } } });
    for (const record of records) {
      if (record.sourceType === 'LEGACY_TAP') {
        const sourceTap: any = tapById.get(record.sourceId);
        await tx.tap.update({ where: { id: record.sourceId }, data: { pontoVendaId: pointId, updatedAt: sourceTap.updatedAt } });
      }
      const delegate = record.targetType === 'TAP' ? tx.tap : tx.tapMontagem;
      const destination = await delegate.findUniqueOrThrow({ where: { id: record.sourceId } });
      const payloadHash = canonicalPdvPayloadHash(record.sourcePayload);
      const destinationHash = canonicalPdvPayloadHash(destinationData(record.sourceType, destination));
      const expectedDestination = record.sourceType === 'LEGACY_TAP' ? { ...record.sourcePayload, pontoVendaId: pointId } : record.sourcePayload;
      if (destinationHash !== canonicalPdvPayloadHash(expectedDestination)) throw new PdvTapBlocker('TAP_DESTINATION_CONTENT_DIVERGED', record.sourceType, record.sourceId, 'O destino não preserva todos os campos históricos, IDs, datas e estados esperados.');
      receipts.push({ sourceType: record.sourceType, sourceId: record.sourceId, destinationType: record.targetType, destinationId: record.sourceId, payloadHash, destinationHash, destinationCreated: false });
      await tx.pdvMigrationMap.create({ data: { sourceType: record.sourceType, sourceId: record.sourceId, destinationType: record.targetType, destinationId: record.sourceId, cervejariaId: companyId, pontoVendaId: pointId, transformVersion: VERSION, payloadHash, sourcePayload: record.sourcePayload, lastRunId: runId, lastBatchId: batch.id } });
    }
    await options.afterDestinationWrite?.();
    await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope, sourceCursorBefore: 0, sourceCursorAfter: records.length, receipts } } });
    await tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date(), checkpoint: { scope, companyId, pointId, transformVersion: VERSION, sourceSnapshotHash: sourceHash, totalRecords: records.length, completedSourceKeys, lastConfirmedBatch: 1, lastSourceKey: completedSourceKeys.at(-1) ?? null } } });
    return { status: 'COMPLETED', runId, taps: taps.length, mounts: mounts.length, reusedCompletedRun: false, sourceSnapshotHash: sourceHash, reconciledRecords: receipts.map((receipt) => ({ type: receipt.sourceType, sourceId: receipt.sourceId, destinationId: receipt.destinationId, destinationHash: receipt.destinationHash })) };
      }, { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 30000 });
    } catch (error: any) {
      const target = error?.meta?.target;
      const runIdRace = error?.code === 'P2002' && error?.meta?.modelName === 'PdvMigrationRun' && Array.isArray(target) && target.length === 1 && target[0] === 'id';
      if (!runIdRace || attempt === 2) throw error;
    }
  }
  throw new Error('TAP migration retry exhausted.');
}
