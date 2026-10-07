import { createHash } from 'node:crypto';
import { canonicalPdvPayloadHash } from './pdv-unico-catalog-transform.js';
import { validateCheckpoint, verifyMap } from './pdv-unico-catalog-migrator.js';

type Db = any;
const SCOPE = 'PDV_TAP_OWNERSHIP_V2';
const VERSION = 2;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (type: string, id: string) => `${type}:${id}`;
const tapDestination = (row: any) => ({ id: row.id, numero: row.numero, nome: row.nome, produtoId: row.produtoId, ativo: row.ativo, cervejariaId: row.cervejariaId, trailerId: row.trailerId, pontoVendaId: row.pontoVendaId });

export class PdvTapBlocker extends Error {
  constructor(readonly code: string, readonly sourceType: string | null, readonly sourceId: string | null, message: string) { super(message); this.name = 'PdvTapBlocker'; }
}
function normalizeError(error: any): never {
  if (error instanceof PdvTapBlocker) throw error;
  if (error?.name === 'PdvCatalogBlocker') throw new PdvTapBlocker(error.code, error.sourceType ?? null, error.sourceId ?? null, error.message);
  throw error;
}

/** Additive, one-transaction ownership migration. It never copies or deletes source rows. */
export async function runPdvTapOwnershipMigration(options: { db: Db; companyId: string; pointId: string; runId: string; afterDestinationWrite?: (tx: Db) => Promise<void> | void }) {
  const { db, companyId, pointId, runId } = options;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.$transaction(async (tx: Db) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDV_TAP_OWNERSHIP:${companyId}`}, 0)) IS NULL AS acquired`;
      const points = await tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true } });
      if (points.length !== 1 || points[0].id !== pointId) throw new PdvTapBlocker('CANONICAL_PDV_AMBIGUOUS', 'PONTO_VENDA', pointId, 'O tenant precisa ter exatamente um PDV comprovado; o argumento não escolhe entre PDVs ambíguos.');
      const point = await tx.pontoVenda.findUnique({ where: { id: pointId }, select: { id: true, cervejariaId: true } });
      if (!point || point.cervejariaId !== companyId) throw new PdvTapBlocker('PDV_NOT_OWNED_BY_TENANT', 'PONTO_VENDA', pointId, 'O PDV não pertence ao tenant informado.');
      const [trailers, taps, mounts] = await Promise.all([
        tx.trailer.findMany({ where: { cervejariaId: companyId }, select: { id: true } }),
        tx.tap.findMany({ where: { cervejariaId: companyId }, orderBy: [{ numero: 'asc' }, { id: 'asc' }] }),
        tx.tapMontagem.findMany({ where: { tap: { cervejariaId: companyId } }, orderBy: [{ iniciadoEm: 'asc' }, { id: 'asc' }] }),
      ]);
      if (trailers.length > 1 && taps.some((tap: any) => !tap.pontoVendaId)) throw new PdvTapBlocker('MULTIPLE_TRAILERS_REQUIRE_MANUAL_MAPPING', 'TAP', null, 'Há vários Trailers para Taps ainda sem PDV confirmado; o mapeamento precisa de confirmação.');
      const trailerIds = new Set(trailers.map((row: any) => row.id));
      const tapsById = new Map(taps.map((row: any) => [row.id, row]));
      const tapNumbers = new Set<number>();
      const records: any[] = [];
      for (const tap of taps as any[]) {
        if (tapNumbers.has(tap.numero)) throw new PdvTapBlocker('TAP_NUMBER_COLLISION_WITHIN_PDV', 'TAP', tap.id, 'Há numeração duplicada no tenant que convergiria para o PDV.');
        tapNumbers.add(tap.numero);
        if (tap.pontoVendaId && tap.pontoVendaId !== pointId) throw new PdvTapBlocker('TAP_ALREADY_LINKED_TO_OTHER_PDV', 'TAP', tap.id, 'O Tap já está vinculado a outro PDV.');
        if (!tap.trailerId || !trailerIds.has(tap.trailerId)) throw new PdvTapBlocker('TAP_TRAILER_MAPPING_REQUIRED', 'TAP', tap.id, 'A origem física/histórica do Tap não foi comprovada no tenant.');
        if (tap.produtoId) {
          const product = await tx.produto.findFirst({ where: { id: tap.produtoId, cervejariaId: companyId, pontoVendaId: pointId }, select: { id: true } });
          if (!product) throw new PdvTapBlocker('TAP_PRODUCT_NOT_MAPPED_TO_PDV', 'TAP', tap.id, 'O produto do Tap não possui prova de tenant e PDV.');
        }
        records.push({ type: 'LEGACY_TAP', id: tap.id, sourcePayload: { ...tap, pontoVendaId: null }, destinationType: 'TAP', destinationId: tap.id, destinationData: tapDestination({ ...tap, pontoVendaId: pointId }), dependencies: [] });
      }
      for (const mount of mounts as any[]) {
        const tap: any = tapsById.get(mount.tapId);
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
        records.push({ type: 'TAP_MONTAGEM', id: mount.id, sourcePayload: mount, destinationType: 'TAP_MONTAGEM', destinationId: mount.id, destinationData: mount, dependencies: [] });
      }
      const sourceHash = digest(records.map((row) => [row.type, row.id, canonicalPdvPayloadHash(row.sourcePayload)]));
      const scope = `${SCOPE}:${companyId}:${pointId}`;
      const run = await tx.pdvMigrationRun.findUnique({ where: { id: runId } });
      if (!run && records.length === 0) return { status: 'COMPLETED', runId, taps: 0, mounts: 0, reusedCompletedRun: false, reconciledRecords: [] };
      if (run) {
        if (run.status !== 'COMPLETED' || !run.finishedAt || run.scope !== scope || run.cervejariaId !== companyId || run.pontoVendaId !== pointId || run.transformVersion !== VERSION || run.sourceSnapshotHash !== sourceHash) throw new PdvTapBlocker('TAP_RUN_SCOPE_OR_SNAPSHOT_DIVERGED', null, runId, 'Run TAP diverge do tenant, PDV, versão, estado ou fotografia de origem.');
        const checked = await validateCheckpoint(tx, run, scope, VERSION, companyId, pointId, sourceHash, records, true);
        if (checked.batches.length !== 1 || checked.batches[0].sequence !== 1 || checked.batches[0].status !== 'CONFIRMED' || !checked.batches[0].confirmedAt) throw new PdvTapBlocker('TAP_RUN_BATCH_DIVERGED', null, runId, 'O contrato TAP exige um único lote confirmado e atômico.');
        for (const record of records) {
          const map = await verifyMap(tx, record, companyId, pointId, VERSION);
          if (!map || map.lastRunId !== runId || map.lastBatchId !== checked.batches[0].id || map.destinationType !== record.destinationType || map.destinationId !== record.destinationId) throw new PdvTapBlocker('TAP_MAP_IDENTITY_DIVERGED', record.type, record.id, 'Identidade, destino ou run/lote do mapa diverge.');
        }
        return { status: 'COMPLETED', runId, taps: taps.length, mounts: mounts.length, reusedCompletedRun: true, reconciledRecords: (checked.batches[0].checkpoint as any).receipts.map((receipt: any) => ({ type: receipt.sourceType, sourceId: receipt.sourceId, destinationId: receipt.destinationId, destinationHash: receipt.destinationHash })) };
      }
      const priorMaps = await tx.pdvMigrationMap.findMany({ where: { OR: records.map(({ type, id }) => ({ sourceType: type, sourceId: id })) }, select: { sourceType: true, sourceId: true } });
      if (priorMaps.length) throw new PdvTapBlocker('TAP_SOURCE_ALREADY_MAPPED', priorMaps[0].sourceType, priorMaps[0].sourceId, 'A origem já pertence a outro recibo de migração.');
      const completedSourceKeys = records.map((row) => key(row.type, row.id));
      const checkpoint = { scope, companyId, pointId, transformVersion: VERSION, sourceSnapshotHash: sourceHash, totalRecords: records.length, sourceTypes: [...new Set(records.map((row) => row.type))].sort(), completedSourceKeys, lastConfirmedBatch: 1, lastSourceKey: completedSourceKeys.at(-1) ?? null };
      await tx.pdvMigrationRun.create({ data: { id: runId, scope, cervejariaId: companyId, pontoVendaId: pointId, status: 'RUNNING', transformVersion: VERSION, sourceSnapshotHash: sourceHash, checkpoint: { ...checkpoint, completedSourceKeys: [], lastConfirmedBatch: 0, lastSourceKey: null } } });
      const payloadHash = canonicalPdvPayloadHash(records.map((row) => ({ sourceType: row.type, sourceId: row.id, payloadHash: canonicalPdvPayloadHash(row.sourcePayload) })));
      const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence: 1, status: 'PROCESSING', payloadHash, checkpoint: { scope, sourceCursorBefore: 0, sourceCursorAfter: records.length, receipts: [] } } });
      const receipts: any[] = [];
      for (const record of records) {
        if (record.type === 'LEGACY_TAP') await tx.tap.update({ where: { id: record.id }, data: { pontoVendaId: pointId, updatedAt: record.sourcePayload.updatedAt } });
        const destination = record.type === 'LEGACY_TAP' ? await tx.tap.findUniqueOrThrow({ where: { id: record.id } }) : await tx.tapMontagem.findUniqueOrThrow({ where: { id: record.id } });
        const target = record.type === 'LEGACY_TAP' ? tapDestination(destination) : destination;
        const destinationHash = canonicalPdvPayloadHash(target);
        if (destinationHash !== canonicalPdvPayloadHash(record.destinationData)) throw new PdvTapBlocker('TAP_DESTINATION_CONTENT_DIVERGED', record.type, record.id, 'O destino não preserva conteúdo, IDs, datas e estado esperados.');
        const payloadHash = canonicalPdvPayloadHash(record.sourcePayload);
        receipts.push({ sourceType: record.type, sourceId: record.id, destinationType: record.destinationType, destinationId: record.destinationId, payloadHash, destinationHash, destinationCreated: false });
        await tx.pdvMigrationMap.create({ data: { sourceType: record.type, sourceId: record.id, destinationType: record.destinationType, destinationId: record.destinationId, cervejariaId: companyId, pontoVendaId: pointId, transformVersion: VERSION, payloadHash, sourcePayload: record.sourcePayload, lastRunId: runId, lastBatchId: batch.id } });
        await options.afterDestinationWrite?.(tx);
      }
      await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope, sourceCursorBefore: 0, sourceCursorAfter: records.length, receipts } } });
      await tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date(), checkpoint } });
      const finalized = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
      const checked = await validateCheckpoint(tx, finalized, scope, VERSION, companyId, pointId, sourceHash, records, true);
      if (!finalized.finishedAt || checked.batches.length !== 1 || checked.batches[0].id !== batch.id || !checked.batches[0].confirmedAt) throw new PdvTapBlocker('TAP_FINALIZATION_DIVERGED', null, runId, 'Finalização não corresponde ao único lote atômico.');
      for (const record of records) {
        const map = await verifyMap(tx, record, companyId, pointId, VERSION);
        if (!map || map.lastRunId !== runId || map.lastBatchId !== batch.id || map.destinationType !== record.destinationType || map.destinationId !== record.destinationId) throw new PdvTapBlocker('TAP_MAP_IDENTITY_DIVERGED', record.type, record.id, 'Finalização encontrou mapa adulterado.');
      }
      return { status: 'COMPLETED', runId, taps: taps.length, mounts: mounts.length, reusedCompletedRun: false, sourceSnapshotHash: sourceHash, reconciledRecords: receipts.map((receipt) => ({ type: receipt.sourceType, sourceId: receipt.sourceId, destinationId: receipt.destinationId, destinationHash: receipt.destinationHash })) };
        }, { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 30000 });
      } catch (error: any) {
        const target = error?.meta?.target;
        const concurrentRun = error?.code === 'P2002' && error?.meta?.modelName === 'PdvMigrationRun' && (target === 'PdvMigrationRun_pkey' || (Array.isArray(target) && target.length === 1 && target[0] === 'id'));
        if (!concurrentRun || attempt === 2) throw error;
      }
    }
    throw new PdvTapBlocker('TAP_RUN_RETRY_EXHAUSTED', null, runId, 'Concurrent run conflict persisted after retries.');
  } catch (error) { normalizeError(error); }
}
