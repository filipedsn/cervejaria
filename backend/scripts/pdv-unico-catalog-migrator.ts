import { buildPdvCatalogMigrationItems, canonicalPdvPayloadHash, PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';
import { readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { readPdvCatalogSourceSnapshot } from './pdv-unico-catalog-source.js';
import { buildPdvSessionMigrationItems, PDV_SESSION_SCOPE, PDV_SESSION_TRANSFORM_VERSION } from './pdv-unico-session-transform.js';
import { readPdvSessionSourceSnapshot } from './pdv-unico-session-source.js';
import { operationalSessionData } from './pdv-unico-session-transform.js';
import { buildPdvFinanceMigrationItems, PDV_FINANCE_SCOPE, PDV_FINANCE_TRANSFORM_VERSION } from './pdv-unico-finance-transform.js';
import { readPdvFinanceSourceSnapshot } from './pdv-unico-finance-source.js';
import { reconcilePdvFinance } from './pdv-unico-finance-reconcile.js';
import { buildPdvCommerceMigrationItems, PDV_COMMERCE_SCOPE, PDV_COMMERCE_TRANSFORM_VERSION } from './pdv-unico-commerce-transform.js';
import { readPdvCommerceSourceSnapshot } from './pdv-unico-commerce-source.js';

type Db = any;
const key = (type: string, id: string) => `${type}:${id}`;
const scopeLock = (scope: string, companyId: string, pointId: string) => `pdv-migration:${scope}:${companyId}:${pointId}`;
const delegates: Record<string, string> = {
  CONFIGURACAO_PONTO_VENDA: 'configuracaoPontoVenda', PRODUTO: 'produto', PRECO: 'preco',
  PRODUTO_OPCIONAL_GRUPO: 'produtoOpcionalGrupo', PRODUTO_OPCIONAL: 'produtoOpcional',
  CARDAPIO: 'cardapio', CARDAPIO_PRODUTO: 'cardapioProduto', OPCIONAL: 'opcional',
  PRODUTO_OPCIONAL_VINCULO: 'produtoOpcionalVinculo', PONTO_VENDA: 'pontoVenda',
  AGENDA_OPERACIONAL: 'agendaOperacional', OCORRENCIA_OPERACIONAL: 'ocorrenciaOperacional',
  SESSAO_CAIXA_OPERACAO: 'sessaoCaixaOperacao', SESSAO_CAIXA_OPERACAO_ITEM: 'sessaoCaixaProdutoOperacao',
  PAGAMENTO: 'pagamento', CONTA_RECEBER: 'contaReceber', MOVIMENTO_CAIXA_OPERACAO: 'movimentoCaixaOperacao',
  COMANDA: 'comanda', ITEM_COMANDA: 'itemComanda', ITEM_COMANDA_OPCIONAL: 'itemComandaOpcional',
  PEDIDO_COZINHA: 'pedidoOperacao', PEDIDO_COZINHA_STATUS: 'pedidoOperacaoStatusHistorico',
  PEDIDO_CLIENTE: 'pedidoCliente', PEDIDO_CLIENTE_ITEM: 'pedidoClienteItem',
  ESTOQUE_SALDO: 'inventoryBalance', MOVIMENTO_ESTOQUE: 'inventoryMovement',
};

async function lock(tx: Db, scope: string, companyId: string, pointId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeLock(scope, companyId, pointId)}, 0)) IS NULL AS acquired`;
}

async function transactionWithRetry(db: Db, operation: (tx: Db) => Promise<any>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: 'RepeatableRead' }); }
    catch (error) {
      const databaseError = error as { code?: string; meta?: { target?: string | string[] } };
      const target = databaseError.meta?.target;
      const retryableUnique = databaseError.code === 'P2002' && (target === 'PdvMigrationRun_pkey' || (Array.isArray(target) && target.length === 1 && target[0] === 'id'));
      const retryableBatchSequence = databaseError.code === 'P2002' && Array.isArray(target) && target.length === 2 && target[0] === 'runId' && target[1] === 'sequence';
      if (databaseError.code !== 'P2034' && !retryableUnique && !retryableBatchSequence) throw error;
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

function snapshotHash(scope: string, version: number, companyId: string, pointId: string, items: any[]) {
  return canonicalPdvPayloadHash({ scope, companyId, pointId, transformVersion: version, items: items.map((item) => ({ sourceType: item.type, sourceId: item.id, sourcePayload: item.sourcePayload })) });
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

async function confirmDependency(tx: Db, companyId: string, pointId: string, sourceKey: string, items: any[] = [], version = PDV_CATALOG_TRANSFORM_VERSION, confirmExternal?: (tx: Db, sourceType: string, sourceId: string) => Promise<boolean>) {
  const separator = sourceKey.indexOf(':');
  const sourceType = sourceKey.slice(0, separator);
  const sourceId = sourceKey.slice(separator + 1);
  if (confirmExternal && await confirmExternal(tx, sourceType, sourceId)) return;
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (sourceType !== 'PDV' && sourceType !== 'TRAILER') {
    const dependencyItem = items.find((item) => item.type === sourceType && item.id === sourceId);
    if (!dependencyItem || !map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId) throw new PdvCatalogBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Dependência do catálogo não tem mapa confirmado no tenant e PDV esperados.');
    await verifyMap(tx, dependencyItem, companyId, pointId, version);
    return;
  }
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'PONTO_VENDA' || map.destinationId !== pointId || !map.lastBatchId) throw new PdvCatalogBlocker('DEPENDENCY_NOT_CONFIRMED', sourceType, sourceId, 'Dependência do PDV não tem mapa confirmado no tenant e PDV esperados.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === sourceType && entry.sourceId === sourceId);
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationType !== 'PONTO_VENDA' || receipt?.destinationId !== pointId) throw new PdvCatalogBlocker('DEPENDENCY_RECEIPT_DIVERGED', sourceType, sourceId, 'Recibo do PDV canônico ausente ou divergente.');
  const canonical = await tx.pontoVenda.findUnique({ where: { id: pointId } });
  if (!canonical || canonical.cervejariaId !== companyId) throw new PdvCatalogBlocker('CANONICAL_PDV_MISSING', sourceType, sourceId, 'PDV canônico ausente ou de outro tenant.');
}

async function verifyMap(tx: Db, item: any, companyId: string, pointId: string, version = PDV_CATALOG_TRANSFORM_VERSION) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: item.type, sourceId: item.id } } });
  if (!map) return null;
  if (map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== item.destinationType || map.destinationId !== item.destinationId) throw new PdvCatalogBlocker('MAP_IDENTITY_MISMATCH', item.type, item.id, 'Mapa aponta para tenant, PDV ou destino diferente.');
  if (map.transformVersion !== version || map.payloadHash !== canonicalPdvPayloadHash(item.sourcePayload) || canonicalPdvPayloadHash(map.sourcePayload) !== canonicalPdvPayloadHash(item.sourcePayload)) throw new PdvCatalogBlocker('SOURCE_PAYLOAD_CHANGED', item.type, item.id, 'Payload original difere do mapa estável.');
  const batch = map.lastBatchId ? await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } }) : null;
  const receipt = (batch?.checkpoint as any)?.receipts?.find((row: any) => row.sourceType === item.type && row.sourceId === item.id);
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationId !== item.destinationId || receipt?.payloadHash !== map.payloadHash) throw new PdvCatalogBlocker('MAP_RECEIPT_MISSING', item.type, item.id, 'Mapa não tem recibo de lote confirmado correspondente.');
  const destinationHash = await verifyDestination(tx, item);
  if (destinationHash !== receipt.destinationHash) throw new PdvCatalogBlocker('MAPPED_DESTINATION_DIVERGED', item.type, item.id, 'Destino diverge do recibo imutável confirmado.');
  return map;
}

async function validateCheckpoint(tx: Db, run: any, scope: string, version: number, companyId: string, pointId: string, sourceHash: string, items: any[], complete = false, confirmExternal?: (tx: Db, sourceType: string, sourceId: string) => Promise<boolean>) {
  const checkpoint = run.checkpoint as any;
  if (run.transformVersion !== version || run.sourceSnapshotHash !== sourceHash || checkpoint?.scope !== scope || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId || checkpoint?.sourceSnapshotHash !== sourceHash || checkpoint?.transformVersion !== version || checkpoint?.totalRecords !== items.length) throw new PdvCatalogBlocker('RUN_SCOPE_OR_SNAPSHOT_MISMATCH', null, run.id, 'Run diverge do escopo, PDV, versão ou fotografia atual.');
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
      for (const dependency of item.dependencies) await confirmDependency(tx, companyId, pointId, dependency, items, version, confirmExternal);
      const map = await verifyMap(tx, item, companyId, pointId, version);
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

function initialCheckpoint(scope: string, version: number, companyId: string, pointId: string, sourceHash: string, items: any[]) {
  return { scope, companyId, pointId, transformVersion: version, sourceSnapshotHash: sourceHash, totalRecords: items.length, sourceTypes: [...new Set(items.map((item) => item.type))].sort(), completedSourceKeys: [] as string[], lastConfirmedBatch: 0, lastSourceKey: null as string | null };
}

function runtimeSupportsScopeIdentity(tx: Db) {
  return Boolean(tx?._runtimeDataModel?.models?.PdvMigrationRun?.fields?.some((field: any) => field.name === 'scope'));
}

function runMatchesScope(run: any, scope: string, companyId: string, pointId: string) {
  const identity = [run.scope, run.cervejariaId, run.pontoVendaId];
  if (identity.some((value) => value != null)) return run.scope === scope && run.cervejariaId === companyId && run.pontoVendaId === pointId;
  const checkpoint = run.checkpoint as any;
  return checkpoint?.scope === scope && checkpoint?.companyId === companyId && checkpoint?.pointId === pointId;
}

type ScopedMigrationOptions = {
  db: Db; companyId: string; pointId: string; runId: string; scope: string; transformVersion: number;
  buildItems: (tx: Db, pdvSourceKey: string) => Promise<any[]>;
  confirmExternalDependency?: (tx: Db, sourceType: string, sourceId: string) => Promise<boolean>;
  writeItem?: (tx: Db, item: any, hasExistingMap: boolean) => Promise<boolean>;
  validateScope?: (tx: Db, items: any[]) => Promise<unknown>;
  maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void;
};

/** Shared transactional runner for catalog and session scopes. */
export async function runPdvScopedMigration(options: ScopedMigrationOptions) {
  const { db, companyId, pointId, runId, scope, transformVersion } = options;
  if (!companyId || !pointId || !runId || !scope) throw new Error('companyId, pointId, runId e scope são obrigatórios.');
  let committedBatches = 0;
  try {
    while (true) {
      const result = await transactionWithRetry(db, async (tx: Db) => {
        await lock(tx, scope, companyId, pointId);
        const dependency = await canonicalDependency(tx, companyId, pointId);
        const items = await options.buildItems(tx, dependency.sourceKey);
        const sourceHash = snapshotHash(scope, transformVersion, companyId, pointId, items);
        let run = await tx.pdvMigrationRun.findUnique({ where: { id: runId } });
        const checkpoint = initialCheckpoint(scope, transformVersion, companyId, pointId, sourceHash, items);
        if (!run) {
          const identityData = runtimeSupportsScopeIdentity(tx) ? { scope, cervejariaId: companyId, pontoVendaId: pointId } : {};
          run = await tx.pdvMigrationRun.create({ data: { id: runId, ...identityData, status: 'RUNNING', transformVersion, sourceSnapshotHash: sourceHash, checkpoint } });
        } else if (!runMatchesScope(run, scope, companyId, pointId)) {
          throw new PdvCatalogBlocker('RUN_ID_SCOPE_MISMATCH', null, runId, 'runId já pertence a outro tenant, PDV ou escopo; seu estado não será alterado.');
        }
        const state = await validateCheckpoint(tx, run, scope, transformVersion, companyId, pointId, sourceHash, items, run.status === 'COMPLETED', options.confirmExternalDependency);
        if (run.status === 'COMPLETED') {
          if (options.validateScope) await options.validateScope(tx, items);
          return { complete: true, checkpoint: run.checkpoint };
        }
        if (state.cursor >= items.length) return { finalize: true, checkpoint: run.checkpoint, items, sourceHash };
        if (options.maxBatches != null && committedBatches >= options.maxBatches) return { paused: true, checkpoint: run.checkpoint };

        const item = items[state.cursor];
        for (const dependencyKey of item.dependencies) await confirmDependency(tx, companyId, pointId, dependencyKey, items, transformVersion, options.confirmExternalDependency);
        const existingMap = await verifyMap(tx, item, companyId, pointId, transformVersion);
        const sequence = state.batches.length + 1;
        const payloadHash = canonicalPdvPayloadHash([{ sourceType: item.type, sourceId: item.id, payloadHash: canonicalPdvPayloadHash(item.sourcePayload) }]);
        const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence, status: 'PROCESSING', payloadHash, checkpoint: { scope, sourceCursorBefore: state.cursor, sourceCursorAfter: state.cursor + 1, receipts: [] } } });
        const destinationCreated = existingMap ? false : await (options.writeItem ? options.writeItem(tx, item, Boolean(existingMap)) : writeTarget(tx, item));
        if (options.afterDestinationWrite) await options.afterDestinationWrite(item);
        const destinationHash = await verifyDestination(tx, item);
        if (existingMap) {
          const oldBatch = await tx.pdvMigrationBatch.findFirst({ where: { id: existingMap.lastBatchId, runId: existingMap.lastRunId } });
          const oldReceipt = (oldBatch?.checkpoint as any)?.receipts?.find((receipt: any) => receipt.sourceType === item.type && receipt.sourceId === item.id);
          if (!oldReceipt || oldReceipt.destinationHash !== destinationHash) throw new PdvCatalogBlocker('MAP_RECEIPT_DIVERGED', item.type, item.id, 'Destino ou recibo anterior diverge; migração não sobrescreve.');
        }
        const receipt = { sourceType: item.type, sourceId: item.id, destinationType: item.destinationType, destinationId: item.destinationId, payloadHash: canonicalPdvPayloadHash(item.sourcePayload), destinationHash, destinationCreated };
        await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope, sourceCursorBefore: state.cursor, sourceCursorAfter: state.cursor + 1, receipts: [receipt] } } });
        const mapData = { destinationType: item.destinationType, destinationId: item.destinationId, cervejariaId: companyId, pontoVendaId: pointId, transformVersion, payloadHash: receipt.payloadHash, sourcePayload: item.sourcePayload, lastRunId: runId, lastBatchId: batch.id };
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
          await lock(tx, scope, companyId, pointId);
          const dependency = await canonicalDependency(tx, companyId, pointId);
          const items = await options.buildItems(tx, dependency.sourceKey);
          const sourceHash = snapshotHash(scope, transformVersion, companyId, pointId, items);
          const row = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
          if (!runMatchesScope(row, scope, companyId, pointId)) throw new PdvCatalogBlocker('RUN_ID_SCOPE_MISMATCH', null, runId, 'runId já pertence a outro tenant, PDV ou escopo; seu estado não será alterado.');
          await validateCheckpoint(tx, row, scope, transformVersion, companyId, pointId, sourceHash, items, true, options.confirmExternalDependency);
          if (options.validateScope) await options.validateScope(tx, items);
          return tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
        });
        return { status: 'COMPLETED', runId, checkpoint: finalRun.checkpoint, committedBatches };
      }
    }
  } catch (error) {
    if (error instanceof PdvCatalogBlocker) {
      let invalidated = false;
      let scopeMismatch = false;
      const existing = await db.$transaction(async (tx: Db) => {
        await lock(tx, scope, companyId, pointId);
        const row = await tx.pdvMigrationRun.findUnique({ where: { id: runId } });
        if (!row) return null;
        if (!runMatchesScope(row, scope, companyId, pointId)) { scopeMismatch = true; return row; }
        const data: any = { status: 'BLOCKED' };
        if (row.status !== 'COMPLETED') data.finishedAt = null;
        await tx.pdvMigrationRun.update({ where: { id: runId }, data });
        invalidated = true;
        return row;
      });
      return { status: 'BLOCKED', runId, code: scopeMismatch ? 'RUN_ID_SCOPE_MISMATCH' : error.code, sourceType: error.sourceType, sourceId: error.sourceId, message: scopeMismatch ? 'runId pertence a outro tenant/PDV/escopo; nenhuma evidência foi alterada.' : error.message, committedBatches, invalidatedCompletedRun: invalidated && existing?.status === 'COMPLETED' };
    }
    throw error;
  }
}

export async function runPdvCatalogMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, scope: PDV_CATALOG_SCOPE, transformVersion: PDV_CATALOG_TRANSFORM_VERSION,
    buildItems: async (tx, pdvSourceKey) => {
      const snapshot = await readSnapshot(tx, options.companyId);
      return itemsFor(options.companyId, options.pointId, snapshot, pdvSourceKey);
    },
  });
}

async function findConfirmedEventOccurrence(tx: Db, companyId: string, pointId: string, eventId: string) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: 'EVENTO', sourceId: eventId } } });
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'OCORRENCIA_OPERACIONAL' || !map.lastBatchId) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_MAPPING_MISSING', 'SESSAO_CAIXA_EVENTO', eventId, 'Evento ainda não tem mapa confirmado para ocorrência neste tenant/PDV.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  const run = await tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } });
  const cp = run?.checkpoint as any;
  const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === 'EVENTO' && entry.sourceId === eventId);
  if (!run || run.status !== 'COMPLETED') throw new PdvCatalogBlocker('SESSION_OCCURRENCE_RUN_INCOMPLETE', 'SESSAO_CAIXA_EVENTO', eventId, 'Run de origem da ocorrencia nao esta COMPLETED.');
  if (cp?.scope !== 'PDV_AGENDA_OCORRENCIA_V1' || cp?.companyId !== companyId) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_RUN_SCOPE_MISMATCH', 'SESSAO_CAIXA_EVENTO', eventId, 'Run da ocorrencia pertence a outro escopo/tenant.');
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationType !== map.destinationType || receipt?.destinationId !== map.destinationId || receipt?.payloadHash !== map.payloadHash) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_RECEIPT_DIVERGED', 'SESSAO_CAIXA_EVENTO', eventId, 'Recibo do mapeamento de ocorrência está ausente ou inválido.');
  const occurrence = await tx.ocorrenciaOperacional.findUnique({ where: { id: map.destinationId } });
  if (!occurrence || occurrence.cervejariaId !== companyId || occurrence.pontoVendaId !== pointId) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_MAPPING_INCOMPATIBLE', 'SESSAO_CAIXA_EVENTO', eventId, 'Ocorrência mapeada está ausente ou pertence a outro tenant/PDV.');
  return occurrence;
}

async function findConfirmedCatalogItem(tx: Db, companyId: string, pointId: string, sourceType: string, sourceId: string) {
  const dependency = await canonicalDependency(tx, companyId, pointId);
  const snapshot = await readSnapshot(tx, companyId);
  const item = itemsFor(companyId, pointId, snapshot, dependency.sourceKey).find((entry: any) => entry.type === sourceType && entry.id === sourceId);
  if (!item) throw new PdvCatalogBlocker('SESSION_CATALOG_SOURCE_MISSING', sourceType, sourceId, 'Catalog source is absent from the current tenant snapshot.');
  const map = await verifyMap(tx, item, companyId, pointId, PDV_CATALOG_TRANSFORM_VERSION);
  if (!map) throw new PdvCatalogBlocker('SESSION_CATALOG_MAP_MISSING', sourceType, sourceId, 'Catalog source has no stable map in this tenant/PDV.');
  const run = await tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } });
  const checkpoint = run?.checkpoint as any;
  if (run?.status !== 'COMPLETED' || checkpoint?.scope !== PDV_CATALOG_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId) throw new PdvCatalogBlocker('SESSION_CATALOG_RUN_INCOMPLETE', sourceType, sourceId, 'Catalog map was not confirmed by a completed run in this scope.');
  const batch = await tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } });
  const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === sourceType && entry.sourceId === sourceId);
  const currentDestinationHash = await verifyDestination(tx, item);
  if (batch?.status !== 'CONFIRMED' || receipt?.destinationHash !== currentDestinationHash) throw new PdvCatalogBlocker('SESSION_CATALOG_RECEIPT_DIVERGED', sourceType, sourceId, 'Catalog destination content no longer matches its confirmed receipt.');
  return { item, map };
}

async function findConfirmedCatalogMenu(tx: Db, companyId: string, pointId: string, sourceId: string) {
  const { item } = await findConfirmedCatalogItem(tx, companyId, pointId, 'CATALOGO_CARDAPIO', sourceId);
  if (item.destinationType !== 'CARDAPIO' || item.destinationId !== sourceId) throw new PdvCatalogBlocker('SESSION_MENU_CATALOG_MAP_MISSING', 'CATALOGO_CARDAPIO', sourceId, 'Mapped menu does not preserve its source identity.');
  return { id: sourceId, companyId, pointId };
}

async function writeSessionTarget(tx: Db, item: any, hasExistingMap: boolean) {
  const existing = await readDestination(tx, item.destinationType, item.destinationId);
  if (item.type === 'SESSAO_CAIXA_EVENTO') {
    if (existing && !hasExistingMap) throw new PdvCatalogBlocker('SESSION_ID_COLLISION', item.type, item.id, 'Evento session ID already exists in Por Caixa without a stable map.');
    if (!existing) await tx.sessaoCaixaOperacao.create({ data: item.destinationData });
    return !existing;
  }
  if (item.type === 'EVENTO_PRODUTO_SESSAO') {
    if (existing && !hasExistingMap) throw new PdvCatalogBlocker('SESSION_ITEM_ID_COLLISION', item.type, item.id, 'Event-selected item ID already exists in another turn without a stable map.');
    if (!existing) await tx.sessaoCaixaProdutoOperacao.create({ data: item.destinationData });
    return !existing;
  }
  if (!existing) throw new PdvCatalogBlocker('SESSION_DESTINATION_MISSING', item.type, item.id, 'Existing Por Caixa session/override to preserve is missing.');
  return false;
}

export async function runPdvSessionMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, scope: PDV_SESSION_SCOPE, transformVersion: PDV_SESSION_TRANSFORM_VERSION,
    buildItems: async (tx, pdvSourceKey) => {
      const snapshot = await readPdvSessionSourceSnapshot(tx, options.companyId);
      const confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string; date: Date }> = {};
      const confirmedMenus: Record<string, { id: string; companyId: string; pointId: string }> = {};
      for (const session of snapshot.eventSessions) {
        if (!session.evento.data) throw new PdvCatalogBlocker('SESSION_OPERATIONAL_DAY_UNPROVEN', 'SESSAO_CAIXA_EVENTO', session.id, 'Evento sem data persistida não comprova o dia operacional.');
        const occurrence = await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, session.eventoId);
        confirmedOccurrences[session.eventoId] = { id: occurrence.id, companyId: occurrence.cervejariaId, pointId: occurrence.pontoVendaId, date: occurrence.data };
        if (session.evento.cardapioId) {
          confirmedMenus[session.evento.cardapioId] = await findConfirmedCatalogMenu(tx, options.companyId, options.pointId, session.evento.cardapioId);
        }
      }
      return buildPdvSessionMigrationItems({ companyId: options.companyId, pointId: options.pointId, snapshot, confirmedPdvSourceKey: pdvSourceKey, confirmedOccurrences, confirmedMenus });
    },
    confirmExternalDependency: async (tx, sourceType, sourceId) => {
      if (sourceType === 'EVENTO') { await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, sourceId); return true; }
      if (sourceType === 'CATALOGO_CARDAPIO') { await findConfirmedCatalogMenu(tx, options.companyId, options.pointId, sourceId); return true; }
      if (sourceType === 'CATALOGO_PRODUTO') { await findConfirmedCatalogItem(tx, options.companyId, options.pointId, sourceType, sourceId); return true; }
      return false;
    },
    writeItem: writeSessionTarget,
  });
}

async function findConfirmedFinanceSession(tx: Db, companyId: string, pointId: string, sourceType: 'SESSAO_CAIXA_EVENTO' | 'SESSAO_CAIXA_OPERACAO', sourceId: string) {
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'SESSAO_CAIXA_OPERACAO' || !map.lastBatchId) throw new PdvCatalogBlocker('FINANCE_SESSION_MAP_MISSING', sourceType, sourceId, 'Sessão financeira não tem mapa confirmado neste tenant/PDV.');
  const [run, batch, destination] = await Promise.all([
    tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } }),
    tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } }),
    tx.sessaoCaixaOperacao.findUnique({ where: { id: map.destinationId } }),
  ]);
  const checkpoint = run?.checkpoint as any;
  const receipt = (batch?.checkpoint as any)?.receipts?.find((entry: any) => entry.sourceType === sourceType && entry.sourceId === sourceId);
  if (run?.status !== 'COMPLETED' || checkpoint?.scope !== PDV_SESSION_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId || !checkpoint?.completedSourceKeys?.includes(key(sourceType, sourceId)) || batch?.status !== 'CONFIRMED' || receipt?.destinationId !== map.destinationId || receipt?.payloadHash !== map.payloadHash) throw new PdvCatalogBlocker('FINANCE_SESSION_NOT_CERTIFIED', sourceType, sourceId, 'Run, checkpoint ou recibo da sessão não está confirmado.');
  if (!destination || destination.cervejariaId !== companyId || destination.pontoVendaId !== pointId || destination.id !== sourceId || (sourceType === 'SESSAO_CAIXA_EVENTO' && destination.origemHistorica !== 'EVENTO') || receipt.destinationHash !== canonicalPdvPayloadHash(operationalSessionData(destination))) throw new PdvCatalogBlocker('FINANCE_SESSION_DESTINATION_DIVERGED', sourceType, sourceId, 'Destino da sessão ausente, incompatível ou diferente do recibo.');
  return { id: destination.id, companyId, pointId, sourceType };
}

async function writeFinanceTarget(tx: Db, item: any, hasExistingMap: boolean) {
  const existing = await readDestination(tx, item.destinationType, item.destinationId);
  if (item.type === 'MOVIMENTO_CAIXA_EVENTO') {
    if (existing && !hasExistingMap) throw new PdvCatalogBlocker('FINANCE_MOVEMENT_ID_COLLISION', item.type, item.id, 'ID do movimento Evento já pertence ao financeiro Por Caixa.');
    if (!existing) await tx.movimentoCaixaOperacao.create({ data: item.destinationData });
    return !existing;
  }
  if (!existing) throw new PdvCatalogBlocker('FINANCE_SOURCE_MISSING', item.type, item.id, 'Registro financeiro comum ausente; nenhuma linha será fabricada.');
  if (item.type === 'PAGAMENTO' && existing.sessaoCaixaEventoId && !hasExistingMap) {
    if (existing.sessaoCaixaId != null) throw new PdvCatalogBlocker('FINANCE_PAYMENT_DOUBLE_SESSION', item.type, item.id, 'Pagamento contém duas sessões antes de ter mapa financeiro.');
    await tx.pagamento.update({ where: { id: item.id }, data: { sessaoCaixaId: item.destinationData.sessaoCaixaId } });
  }
  return false;
}

export async function runPdvFinanceMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, scope: PDV_FINANCE_SCOPE, transformVersion: PDV_FINANCE_TRANSFORM_VERSION,
    buildItems: async (tx, pdvSourceKey) => {
      const snapshot = await readPdvFinanceSourceSnapshot(tx, options.companyId);
      const confirmedSessions: Record<string, any> = {};
      const eventIds = new Set<string>();
      for (const payment of snapshot.payments) {
        if (payment.comanda.eventoId) eventIds.add(payment.comanda.eventoId);
        if (payment.sessaoCaixaEventoId) {
          const sourceType = 'SESSAO_CAIXA_EVENTO';
          const sourceId = payment.sessaoCaixaEventoId;
          confirmedSessions[key(sourceType, sourceId)] = await findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId);
        } else if (payment.sessaoCaixaId) {
          const sourceType = 'SESSAO_CAIXA_OPERACAO';
          const sourceId = payment.sessaoCaixaId;
          confirmedSessions[key(sourceType, sourceId)] = await findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId);
        }
      }
      for (const debt of snapshot.debts) if (debt.comanda.eventoId) eventIds.add(debt.comanda.eventoId);
      for (const movement of snapshot.eventMovements) {
        const sourceType = 'SESSAO_CAIXA_EVENTO'; const sourceId = movement.sessaoId;
        confirmedSessions[key(sourceType, sourceId)] = await findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId);
      }
      for (const movement of snapshot.operationalMovements) {
        const sourceType = 'SESSAO_CAIXA_OPERACAO'; const sourceId = movement.sessaoId;
        confirmedSessions[key(sourceType, sourceId)] = await findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId);
      }
      const confirmedEvents: Record<string, any> = {};
      for (const eventId of eventIds) {
        const row = await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, eventId);
        confirmedEvents[eventId] = { id: row.id, companyId: row.cervejariaId, pointId: row.pontoVendaId };
      }
      const paymentIds = snapshot.payments.map((payment: any) => payment.id);
      const mappedPayments = await tx.pdvMigrationMap.findMany({ where: { sourceType: 'PAGAMENTO', sourceId: { in: paymentIds } }, select: { sourceId: true } });
      return buildPdvFinanceMigrationItems({ companyId: options.companyId, pointId: options.pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedSessions, confirmedEvents, mappedPaymentIds: new Set(mappedPayments.map((row: any) => row.sourceId)) });
    },
    confirmExternalDependency: async (tx, sourceType, sourceId) => {
      if (sourceType === 'EVENTO') { await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, sourceId); return true; }
      if (sourceType === 'SESSAO_CAIXA_EVENTO' || sourceType === 'SESSAO_CAIXA_OPERACAO') { await findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId); return true; }
      return false;
    },
    writeItem: writeFinanceTarget,
    validateScope: reconcilePdvFinance,
  });
}

async function writeCommerceTarget(tx: Db, item: any) {
  const existing = await readDestination(tx, item.destinationType, item.destinationId);
  if (!existing) throw new PdvCatalogBlocker('COMMERCE_SOURCE_DESTINATION_MISSING', item.type, item.id, 'Registro de origem desapareceu; não será recriado.');
  if (item.type === 'COMANDA') {
    if (existing.pontoVendaId && existing.pontoVendaId !== item.destinationData.pontoVendaId) throw new PdvCatalogBlocker('COMMERCE_COMMAND_PDV_MISMATCH', item.type, item.id, 'Comanda aponta para outro PDV e não será reassociada.');
    if (existing.ocorrenciaId && existing.ocorrenciaId !== item.destinationData.ocorrenciaId) throw new PdvCatalogBlocker('COMMERCE_COMMAND_OCCURRENCE_MISMATCH', item.type, item.id, 'Comanda aponta para outra ocorrência e não será reassociada.');
    if (existing.pontoVendaId !== item.destinationData.pontoVendaId || existing.ocorrenciaId !== item.destinationData.ocorrenciaId) await tx.comanda.update({ where: { id: item.id }, data: { ...item.destinationData, updatedAt: existing.updatedAt } });
    return false;
  }
  if (item.type === 'PEDIDO_COZINHA') {
    if (existing.pontoVendaId && existing.pontoVendaId !== item.destinationData.pontoVendaId) throw new PdvCatalogBlocker('COMMERCE_ORDER_PDV_MISMATCH', item.type, item.id, 'Pedido de cozinha aponta para outro PDV e não será reassociado.');
    if (existing.pontoVendaId !== item.destinationData.pontoVendaId) await tx.pedidoOperacao.update({ where: { id: item.id }, data: { ...item.destinationData, updatedAt: existing.updatedAt } });
    return false;
  }
  return false;
}

/** Reconciles existing command/order/stock rows and writes only confirmed PDV/event links. */
export async function runPdvCommerceMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; afterDestinationWrite?: (item: any) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, scope: PDV_COMMERCE_SCOPE, transformVersion: PDV_COMMERCE_TRANSFORM_VERSION,
    buildItems: async (tx, pdvSourceKey) => {
      const snapshot = await readPdvCommerceSourceSnapshot(tx, options.companyId);
      const eventIds = new Set<string>();
      for (const command of snapshot.commands) if (command.eventoId) eventIds.add(command.eventoId);
      for (const order of snapshot.portalOrders) if (order.eventoId) eventIds.add(order.eventoId);
      const confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }> = {};
      for (const eventId of eventIds) {
        const row = await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, eventId);
        confirmedOccurrences[eventId] = { id: row.id, companyId: row.cervejariaId, pointId: row.pontoVendaId };
      }
      if (snapshot.coverage.tenantConflictCommandIds.length || snapshot.coverage.tenantConflictItemIds.length || snapshot.coverage.tenantConflictOrderIds.length || snapshot.coverage.tenantConflictInventoryIds.length) throw new PdvCatalogBlocker('COMMERCE_SOURCE_TENANT_CONFLICT', null, null, 'A fotografia contém referências de tenant incompatíveis.');
      return buildPdvCommerceMigrationItems({ companyId: options.companyId, pointId: options.pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedOccurrences });
    },
    confirmExternalDependency: async (tx, sourceType, sourceId) => {
      if (sourceType === 'EVENTO') { await findConfirmedEventOccurrence(tx, options.companyId, options.pointId, sourceId); return true; }
      if (sourceType === 'CATALOGO_PRODUTO') { await findConfirmedCatalogItem(tx, options.companyId, options.pointId, sourceType, sourceId); return true; }
      return false;
    },
    writeItem: writeCommerceTarget,
    validateScope: async (_tx, items) => ({
      commands: items.filter((item) => item.type === 'COMANDA').length,
      items: items.filter((item) => item.type === 'ITEM_COMANDA').length,
      soldOptionals: items.filter((item) => item.type === 'ITEM_COMANDA_OPCIONAL').length,
      kitchenOrders: items.filter((item) => item.type === 'PEDIDO_COZINHA').length,
      statusHistory: items.filter((item) => item.type === 'PEDIDO_COZINHA_STATUS').length,
      inventoryBalances: items.filter((item) => item.type === 'ESTOQUE_SALDO').length,
      inventoryMovements: items.filter((item) => item.type === 'MOVIMENTO_ESTOQUE').length,
    }),
  });
}
