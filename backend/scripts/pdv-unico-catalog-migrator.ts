import { buildPdvCatalogMigrationItems, canonicalPdvPayloadHash, PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';
import { readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { readPdvCatalogSourceSnapshot } from './pdv-unico-catalog-source.js';

type Db = any;
const key = (type: string, id: string) => `${type}:${id}`;
const scopeLock = (companyId: string, pointId: string) => `pdv-catalog-migration:${companyId}:${pointId}`;
const delegates: Record<string, string> = {
  CONFIGURACAO_PONTO_VENDA: 'configuracaoPontoVenda', PRODUTO: 'produto', PRECO: 'preco',
  PRODUTO_OPCIONAL_GRUPO: 'produtoOpcionalGrupo', PRODUTO_OPCIONAL: 'produtoOpcional',
  CARDAPIO: 'cardapio', CARDAPIO_PRODUTO: 'cardapioProduto', OPCIONAL: 'opcional',
  PRODUTO_OPCIONAL_VINCULO: 'produtoOpcionalVinculo', PONTO_VENDA: 'pontoVenda',
  AGENDA_OPERACIONAL: 'agendaOperacional', OCORRENCIA_OPERACIONAL: 'ocorrenciaOperacional',
};

async function lock(tx: Db, companyId: string, pointId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeLock(companyId, pointId)}, 0)) IS NULL AS acquired`;
}

async function transactionWithRetry(db: Db, operation: (tx: Db) => Promise<any>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: 'RepeatableRead' }); }
    catch (error) {
      const databaseError = error as { code?: string; meta?: { target?: string | string[] } };
      const target = databaseError.meta?.target;
      const retryableUnique = databaseError.code === 'P2002' && (target === 'PdvMigrationRun_pkey' || (Array.isArray(target) && target.length === 1 && target[0] === 'id'));
      if (databaseError.code !== 'P2034' && !retryableUnique) throw error;
    }
  }
  throw new PdvCatalogBlocker('CONCURRENT_RUN_RETRY_EXHAUSTED', null, null, 'Conflito concorrente persistiu após repetir a transação serializada.');
}

async function readSnapshot(tx: Db, companyId: string) {
  const [planning, catalog] = await Promise.all([readPdvPlanningSourceSnapshot(tx, companyId), readPdvCatalogSourceSnapshot(tx, companyId)]);
  return { ...planning, ...catalog };
}

async function canonicalDependency(tx: Db, companyId: string, pointId: string) {
  const point = await tx.pontoVenda.findUnique({ where: { id: pointId } });
  if (!point || point.cervejariaId !== companyId) throw new PdvCatalogBlocker('CANONICAL_PDV_MISSING', 'PDV', pointId, 'PDV canônico ausente ou pertence a outro tenant.');
  const mappings = await tx.pdvMigrationMap.findMany({ where: { destinationType: 'PONTO_VENDA', destinationId: pointId, cervejariaId: companyId }, orderBy: { createdAt: 'asc' } });
  for (const mapping of mappings) {
    if (mapping.sourceType !== 'PDV' && mapping.sourceType !== 'TRAILER') continue;
    const batch = mapping.lastBatchId ? await tx.pdvMigrationBatch.findFirst({ where: { id: mapping.lastBatchId, runId: mapping.lastRunId } }) : null;
    const receipt = (batch?.checkpoint as any)?.receipts?.find((item: any) => item.sourceType === mapping.sourceType && item.sourceId === mapping.sourceId);
    const pointHash = canonicalPdvPayloadHash({ id: point.id, cervejariaId: point.cervejariaId, ...(point.nome != null ? { nome: point.nome } : {}), ...(point.ativo != null ? { ativo: point.ativo } : {}), ...(point.createdAt ? { createdAt: point.createdAt } : {}), ...(point.updatedAt ? { updatedAt: point.updatedAt } : {}) });
    if (batch?.status === 'CONFIRMED' && receipt?.destinationType === 'PONTO_VENDA' && receipt.destinationId === pointId && receipt.destinationHash === pointHash && mapping.pontoVendaId === pointId) return { sourceKey: key(mapping.sourceType, mapping.sourceId), point };
  }
  throw new PdvCatalogBlocker('PDV_DEPENDENCY_NOT_CONFIRMED', 'PDV', pointId, 'Não há mapa/lote confirmado do PDV pelo escopo operacional anterior.');
}

function itemsFor(companyId: string, pointId: string, snapshot: any, pdvSourceKey: string) {
  return buildPdvCatalogMigrationItems({ companyId, pointId, snapshot, confirmedPdvSourceKey: pdvSourceKey });
}

function snapshotHash(companyId: string, pointId: string, items: any[]) {
  return canonicalPdvPayloadHash({ scope: PDV_CATALOG_SCOPE, companyId, pointId, transformVersion: PDV_CATALOG_TRANSFORM_VERSION, items: items.map((item) => ({ sourceType: item.type, sourceId: item.id, sourcePayload: item.sourcePayload })) });
}

async function readDestination(tx: Db, type: string, id: string) {
  const delegate = delegates[type];
  if (!delegate) throw new PdvCatalogBlocker('DESTINATION_TYPE_UNSUPPORTED', null, id, `Tipo de destino não suportado: ${type}`);
  return tx[delegate].findUnique({ where: { id } });
}

function project(row: any, keys: string[]) {
  return Object.fromEntries(keys.map((field) => [field, row[field]]));
}

async function verifyDestination(tx: Db, item: any) {
  const row = await readDestination(tx, item.destinationType, item.destinationId);
  if (!row) throw new PdvCatalogBlocker('MAPPED_DESTINATION_MISSING', item.type, item.id, 'Destino ausente para uma origem confirmada.');
  const actual = project(row, Object.keys(item.destinationData));
  if (canonicalPdvPayloadHash(actual) !== canonicalPdvPayloadHash(item.destinationData)) {
    const mismatchedKeys = Object.keys(item.destinationData).filter((field) => canonicalPdvPayloadHash(actual[field]) !== canonicalPdvPayloadHash(item.destinationData[field]));
    throw new PdvCatalogBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, `Destino difere dos valores esperados em: ${mismatchedKeys.join(', ')}; não será sobrescrito.`);
  }
  return canonicalPdvPayloadHash(actual);
}

async function confirmDependency(tx: Db, companyId: string, pointId: string, sourceKey: string, items: any[] = []) {
  const separator = sourceKey.indexOf(':');
  const sourceType = sourceKey.slice(0, separator);
  const sourceId = sourceKey.slice(separator + 1);
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (sourceType !== 'PDV' && sourceType !== 'TRAILER') {
    const dependencyItem = items.find((item) => item.type === sourceType && item.id === sourceId);
    if (!dependencyItem || !map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId) throw new PdvCatalogBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Dependência do catálogo não tem mapa confirmado no tenant e PDV esperados.');
    await verifyMap(tx, dependencyItem, companyId, pointId);
    return;
  }
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'PONTO_VENDA' || map.destinationId !== pointId || !map.lastBatchId) throw new PdvCatalogBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Dependência do PDV não tem mapa confirmado no tenant e PDV esperados.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === sourceType && entry.sourceId === sourceId);
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationType !== 'PONTO_VENDA' || receipt?.destinationId !== pointId) throw new PdvCatalogBlocker('DEPENDENCY_RECEIPT_DIVERGED', sourceType, sourceId, 'Recibo do PDV canônico ausente ou divergente.');
  const canonical = await tx.pontoVenda.findUnique({ where: { id: pointId } });
  if (!canonical || canonical.cervejariaId !== companyId) throw new PdvCatalogBlocker('CANONICAL_PDV_MISSING', sourceType, sourceId, 'PDV canônico ausente ou de outro tenant.');
}

async function verifyMap(tx: Db, item: any, companyId: string, pointId: string) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: item.type, sourceId: item.id } } });
  if (!map) return null;
  if (map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== item.destinationType || map.destinationId !== item.destinationId) throw new PdvCatalogBlocker('MAP_IDENTITY_MISMATCH', item.type, item.id, 'Mapa aponta para tenant, PDV ou destino diferente.');
  if (map.transformVersion !== PDV_CATALOG_TRANSFORM_VERSION || map.payloadHash !== canonicalPdvPayloadHash(item.sourcePayload) || canonicalPdvPayloadHash(map.sourcePayload) !== canonicalPdvPayloadHash(item.sourcePayload)) throw new PdvCatalogBlocker('SOURCE_PAYLOAD_CHANGED', item.type, item.id, 'Payload original difere do mapa estável.');
  const batch = map.lastBatchId ? await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } }) : null;
  const receipt = (batch?.checkpoint as any)?.receipts?.find((row: any) => row.sourceType === item.type && row.sourceId === item.id);
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationId !== item.destinationId || receipt?.payloadHash !== map.payloadHash) throw new PdvCatalogBlocker('MAP_RECEIPT_MISSING', item.type, item.id, 'Mapa não tem recibo de lote confirmado correspondente.');
  const destinationHash = await verifyDestination(tx, item);
  if (destinationHash !== receipt.destinationHash) throw new PdvCatalogBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, 'Destino diverge do recibo imutável confirmado.');
  return map;
}

async function validateCheckpoint(tx: Db, run: any, companyId: string, pointId: string, sourceHash: string, items: any[], complete = false) {
  const checkpoint = run.checkpoint as any;
  if (run.transformVersion !== PDV_CATALOG_TRANSFORM_VERSION || run.sourceSnapshotHash !== sourceHash || checkpoint?.scope !== PDV_CATALOG_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId || checkpoint?.sourceSnapshotHash !== sourceHash || checkpoint?.transformVersion !== PDV_CATALOG_TRANSFORM_VERSION || checkpoint?.totalRecords !== items.length) throw new PdvCatalogBlocker('RUN_SCOPE_OR_SNAPSHOT_MISMATCH', null, run.id, 'Run diverge do escopo, PDV, versão ou fotografia atual.');
  const expectedKeys = items.map((item) => key(item.type, item.id));
  const completed: string[] = checkpoint.completedSourceKeys ?? [];
  if (!Array.isArray(checkpoint.completedSourceKeys) || completed.length > expectedKeys.length || completed.some((value, index) => value !== expectedKeys[index]) || (complete && completed.length !== expectedKeys.length) || checkpoint.lastSourceKey !== (completed.at(-1) ?? null)) throw new PdvCatalogBlocker('RUN_CHECKPOINT_DIVERGED', null, run.id, 'Checkpoint não corresponde ao prefixo determinístico esperado.');
  const batches = await tx.pdvMigrationBatch.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } });
  if (checkpoint.lastConfirmedBatch !== batches.length) throw new PdvCatalogBlocker('RUN_BATCH_ORDER_DIVERGED', null, run.id, 'Quantidade de lotes não corresponde ao checkpoint.');
  let cursor = 0;
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]; const detail = batch.checkpoint as any; const receipts = detail?.receipts ?? [];
    if (batch.sequence !== index + 1 || batch.status !== 'CONFIRMED' || detail.sourceCursorBefore !== cursor || detail.sourceCursorAfter <= cursor || detail.sourceCursorAfter > completed.length || receipts.length !== detail.sourceCursorAfter - cursor) throw new PdvCatalogBlocker('RUN_BATCH_ORDER_DIVERGED', null, run.id, 'Ordem ou intervalo de um lote confirmado diverge.');
    const batchItems = items.slice(cursor, detail.sourceCursorAfter);
    const expectedBatchHash = canonicalPdvPayloadHash(batchItems.map((item) => ({ sourceType: item.type, sourceId: item.id, payloadHash: canonicalPdvPayloadHash(item.sourcePayload) })));
    if (batch.payloadHash !== expectedBatchHash) throw new PdvCatalogBlocker('RUN_RECEIPT_DIVERGED', null, run.id, 'Hash do lote diverge dos payloads esperados.');
    for (let offset = 0; offset < batchItems.length; offset++) {
      const item = batchItems[offset]; const receipt = receipts[offset];
      if (receipt.sourceType !== item.type || receipt.sourceId !== item.id || receipt.destinationType !== item.destinationType || receipt.destinationId !== item.destinationId || receipt.payloadHash !== canonicalPdvPayloadHash(item.sourcePayload)) throw new PdvCatalogBlocker('RUN_RECEIPT_DIVERGED', item.type, item.id, 'Recibo diverge da identidade ou payload de origem.');
      for (const dependency of item.dependencies) await confirmDependency(tx, companyId, pointId, dependency, items);
      const map = await verifyMap(tx, item, companyId, pointId);
      if (!map) throw new PdvCatalogBlocker('CHECKPOINT_MAP_MISSING', item.type, item.id, 'Origem confirmada não está mapeada.');
      const currentDestinationHash = await verifyDestination(tx, item);
      if (receipt.destinationHash !== currentDestinationHash) throw new PdvCatalogBlocker('RUN_DESTINATION_DIVERGED', item.type, item.id, 'Destino diverge do recibo deste run confirmado.');
    }
    cursor = detail.sourceCursorAfter;
  }
  if (cursor !== completed.length) throw new PdvCatalogBlocker('RUN_BATCH_ORDER_DIVERGED', null, run.id, 'Lotes não cobrem exatamente o checkpoint.');
  return { cursor, completed, batches };
}

async function writeTarget(tx: Db, item: any) {
  const existing = await readDestination(tx, item.destinationType, item.destinationId);
  if (!existing && item.destinationType !== 'CONFIGURACAO_PONTO_VENDA') throw new PdvCatalogBlocker('SOURCE_DESTINATION_MISSING', item.type, item.id, 'Registro de catálogo de origem não existe no destino compartilhado; cópia não será fabricada.');
  if (existing && item.destinationType === 'CONFIGURACAO_PONTO_VENDA') return false;
  const nextPdvId = item.destinationData.pontoVendaId;
  if (existing && nextPdvId && existing.pontoVendaId != null && existing.pontoVendaId !== nextPdvId) throw new PdvCatalogBlocker('DESTINATION_ALREADY_LINKED_OTHER_PDV', item.type, item.id, 'Registro já pertence a outro PDV.');
  switch (item.destinationType) {
    case 'CONFIGURACAO_PONTO_VENDA': await tx.configuracaoPontoVenda.create({ data: item.destinationData }); return true;
    case 'PRODUTO': if (existing.pontoVendaId == null) await tx.produto.update({ where: { id: item.destinationId }, data: { pontoVendaId: nextPdvId, updatedAt: existing.updatedAt } }); return false;
    case 'CARDAPIO': if (existing.pontoVendaId == null) await tx.cardapio.update({ where: { id: item.destinationId }, data: { pontoVendaId: nextPdvId, updatedAt: existing.updatedAt } }); return false;
    case 'OPCIONAL': if (existing.pontoVendaId == null) await tx.opcional.update({ where: { id: item.destinationId }, data: { pontoVendaId: nextPdvId, updatedAt: existing.updatedAt } }); return false;
    case 'CARDAPIO_PRODUTO':
    case 'PRODUTO_OPCIONAL_VINCULO': {
      if (existing.pontoVendaId != null && (existing.pontoVendaId !== nextPdvId || existing.cervejariaId !== item.destinationData.cervejariaId)) throw new PdvCatalogBlocker('DESTINATION_ALREADY_LINKED_OTHER_PDV', item.type, item.id, 'Vínculo já pertence a outro tenant ou PDV.');
      if (existing.pontoVendaId == null) await tx[delegates[item.destinationType]].update({ where: { id: item.destinationId }, data: { cervejariaId: item.destinationData.cervejariaId, pontoVendaId: nextPdvId } });
      return false;
    }
    default: return false;
  }
}

function initialCheckpoint(companyId: string, pointId: string, sourceHash: string, items: any[]) {
  return { scope: PDV_CATALOG_SCOPE, companyId, pointId, transformVersion: PDV_CATALOG_TRANSFORM_VERSION, sourceSnapshotHash: sourceHash, totalRecords: items.length, sourceTypes: [...new Set(items.map((item) => item.type))].sort(), completedSourceKeys: [] as string[], lastConfirmedBatch: 0, lastSourceKey: null as string | null };
}

export async function runPdvCatalogMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void }) {
  const { db, companyId, pointId, runId } = options;
  if (!companyId || !pointId || !runId) throw new Error('companyId, pointId e runId são obrigatórios.');
  let committedBatches = 0;
  try {
    while (true) {
      const result = await transactionWithRetry(db, async (tx: Db) => {
        await lock(tx, companyId, pointId);
        const dependency = await canonicalDependency(tx, companyId, pointId);
        const snapshot = await readSnapshot(tx, companyId);
        const items = itemsFor(companyId, pointId, snapshot, dependency.sourceKey);
        const sourceHash = snapshotHash(companyId, pointId, items);
        let run = await tx.pdvMigrationRun.findUnique({ where: { id: runId } });
        const checkpoint = initialCheckpoint(companyId, pointId, sourceHash, items);
        if (!run) run = await tx.pdvMigrationRun.create({ data: { id: runId, status: 'RUNNING', transformVersion: PDV_CATALOG_TRANSFORM_VERSION, sourceSnapshotHash: sourceHash, checkpoint } });
        const state = await validateCheckpoint(tx, run, companyId, pointId, sourceHash, items, run.status === 'COMPLETED');
        if (run.status === 'COMPLETED') return { complete: true, checkpoint: run.checkpoint };
        if (state.cursor >= items.length) return { finalize: true, checkpoint: run.checkpoint, items, sourceHash };
        if (options.maxBatches != null && committedBatches >= options.maxBatches) return { paused: true, checkpoint: run.checkpoint };

        const item = items[state.cursor];
        for (const dependencyKey of item.dependencies) await confirmDependency(tx, companyId, pointId, dependencyKey, items);
        const existingMap = await verifyMap(tx, item, companyId, pointId);
        const sequence = state.batches.length + 1;
        const payloadHash = canonicalPdvPayloadHash([{ sourceType: item.type, sourceId: item.id, payloadHash: canonicalPdvPayloadHash(item.sourcePayload) }]);
        const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence, status: 'PROCESSING', payloadHash, checkpoint: { scope: PDV_CATALOG_SCOPE, sourceCursorBefore: state.cursor, sourceCursorAfter: state.cursor + 1, receipts: [] } } });
        const destinationCreated = existingMap ? false : await writeTarget(tx, item);
        if (options.afterDestinationWrite) await options.afterDestinationWrite(item);
        const destinationHash = await verifyDestination(tx, item);
        if (existingMap) {
          const oldBatch = await tx.pdvMigrationBatch.findFirst({ where: { id: existingMap.lastBatchId, runId: existingMap.lastRunId } });
          const oldReceipt = (oldBatch?.checkpoint as any)?.receipts?.find((receipt: any) => receipt.sourceType === item.type && receipt.sourceId === item.id);
          if (!oldReceipt || oldReceipt.destinationHash !== destinationHash) throw new PdvCatalogBlocker('MAP_RECEIPT_DIVERGED', item.type, item.id, 'Destino ou recibo anterior diverge; migração não sobrescreve.');
        }
        const receipt = { sourceType: item.type, sourceId: item.id, destinationType: item.destinationType, destinationId: item.destinationId, payloadHash: canonicalPdvPayloadHash(item.sourcePayload), destinationHash, destinationCreated: destinationCreated || (existingMap ? false : false) };
        await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope: PDV_CATALOG_SCOPE, sourceCursorBefore: state.cursor, sourceCursorAfter: state.cursor + 1, receipts: [receipt] } } });
        const mapData = { destinationType: item.destinationType, destinationId: item.destinationId, cervejariaId: companyId, pontoVendaId: pointId, transformVersion: PDV_CATALOG_TRANSFORM_VERSION, payloadHash: receipt.payloadHash, sourcePayload: item.sourcePayload, lastRunId: runId, lastBatchId: batch.id };
        if (existingMap) await tx.pdvMigrationMap.update({ where: { id: existingMap.id }, data: mapData });
        else await tx.pdvMigrationMap.create({ data: { sourceType: item.type, sourceId: item.id, ...mapData } });
        const completedSourceKeys = [...state.completed, key(item.type, item.id)];
        const nextCheckpoint = { ...checkpoint, completedSourceKeys, lastConfirmedBatch: sequence, lastSourceKey: completedSourceKeys.at(-1) ?? null };
        await tx.pdvMigrationRun.update({ where: { id: runId }, data: { checkpoint: nextCheckpoint, status: 'RUNNING', finishedAt: null } });
        return { advanced: true, checkpoint: nextCheckpoint };
      });
      if (result.complete) return { status: 'COMPLETED', runId, checkpoint: result.checkpoint, reusedCompletedRun: true };
      if (result.paused) return { status: 'RUNNING', runId, checkpoint: result.checkpoint };
      if (result.advanced) { committedBatches++; continue; }
      if (result.finalize) {
        const finalRun = await transactionWithRetry(db, async (tx: Db) => {
          await lock(tx, companyId, pointId);
          const dependency = await canonicalDependency(tx, companyId, pointId);
          const snapshot = await readSnapshot(tx, companyId);
          const items = itemsFor(companyId, pointId, snapshot, dependency.sourceKey);
          const sourceHash = snapshotHash(companyId, pointId, items);
          const row = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
          await validateCheckpoint(tx, row, companyId, pointId, sourceHash, items, true);
          return tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
        });
        return { status: 'COMPLETED', runId, checkpoint: finalRun.checkpoint, committedBatches };
      }
    }
  } catch (error) {
    if (error instanceof PdvCatalogBlocker) {
      await db.$transaction(async (tx: Db) => {
        await lock(tx, companyId, pointId);
        await tx.pdvMigrationRun.updateMany({ where: { id: runId, status: { not: 'COMPLETED' } }, data: { status: 'BLOCKED', finishedAt: null } });
      }).catch(() => undefined);
      return { status: 'BLOCKED', runId, code: error.code, sourceType: error.sourceType, sourceId: error.sourceId, message: error.message, committedBatches };
    }
    throw error;
  }
}
