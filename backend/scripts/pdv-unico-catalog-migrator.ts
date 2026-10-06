import { buildPdvCatalogMigrationItems, canonicalPdvPayloadHash, PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';
import { readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { readPdvCatalogSourceSnapshot } from './pdv-unico-catalog-source.js';
import { buildPdvSessionMigrationItems, PDV_SESSION_SCOPE, PDV_SESSION_TRANSFORM_VERSION } from './pdv-unico-session-transform.js';
import { readPdvSessionSourceSnapshot } from './pdv-unico-session-source.js';
import { operationalSessionData } from './pdv-unico-session-transform.js';
import { buildPdvFinanceMigrationItems, PDV_FINANCE_SCOPE, PDV_FINANCE_TRANSFORM_VERSION, type HistoricalNoSessionApproval, type ConfirmedHistoricalCommerceCommand } from './pdv-unico-finance-transform.js';
import { readPdvFinanceSourceSnapshot } from './pdv-unico-finance-source.js';
import { reconcilePdvFinance } from './pdv-unico-finance-reconcile.js';
import { buildPdvCommerceMigrationItems, commercePayloadHash, PDV_COMMERCE_SCOPE, PDV_COMMERCE_TRANSFORM_VERSION } from './pdv-unico-commerce-transform.js';
import { readPdvCommerceSourceSnapshot } from './pdv-unico-commerce-source.js';
import { createConfirmedPdvEventOccurrenceResolver, findConfirmedPdvEventOccurrence } from './pdv-unico-business-migrator.js';
import { buildPdvKitchenOrderPreparationItems, PDV_KITCHEN_ORDER_PREPARATION_SCOPE, PDV_KITCHEN_ORDER_PREPARATION_VERSION, PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, readPdvKitchenOrderPreparationSnapshot } from './pdv-unico-kitchen-order-preparation.js';

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

async function transactionWithRetry(db: Db, operation: (tx: Db) => Promise<any>, options: { timeoutMs: number; maxWaitMs: number }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: 'RepeatableRead', timeout: options.timeoutMs, maxWait: options.maxWaitMs }); }
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

async function measureStage(options: { measure?: (stage: string, operation: () => Promise<any>) => Promise<any> }, stage: string, operation: () => Promise<any>) {
  return options.measure ? options.measure(stage, operation) : operation();
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
  buildItems: (tx: Db, pdvSourceKey: string, transactionContext?: any) => Promise<any[]>;
  createTransactionContext?: (tx: Db) => Promise<any>;
  confirmExternalDependency?: (tx: Db, sourceType: string, sourceId: string, transactionContext?: any) => Promise<boolean>;
  writeItem?: (tx: Db, item: any, hasExistingMap: boolean) => Promise<boolean>;
  validateScope?: (tx: Db, items: any[], transactionContext?: any) => Promise<unknown>;
  maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number;
  measure?: (stage: string, operation: () => Promise<any>) => Promise<any>;
  afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void;
  afterBatchCommit?: (progress: { tenantId: string; phase: string; cursor: number; total: number; batch: number; durationMs: number }) => Promise<void> | void;
};

/** Shared transactional runner for catalog and session scopes. */
export async function runPdvScopedMigration(options: ScopedMigrationOptions) {
  const { db, companyId, pointId, runId, scope, transformVersion } = options;
  if (!companyId || !pointId || !runId || !scope) throw new Error('companyId, pointId, runId and scope are required.');
  const timeoutMs = options.transactionTimeoutMs ?? 15000;
  const maxWaitMs = options.transactionMaxWaitMs ?? 5000;
  const batchSize = options.batchSize ?? 1;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 250) throw new Error('Scoped migration batchSize must be between 1 and 250.');
  const txOptions = { timeoutMs, maxWaitMs };
  let committedBatches = 0;
  try {
    while (true) {
      const batchStartedAt = Date.now();
      const result = await transactionWithRetry(db, async (tx: Db) => {
        let dependency: any;
        await measureStage(options, 'locksAndCanonicalPdv', async () => {
          await lock(tx, scope, companyId, pointId);
          dependency = await canonicalDependency(tx, companyId, pointId);
        });
        const transactionContext = options.createTransactionContext ? await options.createTransactionContext(tx) : undefined;
        const items = await measureStage(options, 'sourceSnapshotAndTransform', () => options.buildItems(tx, dependency.sourceKey, transactionContext));
        const sourceHash = snapshotHash(scope, transformVersion, companyId, pointId, items);
        const confirmExternal = options.confirmExternalDependency
          ? (innerTx: Db, sourceType: string, sourceId: string) => measureStage(options, sourceType === 'EVENTO' ? 'occurrenceConfirmation' : 'catalogConfirmation', () => options.confirmExternalDependency!(innerTx, sourceType, sourceId, transactionContext))
          : undefined;
        let run = await tx.pdvMigrationRun.findUnique({ where: { id: runId } });
        const checkpoint = initialCheckpoint(scope, transformVersion, companyId, pointId, sourceHash, items);
        if (!run) {
          const identityData = runtimeSupportsScopeIdentity(tx) ? { scope, cervejariaId: companyId, pontoVendaId: pointId } : {};
          run = await tx.pdvMigrationRun.create({ data: { id: runId, ...identityData, status: 'RUNNING', transformVersion, sourceSnapshotHash: sourceHash, checkpoint } });
        } else if (!runMatchesScope(run, scope, companyId, pointId)) {
          throw new PdvCatalogBlocker('RUN_ID_SCOPE_MISMATCH', null, runId, 'runId already belongs to another tenant, PDV, or scope; state was left untouched.');
        }
        const state = await measureStage(options, 'checkpointMapsReceiptsAndDestinations', () => validateCheckpoint(tx, run, scope, transformVersion, companyId, pointId, sourceHash, items, run.status === 'COMPLETED', confirmExternal));
        if (run.status === 'COMPLETED') {
          if (options.validateScope) await measureStage(options, 'scopeReconciliation', () => options.validateScope!(tx, items, transactionContext));
          return { complete: true, checkpoint: run.checkpoint };
        }
        if (state.cursor >= items.length) return { finalize: true, checkpoint: run.checkpoint, items, sourceHash };
        if (options.maxBatches != null && committedBatches >= options.maxBatches) return { paused: true, checkpoint: run.checkpoint };

        let batchEnd = Math.min(state.cursor + batchSize, items.length);
        const candidateKeys = new Set(items.slice(state.cursor, batchEnd).map((item) => key(item.type, item.id)));
        for (let index = state.cursor; index < batchEnd; index++) {
          if (items[index].dependencies.some((dependencyKey) => candidateKeys.has(dependencyKey))) { batchEnd = index; break; }
        }
        if (batchEnd === state.cursor) batchEnd = state.cursor + 1;
        const batchItems = items.slice(state.cursor, batchEnd);
        await measureStage(options, 'batchDependencyConfirmation', async () => {
          for (const item of batchItems) for (const dependencyKey of item.dependencies) await confirmDependency(tx, companyId, pointId, dependencyKey, items, transformVersion, confirmExternal);
        });
        const existingMaps: any[] = [];
        for (const item of batchItems) existingMaps.push(await verifyMap(tx, item, companyId, pointId, transformVersion));
        const sequence = state.batches.length + 1;
        const payloadHash = canonicalPdvPayloadHash(batchItems.map((item) => ({ sourceType: item.type, sourceId: item.id, payloadHash: canonicalPdvPayloadHash(item.sourcePayload) })));
        const batch = await tx.pdvMigrationBatch.create({ data: { runId, sequence, status: 'PROCESSING', payloadHash, checkpoint: { scope, sourceCursorBefore: state.cursor, sourceCursorAfter: batchEnd, receipts: [] } } });
        const receipts: any[] = [];
        await measureStage(options, 'destinationWritesAndReceipts', async () => {
          for (let index = 0; index < batchItems.length; index++) {
            const item = batchItems[index];
            const existingMap = existingMaps[index];
            const destinationCreated = existingMap ? false : await (options.writeItem ? options.writeItem(tx, item, Boolean(existingMap)) : writeTarget(tx, item));
            if (options.afterDestinationWrite) await options.afterDestinationWrite(item, tx);
            const destinationHash = await verifyDestination(tx, item);
            if (existingMap) {
              const oldBatch = await tx.pdvMigrationBatch.findFirst({ where: { id: existingMap.lastBatchId, runId: existingMap.lastRunId } });
              const oldReceipt = (oldBatch?.checkpoint as any)?.receipts?.find((receipt: any) => receipt.sourceType === item.type && receipt.sourceId === item.id);
              if (!oldReceipt || oldReceipt.destinationHash !== destinationHash) throw new PdvCatalogBlocker('MAP_RECEIPT_DIVERGED', item.type, item.id, 'Destination or previous receipt diverges; migration will not overwrite it.');
            }
            receipts.push({ sourceType: item.type, sourceId: item.id, destinationType: item.destinationType, destinationId: item.destinationId, payloadHash: canonicalPdvPayloadHash(item.sourcePayload), destinationHash, destinationCreated });
          }
          await tx.pdvMigrationBatch.update({ where: { id: batch.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), checkpoint: { scope, sourceCursorBefore: state.cursor, sourceCursorAfter: batchEnd, receipts } } });
          for (let index = 0; index < batchItems.length; index++) {
            const item = batchItems[index];
            const receipt = receipts[index];
            const existingMap = existingMaps[index];
            const mapData = { destinationType: item.destinationType, destinationId: item.destinationId, cervejariaId: companyId, pontoVendaId: pointId, transformVersion, payloadHash: receipt.payloadHash, sourcePayload: item.sourcePayload, lastRunId: runId, lastBatchId: batch.id };
            if (existingMap) await tx.pdvMigrationMap.update({ where: { id: existingMap.id }, data: mapData });
            else await tx.pdvMigrationMap.create({ data: { sourceType: item.type, sourceId: item.id, ...mapData } });
          }
          const completedSourceKeys = [...state.completed, ...batchItems.map((item) => key(item.type, item.id))];
          const nextCheckpoint = { ...checkpoint, completedSourceKeys, lastConfirmedBatch: sequence, lastSourceKey: completedSourceKeys.at(-1) ?? null };
          await tx.pdvMigrationRun.update({ where: { id: runId }, data: { checkpoint: nextCheckpoint, status: 'RUNNING', finishedAt: null } });
        });
        return { advanced: true, cursor: batchEnd, total: items.length, batch: sequence };
      }, txOptions);
      if (result.complete) return { status: 'COMPLETED', runId, checkpoint: result.checkpoint, reusedCompletedRun: true };
      if (result.paused) return { status: 'RUNNING', runId, checkpoint: result.checkpoint };
      if (result.advanced) {
        committedBatches++;
        if (options.afterBatchCommit) await options.afterBatchCommit({ tenantId: companyId, phase: scope, cursor: result.cursor, total: result.total, batch: result.batch, durationMs: Date.now() - batchStartedAt });
        continue;
      }
      if (result.finalize) {
        const finalRun = await measureStage(options, 'finalization', () => transactionWithRetry(db, async (tx: Db) => {
          await lock(tx, scope, companyId, pointId);
          const dependency = await canonicalDependency(tx, companyId, pointId);
          const transactionContext = options.createTransactionContext ? await options.createTransactionContext(tx) : undefined;
          const items = await options.buildItems(tx, dependency.sourceKey, transactionContext);
          const sourceHash = snapshotHash(scope, transformVersion, companyId, pointId, items);
          const row = await tx.pdvMigrationRun.findUniqueOrThrow({ where: { id: runId } });
          if (!runMatchesScope(row, scope, companyId, pointId)) throw new PdvCatalogBlocker('RUN_ID_SCOPE_MISMATCH', null, runId, 'runId already belongs to another tenant, PDV, or scope; state was left untouched.');
          const confirmExternal = options.confirmExternalDependency
            ? (innerTx: Db, sourceType: string, sourceId: string) => measureStage(options, sourceType === 'EVENTO' ? 'occurrenceConfirmation' : 'catalogConfirmation', () => options.confirmExternalDependency!(innerTx, sourceType, sourceId, transactionContext))
            : undefined;
          await measureStage(options, 'checkpointMapsReceiptsAndDestinations', () => validateCheckpoint(tx, row, scope, transformVersion, companyId, pointId, sourceHash, items, true, confirmExternal));
          if (options.validateScope) await measureStage(options, 'scopeReconciliation', () => options.validateScope!(tx, items, transactionContext));
          return tx.pdvMigrationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
        }, txOptions));
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
      }, { isolationLevel: 'RepeatableRead', timeout: 10000, maxWait: 5000 });
      return { status: 'BLOCKED', runId, code: scopeMismatch ? 'RUN_ID_SCOPE_MISMATCH' : error.code, sourceType: error.sourceType, sourceId: error.sourceId, message: scopeMismatch ? 'runId belongs to another tenant/PDV/scope; evidence was left untouched.' : error.message, committedBatches, invalidatedCompletedRun: invalidated && existing?.status === 'COMPLETED' };
    }
    throw error;
  }
}

export async function runPdvCatalogMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number; measure?: (stage: string, operation: () => Promise<any>) => Promise<any>; afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, batchSize: options.batchSize ?? 100, transactionTimeoutMs: options.transactionTimeoutMs ?? 30000, transactionMaxWaitMs: options.transactionMaxWaitMs ?? 10000, scope: PDV_CATALOG_SCOPE, transformVersion: PDV_CATALOG_TRANSFORM_VERSION,
    buildItems: async (tx, pdvSourceKey) => {
      const snapshot = await readSnapshot(tx, options.companyId);
      return itemsFor(options.companyId, options.pointId, snapshot, pdvSourceKey);
    },
  });
}

async function writeKitchenPreparationTarget(tx: Db, item: any) {
  const current = await tx.pedidoOperacao.findUnique({ where: { id: item.destinationId }, select: { id: true, pontoVendaId: true, updatedAt: true } });
  if (!current) throw new PdvCatalogBlocker('KITCHEN_ORDER_DESTINATION_MISSING', item.type, item.id, 'Pedido de cozinha de origem ausente.');
  if (current.pontoVendaId === item.destinationData.pontoVendaId) return false;
  if (current.pontoVendaId != null) throw new PdvCatalogBlocker('KITCHEN_ORDER_EXISTING_PDV_CONFLICT', item.type, item.id, 'Vínculo foi preenchido desde a fotografia; não será sobrescrito.');
  const changed = await tx.pedidoOperacao.updateMany({ where: { id: item.destinationId, pontoVendaId: null }, data: { pontoVendaId: item.destinationData.pontoVendaId, updatedAt: current.updatedAt } });
  if (changed.count !== 1) throw new PdvCatalogBlocker('KITCHEN_ORDER_WRITE_RACE', item.type, item.id, 'Pedido mudou durante a atribuição; lote será revertido.');
  return false;
}

/** Validate links added later by the commercial scope before V4 normalizes them. */
async function confirmedCommercialKitchenCommands(tx: Db, snapshot: any, companyId: string, pointId: string, confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }>) {
  const commandIds = [...new Set(snapshot.orders.map((row: any) => row.comandaId))];
  const maps = commandIds.length ? await tx.pdvMigrationMap.findMany({ where: { sourceType: 'COMANDA', sourceId: { in: commandIds } } }) : [];
  const mapByCommand = new Map(maps.map((row: any) => [row.sourceId, row]));
  const result = new Set<string>();
  const commandLinkEvidence = new Map<string, { sourcePdvId: string | null; origin: 'LEGACY_SOURCE_LINK' | 'UNLINKED_SOURCE' }>();
  const commerceRuns = await tx.pdvMigrationRun.findMany({ where: { scope: PDV_COMMERCE_SCOPE, cervejariaId: companyId }, select: { id: true, checkpoint: true } });
  const commerceRunIds = commerceRuns.map((run: any) => run.id);
  const commerceBatches = commerceRunIds.length ? await tx.pdvMigrationBatch.findMany({ where: { runId: { in: commerceRunIds } }, select: { checkpoint: true } }) : [];
  const migrationEvidence = new Set<string>();
  for (const run of commerceRuns) for (const sourceKey of (run.checkpoint as any)?.completedSourceKeys ?? []) if (String(sourceKey).startsWith('COMANDA:')) migrationEvidence.add(String(sourceKey).slice('COMANDA:'.length));
  for (const batch of commerceBatches) for (const receipt of (batch.checkpoint as any)?.receipts ?? []) if (receipt.sourceType === 'COMANDA') migrationEvidence.add(receipt.sourceId);
  const sourceEvidenceByCommand = new Map<string, { sourcePdvId: string | null; origin: 'LEGACY_SOURCE_LINK' | 'UNLINKED_SOURCE' }>();
  for (const order of snapshot.orders) {
    const prepMap: any = snapshot.preparationMapsByOrderId?.get(order.id);
    if (!prepMap) continue;
    const payload = prepMap.sourcePayload as any;
    const evidence = payload?.commandLinkEvidence;
    const orderEvidence = payload?.orderLinkEvidence;
    if (prepMap.cervejariaId !== companyId || prepMap.pontoVendaId !== pointId || prepMap.destinationType !== 'PEDIDO_COZINHA' || prepMap.destinationId !== order.id || prepMap.transformVersion !== PDV_KITCHEN_ORDER_PREPARATION_VERSION || prepMap.payloadHash !== canonicalPdvPayloadHash(payload) || payload?.command?.id !== order.comandaId || !evidence || !['LEGACY_SOURCE_LINK', 'UNLINKED_SOURCE'].includes(evidence.origin) || (evidence.origin === 'LEGACY_SOURCE_LINK' && evidence.sourcePdvId !== pointId) || (evidence.origin === 'UNLINKED_SOURCE' && evidence.sourcePdvId !== null) || !orderEvidence || !['PREEXISTING_SOURCE_LINK', 'UNLINKED_SOURCE'].includes(orderEvidence.origin) || (orderEvidence.origin === 'PREEXISTING_SOURCE_LINK' && orderEvidence.sourcePdvId !== pointId) || (orderEvidence.origin === 'UNLINKED_SOURCE' && orderEvidence.sourcePdvId !== null)) throw new PdvCatalogBlocker('KITCHEN_ORDER_PREPARATION_ORIGIN_EVIDENCE_DIVERGED', 'PEDIDO_COZINHA', order.id, 'Mapa de preparação não preserva evidência íntegra da origem dos vínculos PDV.');
    const [prepRun, prepBatch] = await Promise.all([
      tx.pdvMigrationRun.findUnique({ where: { id: prepMap.lastRunId } }),
      prepMap.lastBatchId ? tx.pdvMigrationBatch.findFirst({ where: { id: prepMap.lastBatchId, runId: prepMap.lastRunId } }) : null,
    ]);
    const prepCheckpoint = prepRun?.checkpoint as any;
    const prepReceipt = (prepBatch?.checkpoint as any)?.receipts?.find((row: any) => row.sourceType === PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE && row.sourceId === order.id);
    const prepDestinationHash = canonicalPdvPayloadHash({ pontoVendaId: pointId });
    // BLOCKED runs may still contain an intact per-item receipt. A preparation replay
    // can only restore that run after the shared checkpoint validator rechecks every
    // source, dependency, map, batch, receipt and destination. Do not repair or rewrite it here.
    if (!prepRun || !['RUNNING', 'COMPLETED', 'BLOCKED'].includes(prepRun.status) || prepRun.scope !== PDV_KITCHEN_ORDER_PREPARATION_SCOPE || prepRun.cervejariaId !== companyId || prepRun.pontoVendaId !== pointId || prepRun.transformVersion !== PDV_KITCHEN_ORDER_PREPARATION_VERSION || prepCheckpoint?.scope !== PDV_KITCHEN_ORDER_PREPARATION_SCOPE || prepCheckpoint?.companyId !== companyId || prepCheckpoint?.pointId !== pointId || prepCheckpoint?.transformVersion !== PDV_KITCHEN_ORDER_PREPARATION_VERSION || !(prepCheckpoint?.completedSourceKeys ?? []).includes(`${PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE}:${order.id}`) || prepBatch?.status !== 'CONFIRMED' || prepReceipt?.payloadHash !== prepMap.payloadHash || prepReceipt?.destinationHash !== prepDestinationHash || order.pontoVendaId !== pointId) throw new PdvCatalogBlocker('KITCHEN_ORDER_PREPARATION_ORIGIN_EVIDENCE_UNCONFIRMED', 'PEDIDO_COZINHA', order.id, 'Run, lote, recibo ou destino não confirma a evidência histórica da preparação.');
    const prior = sourceEvidenceByCommand.get(order.comandaId);
    if (prior && (prior.sourcePdvId !== evidence.sourcePdvId || prior.origin !== evidence.origin)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMAND_ORIGIN_EVIDENCE_CONFLICT', 'COMANDA', order.comandaId, 'Pedidos da mesma comanda divergem sobre a origem do vínculo PDV.');
    sourceEvidenceByCommand.set(order.comandaId, evidence);
  }
  let occurrenceColumnAvailable: boolean | null = null;
  for (const order of snapshot.orders) {
    const command = order.comanda;
    const map: any = mapByCommand.get(command.id);
    const priorEvidence = sourceEvidenceByCommand.get(command.id);
    const hasCommercialLink = command.origem === 'EVENTO' && (command.pontoVendaId != null || map != null);
    if (!map && command.origem === 'EVENTO' && command.pontoVendaId != null) {
      if (migrationEvidence.has(command.id)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_MAP_MISSING', 'COMANDA', command.id, 'Há evidência de lote comercial para esta comanda, mas seu mapa está ausente; vínculo legado não será presumido.');
      if (priorEvidence && (priorEvidence.origin !== 'LEGACY_SOURCE_LINK' || priorEvidence.sourcePdvId !== command.pontoVendaId)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMAND_ORIGIN_DIVERGED', 'COMANDA', command.id, 'Vínculo atual diverge da evidência imutável registrada na preparação anterior.');
      if (command.pontoVendaId !== pointId || command.pontoVenda?.id !== pointId || command.pontoVenda.cervejariaId !== companyId) throw new PdvCatalogBlocker('KITCHEN_ORDER_LEGACY_PDV_UNPROVEN', 'COMANDA', command.id, 'Vínculo legado da comanda não corresponde ao único PDV validado do tenant.');
      const occurrence = command.eventoId ? confirmedOccurrences[command.eventoId] : null;
      if (!occurrence || occurrence.companyId !== companyId || occurrence.pointId !== pointId || command.evento?.cervejariaId !== companyId) throw new PdvCatalogBlocker('KITCHEN_ORDER_LEGACY_OCCURRENCE_UNPROVEN', 'COMANDA', command.id, 'Evento, Trailer ou ocorrência não confirmam o PDV legado no tenant.');
      result.add(command.id);
      commandLinkEvidence.set(command.id, { sourcePdvId: command.pontoVendaId, origin: 'LEGACY_SOURCE_LINK' });
      continue;
    }
    if (!map && command.origem === 'EVENTO' && migrationEvidence.has(command.id)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_MAP_MISSING', 'COMANDA', command.id, 'Lote comercial confirma esta comanda, mas mapa ou vínculo de destino está ausente; não será reclassificada como origem legada.');
    if (!map && command.origem === 'EVENTO' && command.pontoVendaId == null && priorEvidence?.origin === 'LEGACY_SOURCE_LINK') throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMAND_ORIGIN_DIVERGED', 'COMANDA', command.id, 'Vínculo legado desapareceu após a preparação confirmada.');
    if (!hasCommercialLink) {
      commandLinkEvidence.set(command.id, priorEvidence ?? { sourcePdvId: null, origin: 'UNLINKED_SOURCE' });
      continue;
    }
    if (!map) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_MAP_MISSING', 'COMANDA', command.id, 'Comanda EVENTO tem PDV, mas mapa comercial confirmado está ausente.');
    if (map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'COMANDA' || map.destinationId !== command.id || map.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || map.payloadHash !== canonicalPdvPayloadHash(map.sourcePayload)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_MAP_DIVERGED', 'COMANDA', command.id, 'Mapa comercial da comanda diverge de empresa, PDV, identidade ou hash.');
    const original = map.sourcePayload as any;
    if (original?.id !== command.id || original?.origem !== command.origem || original?.eventoId !== command.eventoId) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_SOURCE_DIVERGED', 'COMANDA', command.id, 'Payload confirmado da comanda diverge da origem EVENTO atual.');
    const [run, batch] = await Promise.all([
      tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } }),
      map.lastBatchId ? tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } }) : null,
    ]);
    const checkpoint = run?.checkpoint as any;
    const receipts = (batch?.checkpoint as any)?.receipts;
    const receipt = Array.isArray(receipts) ? receipts.find((row: any) => row.sourceType === 'COMANDA' && row.sourceId === command.id) : null;
    if (run?.status !== 'COMPLETED' || checkpoint?.scope !== PDV_COMMERCE_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId || checkpoint?.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || !checkpoint.completedSourceKeys?.includes(`COMANDA:${command.id}`) || batch?.status !== 'CONFIRMED' || receipt?.destinationType !== 'COMANDA' || receipt?.destinationId !== command.id || receipt?.payloadHash !== map.payloadHash) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_RECEIPT_MISSING', 'COMANDA', command.id, 'Run/checkpoint/lote/recibo comercial não confirma a comanda.');
    const expectedOccurrenceId = command.origem === 'EVENTO' ? confirmedOccurrences[command.eventoId]?.id : null;
    if (command.origem === 'EVENTO' && !expectedOccurrenceId) throw new PdvCatalogBlocker('KITCHEN_ORDER_OCCURRENCE_MAP_UNCONFIRMED', 'EVENTO', command.id, 'Comanda EVENTO não possui ocorrência atual confirmada.');
    if (command.origem === 'EVENTO' && !priorEvidence) throw new PdvCatalogBlocker('KITCHEN_ORDER_PREPARATION_ORIGIN_EVIDENCE_MISSING', 'COMANDA', command.id, 'A migração comercial não preserva o vínculo PDV anterior; exige-se recibo de preparação imutável anterior.');
    const confirmedLinkEvidence = priorEvidence ?? { sourcePdvId: command.pontoVendaId ?? null, origin: command.pontoVendaId == null ? 'UNLINKED_SOURCE' as const : 'LEGACY_SOURCE_LINK' as const };
    if (occurrenceColumnAvailable == null) {
      const columns = await tx.$queryRaw`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Comanda' AND column_name = 'ocorrenciaId') AS present`;
      occurrenceColumnAvailable = columns[0]?.present === true;
    }
    if (!occurrenceColumnAvailable) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_DESTINATION_SCHEMA_MISSING', 'COMANDA', command.id, 'Mapa comercial existe, mas o destino ocorrenciaId ainda não está disponível.');
    const actual = await tx.$queryRaw`SELECT "pontoVendaId", "ocorrenciaId" FROM "public"."Comanda" WHERE "id" = ${command.id}`;
    const expectedDestination = { pontoVendaId: pointId, ocorrenciaId: expectedOccurrenceId };
    if (actual.length !== 1 || actual[0].pontoVendaId !== pointId || actual[0].ocorrenciaId !== expectedOccurrenceId || receipt.destinationHash !== canonicalPdvPayloadHash(expectedDestination)) throw new PdvCatalogBlocker('KITCHEN_ORDER_COMMERCE_DESTINATION_DIVERGED', 'COMANDA', command.id, 'Destino comercial atual diverge do recibo e da ocorrência mapeada.');
    result.add(command.id);
    commandLinkEvidence.set(command.id, confirmedLinkEvidence);
  }
  return { accepted: result, evidence: commandLinkEvidence };
}

async function assertKitchenPdvUnambiguous(tx: Db, companyId: string, pointId: string) {
  const points = await tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } });
  if (points.length !== 1 || points[0].id !== pointId) throw new PdvCatalogBlocker('KITCHEN_ORDER_CANONICAL_PDV_AMBIGUOUS', 'PONTO_VENDA', pointId, 'Empresa não possui exatamente o PDV anteriormente confirmado; atribuição de pedidos bloqueada.');
}

/** Prepare only proven legacy kitchen-order PDV links on a pre-commercial schema. */
export async function runPdvKitchenOrderContextPreparation(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number; measure?: (stage: string, operation: () => Promise<any>) => Promise<any>; afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void; afterBatchCommit?: (progress: { tenantId: string; phase: string; cursor: number; total: number; batch: number; durationMs: number }) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options,
    batchSize: options.batchSize ?? 10,
    transactionTimeoutMs: options.transactionTimeoutMs ?? 30000,
    transactionMaxWaitMs: options.transactionMaxWaitMs ?? 10000,
    afterBatchCommit: options.afterBatchCommit ?? ((progress) => console.info(JSON.stringify({ event: 'PDV_MIGRATION_BATCH_COMMITTED', ...progress }))),
    scope: PDV_KITCHEN_ORDER_PREPARATION_SCOPE,
    transformVersion: PDV_KITCHEN_ORDER_PREPARATION_VERSION,
    createTransactionContext: async (tx) => {
      let occurrenceResolver: Promise<(eventId: string) => Promise<any>> | null = null;
      const occurrences: Record<string, { id: string; companyId: string; pointId: string }> = {};
      return {
        occurrences,
        resolveOccurrence: async (eventId: string) => {
          if (!occurrenceResolver) occurrenceResolver = measureStage(options, 'occurrenceConfirmation', () => createScopedOccurrenceResolver(tx, options.companyId, options.pointId));
          return (await occurrenceResolver)(eventId);
        },
      };
    },
    buildItems: async (tx, pdvSourceKey, transactionContext) => {
      await assertKitchenPdvUnambiguous(tx, options.companyId, options.pointId);
      const snapshot = await measureStage(options, 'sourceSnapshot', () => readPdvKitchenOrderPreparationSnapshot(tx, options.companyId));
      for (const order of snapshot.orders) {
        const command = order.comanda;
        if (command?.origem !== 'EVENTO' || !command.eventoId || transactionContext.occurrences[command.eventoId]) continue;
        const occurrence = await transactionContext.resolveOccurrence(command.eventoId);
        transactionContext.occurrences[command.eventoId] = { id: occurrence.id, companyId: occurrence.cervejariaId, pointId: occurrence.pontoVendaId };
      }
      const commandLinks = await confirmedCommercialKitchenCommands(tx, snapshot, options.companyId, options.pointId, transactionContext.occurrences);
      return buildPdvKitchenOrderPreparationItems({ companyId: options.companyId, pointId: options.pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedOccurrences: transactionContext.occurrences, confirmedCommercialCommands: commandLinks.accepted, commandLinkEvidence: commandLinks.evidence });
    },
    confirmExternalDependency: async (_tx, sourceType, sourceId, transactionContext) => {
      if (sourceType === 'EVENTO') { await transactionContext.resolveOccurrence(sourceId); return true; }
      return false;
    },
    writeItem: writeKitchenPreparationTarget,
  });
}

async function findConfirmedEventOccurrence(tx: Db, companyId: string, pointId: string, eventId: string) {
  try {
    return await findConfirmedPdvEventOccurrence(tx, companyId, pointId, eventId);
  } catch (error) {
    const blocker = error as { code?: string; sourceType?: string | null; sourceId?: string | null; message?: string };
    if (blocker?.code) throw new PdvCatalogBlocker(`OCCURRENCE_${blocker.code}`, 'EVENTO', eventId, blocker.message ?? 'A certificação da ocorrência falhou.');
    throw error;
  }
}

async function createScopedOccurrenceResolver(tx: Db, companyId: string, pointId: string) {
  const convert = (eventId: string, error: any): never => {
    if (error?.code) throw new PdvCatalogBlocker(`OCCURRENCE_${error.code}`, 'EVENTO', eventId, error.message ?? 'Occurrence integrity confirmation failed.');
    throw error;
  };
  try {
    const resolve = await createConfirmedPdvEventOccurrenceResolver(tx, companyId, pointId);
    return async (eventId: string) => {
      try { return await resolve(eventId); } catch (error) { return convert(eventId, error); }
    };
  } catch (error) {
    return convert((error as any)?.sourceId ?? '', error);
  }
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

function createConfirmedCatalogResolver(tx: Db, companyId: string, pointId: string) {
  let snapshotPromise: Promise<{ items: any[]; itemsByKey: Map<string, any>; sourceHash: string }> | null = null;
  const runValidation = new Map<string, Promise<void>>();
  const sourceConfirmation = new Map<string, Promise<{ item: any; map: any }>>();
  const loadSnapshot = () => snapshotPromise ??= (async () => {
    const dependency = await canonicalDependency(tx, companyId, pointId);
    const snapshot = await readSnapshot(tx, companyId);
    const items = itemsFor(companyId, pointId, snapshot, dependency.sourceKey);
    return { itemsByKey: new Map(items.map((item) => [key(item.type, item.id), item])), items, sourceHash: snapshotHash(PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION, companyId, pointId, items) };
  })();
  return (sourceType: string, sourceId: string) => {
    const sourceKey = key(sourceType, sourceId);
    let confirmation = sourceConfirmation.get(sourceKey);
    if (!confirmation) {
      confirmation = (async () => {
    const current = await loadSnapshot();
    const item = current.itemsByKey.get(key(sourceType, sourceId));
    if (!item) throw new PdvCatalogBlocker('SESSION_CATALOG_SOURCE_MISSING', sourceType, sourceId, 'Catalog source is absent from the current tenant snapshot.');
    const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
    if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== item.destinationType || map.destinationId !== item.destinationId || !map.lastRunId) throw new PdvCatalogBlocker('SESSION_CATALOG_MAP_MISSING', sourceType, sourceId, 'Catalog source has no confirmed map in this tenant/PDV.');
    let validation = runValidation.get(map.lastRunId);
    if (!validation) {
      validation = (async () => {
        const run = await tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } });
        if (!run || run.status !== 'COMPLETED' || !runMatchesScope(run, PDV_CATALOG_SCOPE, companyId, pointId)) throw new PdvCatalogBlocker('SESSION_CATALOG_RUN_INCOMPLETE', sourceType, sourceId, 'Catalog map was not confirmed by a completed run in this scope.');
        await validateCheckpoint(tx, run, PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION, companyId, pointId, current.sourceHash, current.items, true);
      })();
      runValidation.set(map.lastRunId, validation);
    }
    await validation;
    return { item, map };
      })();
      sourceConfirmation.set(sourceKey, confirmation);
    }
    return confirmation;
  };
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

export async function runPdvSessionMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number; measure?: (stage: string, operation: () => Promise<any>) => Promise<any>; afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options,
    batchSize: options.batchSize ?? 250,
    transactionTimeoutMs: options.transactionTimeoutMs ?? 30000,
    transactionMaxWaitMs: options.transactionMaxWaitMs ?? 10000,
    scope: PDV_SESSION_SCOPE,
    transformVersion: PDV_SESSION_TRANSFORM_VERSION,
    createTransactionContext: async (tx) => {
      let occurrenceResolver: Promise<(eventId: string) => Promise<any>> | null = null;
      let catalogResolver: ReturnType<typeof createConfirmedCatalogResolver> | null = null;
      return {
        resolveOccurrence: async (eventId: string) => {
          if (!occurrenceResolver) occurrenceResolver = measureStage(options, 'occurrenceConfirmation', () => createScopedOccurrenceResolver(tx, options.companyId, options.pointId));
          return (await occurrenceResolver)(eventId);
        },
        resolveCatalog: async (sourceType: string, sourceId: string) => {
          catalogResolver ??= createConfirmedCatalogResolver(tx, options.companyId, options.pointId);
          return measureStage(options, 'catalogConfirmation', () => catalogResolver!(sourceType, sourceId));
        },
      };
    },
    buildItems: async (tx, pdvSourceKey, transactionContext) => {
      const snapshot = await measureStage(options, 'sourceSnapshot', () => readPdvSessionSourceSnapshot(tx, options.companyId));
      const confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string; date: Date }> = {};
      const confirmedMenus: Record<string, { id: string; companyId: string; pointId: string }> = {};
      for (const session of snapshot.eventSessions) {
        if (!session.evento.data) throw new PdvCatalogBlocker('SESSION_OPERATIONAL_DAY_UNPROVEN', 'SESSAO_CAIXA_EVENTO', session.id, 'Event has no persisted operational date.');
        if (!confirmedOccurrences[session.eventoId]) {
          const occurrence = await transactionContext.resolveOccurrence(session.eventoId);
          confirmedOccurrences[session.eventoId] = { id: occurrence.id, companyId: occurrence.cervejariaId, pointId: occurrence.pontoVendaId, date: occurrence.data };
        }
        if (session.evento.cardapioId && !confirmedMenus[session.evento.cardapioId]) {
          const { item } = await transactionContext.resolveCatalog('CATALOGO_CARDAPIO', session.evento.cardapioId);
          if (item.destinationType !== 'CARDAPIO' || item.destinationId !== session.evento.cardapioId) throw new PdvCatalogBlocker('SESSION_MENU_CATALOG_MAP_MISSING', 'CATALOGO_CARDAPIO', session.evento.cardapioId, 'Mapped menu does not preserve its source identity.');
          confirmedMenus[session.evento.cardapioId] = { id: session.evento.cardapioId, companyId: options.companyId, pointId: options.pointId };
        }
      }
      return buildPdvSessionMigrationItems({ companyId: options.companyId, pointId: options.pointId, snapshot, confirmedPdvSourceKey: pdvSourceKey, confirmedOccurrences, confirmedMenus });
    },
    confirmExternalDependency: async (_tx, sourceType, sourceId, transactionContext) => {
      if (sourceType === 'EVENTO') { await transactionContext.resolveOccurrence(sourceId); return true; }
      if (sourceType === 'CATALOGO_CARDAPIO' || sourceType === 'CATALOGO_PRODUTO') { await transactionContext.resolveCatalog(sourceType, sourceId); return true; }
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

async function findConfirmedHistoricalCommerceCommand(tx: Db, companyId: string, pointId: string, command: any): Promise<ConfirmedHistoricalCommerceCommand> {
  const sourceType = 'COMANDA'; const sourceId = command.id;
  const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!map || map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'COMANDA' || map.destinationId !== command.id || !map.lastRunId || !map.lastBatchId || map.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || map.payloadHash !== canonicalPdvPayloadHash(map.sourcePayload)) {
    throw new PdvCatalogBlocker('FINANCE_HISTORICAL_COMMERCE_PROOF_MISSING', sourceType, sourceId, 'A alteração do PDV da comanda não tem mapa comercial confirmado neste tenant/PDV.');
  }
  const [run, batch] = await Promise.all([
    tx.pdvMigrationRun.findUnique({ where: { id: map.lastRunId } }),
    tx.pdvMigrationBatch.findFirst({ where: { id: map.lastBatchId, runId: map.lastRunId } }),
  ]);
  const checkpoint = run?.checkpoint as any;
  const receipt = (batch?.checkpoint as any)?.receipts?.find((row: any) => row.sourceType === sourceType && row.sourceId === sourceId);
  const original = map.sourcePayload as any;
  const originalPointId = original?.transformationSourcePointId;
  const originalOccurrenceId = original?.transformationSourceOccurrenceId;
  if (run?.status !== 'COMPLETED' || run.scope !== PDV_COMMERCE_SCOPE || run.cervejariaId !== companyId || run.pontoVendaId !== pointId
    || checkpoint?.scope !== PDV_COMMERCE_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId
    || checkpoint?.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || !checkpoint?.completedSourceKeys?.includes(`COMANDA:${command.id}`)
    || batch?.status !== 'CONFIRMED' || receipt?.destinationType !== 'COMANDA' || receipt?.destinationId !== command.id
    || receipt?.payloadHash !== map.payloadHash || original?.id !== command.id || original?.origem !== command.origem
    || original?.eventoId !== command.eventoId || originalPointId !== null || originalOccurrenceId !== null
    || command.origem !== 'EVENTO' || command.eventoId == null || command.evento?.cervejariaId !== companyId
    || command.pontoVendaId !== pointId || command.ocorrenciaId == null) {
    throw new PdvCatalogBlocker('FINANCE_HISTORICAL_COMMERCE_PROOF_DIVERGED', sourceType, sourceId, 'Run, checkpoint, lote, recibo ou destino comercial não confirma exclusivamente o vínculo aprovado.');
  }
  const destinationHash = canonicalPdvPayloadHash({ pontoVendaId: command.pontoVendaId, ocorrenciaId: command.ocorrenciaId });
  if (receipt.destinationHash !== destinationHash) throw new PdvCatalogBlocker('FINANCE_HISTORICAL_COMMERCE_DESTINATION_DIVERGED', sourceType, sourceId, 'Destino comercial atual diverge do recibo confirmado.');
  return { commandId: command.id, companyId, pointId, eventId: command.eventoId, originalPointId, originalOccurrenceId, runId: run.id, batchId: batch.id, payloadHash: map.payloadHash, destinationHash };
}

async function writeFinanceTarget(tx: Db, item: any, hasExistingMap: boolean) {
  const existing = await readDestination(tx, item.destinationType, item.destinationId);
  if (item.type === 'MOVIMENTO_CAIXA_EVENTO') {
    if (existing && !hasExistingMap) throw new PdvCatalogBlocker('FINANCE_MOVEMENT_ID_COLLISION', item.type, item.id, 'ID do movimento Evento já pertence ao financeiro Por Caixa.');
    if (!existing) await tx.movimentoCaixaOperacao.create({ data: item.destinationData });
    return !existing;
  }
  if (!existing) throw new PdvCatalogBlocker('FINANCE_SOURCE_MISSING', item.type, item.id, 'Registro financeiro comum ausente; nenhuma linha será fabricada.');
  if (item.type === 'PAGAMENTO' && !hasExistingMap && (existing.sessaoCaixaEventoId || item.destinationData.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA')) {
    if (existing.sessaoCaixaEventoId && existing.sessaoCaixaId != null) throw new PdvCatalogBlocker('FINANCE_PAYMENT_DOUBLE_SESSION', item.type, item.id, 'Pagamento contém duas sessões antes de ter mapa financeiro.');
    await tx.pagamento.update({ where: { id: item.id }, data: { sessaoCaixaId: item.destinationData.sessaoCaixaId, provenienciaHistorica: item.destinationData.provenienciaHistorica } });
  }
  return false;
}

export async function runPdvFinanceMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number; measure?: (stage: string, operation: () => Promise<any>) => Promise<any>; afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void; afterBatchCommit?: (progress: { tenantId: string; phase: string; cursor: number; total: number; batch: number; durationMs: number }) => Promise<void> | void; historicalNoSessionApproval?: HistoricalNoSessionApproval }) {
  if (options.historicalNoSessionApproval) {
    let target: URL;
    try { target = new URL(process.env.DATABASE_URL ?? ''); }
    catch { throw new PdvCatalogBlocker('FINANCE_HISTORICAL_APPROVAL_QA_GUARD_FAILED', 'PAGAMENTO', null, 'A política histórica só pode ser usada no QA isolado.'); }
    if (process.env.NODE_ENV !== 'test' || process.env.PDV_ISOLATED_QA !== '1' || process.env.QA_DATABASE_URL !== process.env.DATABASE_URL
      || !['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname)
      || !/^554(?:3[9]|4[0-9])$/.test(target.port) || target.pathname !== '/cervejaria_qa_pdv_unico') {
      throw new PdvCatalogBlocker('FINANCE_HISTORICAL_APPROVAL_QA_GUARD_FAILED', 'PAGAMENTO', null, 'A política histórica só pode ser usada no PostgreSQL QA isolado.');
    }
  }
  return runPdvScopedMigration({
    ...options, batchSize: options.batchSize ?? 25, transactionTimeoutMs: options.transactionTimeoutMs ?? 30000, transactionMaxWaitMs: options.transactionMaxWaitMs ?? 10000,
    afterBatchCommit: options.afterBatchCommit ?? ((progress) => console.info(JSON.stringify({ event: 'PDV_MIGRATION_BATCH_COMMITTED', ...progress }))),
    scope: PDV_FINANCE_SCOPE, transformVersion: PDV_FINANCE_TRANSFORM_VERSION,
    createTransactionContext: async (tx) => {
      let resolver: Promise<(eventId: string) => Promise<any>> | null = null;
      const sessionConfirmations = new Map<string, Promise<any>>();
      return { resolveOccurrence: async (eventId: string) => {
        resolver ??= measureStage(options, 'occurrenceConfirmation', () => createScopedOccurrenceResolver(tx, options.companyId, options.pointId));
        return (await resolver)(eventId);
      }, resolveFinanceSession: (sourceType: 'SESSAO_CAIXA_EVENTO' | 'SESSAO_CAIXA_OPERACAO', sourceId: string) => {
        const confirmationKey = key(sourceType, sourceId);
        let confirmation = sessionConfirmations.get(confirmationKey);
        if (!confirmation) {
          confirmation = findConfirmedFinanceSession(tx, options.companyId, options.pointId, sourceType, sourceId);
          sessionConfirmations.set(confirmationKey, confirmation);
        }
        return confirmation;
      } };
    },
    buildItems: async (tx, pdvSourceKey, transactionContext) => {
      const snapshot = await measureStage(options, 'sourceSnapshot', () => readPdvFinanceSourceSnapshot(tx, options.companyId));
      const confirmedSessions: Record<string, any> = {};
      const eventIds = new Set<string>();
      for (const payment of snapshot.payments) {
        if (payment.comanda.eventoId) eventIds.add(payment.comanda.eventoId);
        if (payment.sessaoCaixaEventoId) {
          const sourceType = 'SESSAO_CAIXA_EVENTO';
          const sourceId = payment.sessaoCaixaEventoId;
          confirmedSessions[key(sourceType, sourceId)] = await transactionContext.resolveFinanceSession(sourceType, sourceId);
        } else if (payment.sessaoCaixaId) {
          const sourceType = 'SESSAO_CAIXA_OPERACAO';
          const sourceId = payment.sessaoCaixaId;
          confirmedSessions[key(sourceType, sourceId)] = await transactionContext.resolveFinanceSession(sourceType, sourceId);
        }
      }
      for (const debt of snapshot.debts) if (debt.comanda.eventoId) eventIds.add(debt.comanda.eventoId);
      for (const movement of snapshot.eventMovements) {
        const sourceType = 'SESSAO_CAIXA_EVENTO'; const sourceId = movement.sessaoId;
        confirmedSessions[key(sourceType, sourceId)] = await transactionContext.resolveFinanceSession(sourceType, sourceId);
      }
      for (const movement of snapshot.operationalMovements) {
        const sourceType = 'SESSAO_CAIXA_OPERACAO'; const sourceId = movement.sessaoId;
        confirmedSessions[key(sourceType, sourceId)] = await transactionContext.resolveFinanceSession(sourceType, sourceId);
      }
      const confirmedEvents: Record<string, any> = {};
      for (const eventId of eventIds) {
        const row = await transactionContext.resolveOccurrence(eventId);
        confirmedEvents[eventId] = { id: row.id, companyId: row.cervejariaId, pointId: row.pontoVendaId };
      }
      const paymentIds = snapshot.payments.map((payment: any) => payment.id);
      const mappedPayments = await tx.pdvMigrationMap.findMany({ where: { sourceType: 'PAGAMENTO', sourceId: { in: paymentIds } }, select: { sourceId: true } });
      const confirmedHistoricalCommerceCommands: Record<string, ConfirmedHistoricalCommerceCommand> = {};
      const approvedCommands = new Set((options.historicalNoSessionApproval?.entries ?? []).filter((entry) => entry.tenantId === options.companyId && entry.origin === 'EVENTO' && entry.pointId === null).map((entry) => entry.commandId));
      for (const commandId of approvedCommands) {
        const command = snapshot.payments.find((payment: any) => payment.comandaId === commandId)?.comanda;
        if (command?.pontoVendaId === options.pointId) confirmedHistoricalCommerceCommands[commandId] = await findConfirmedHistoricalCommerceCommand(tx, options.companyId, options.pointId, command);
      }
      return buildPdvFinanceMigrationItems({ companyId: options.companyId, pointId: options.pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedSessions, confirmedEvents, mappedPaymentIds: new Set(mappedPayments.map((row: any) => row.sourceId)), confirmedHistoricalCommerceCommands, historicalNoSessionApproval: options.historicalNoSessionApproval });
    },
    confirmExternalDependency: async (tx, sourceType, sourceId, transactionContext) => {
      if (sourceType === 'EVENTO') { await transactionContext.resolveOccurrence(sourceId); return true; }
      if (sourceType === 'SESSAO_CAIXA_EVENTO' || sourceType === 'SESSAO_CAIXA_OPERACAO') { await transactionContext.resolveFinanceSession(sourceType, sourceId); return true; }
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

async function reconcilePdvCommerce(tx: Db, companyId: string, pointId: string, pdvSourceKey: string, runId: string, confirmedItems: any[], transactionContext?: any) {
  // Read the source graph again inside the certification transaction. This is intentionally
  // independent of the planned item counters stored in the run checkpoint.
  const snapshot = await readPdvCommerceSourceSnapshot(tx, companyId);
  const eventIds = new Set<string>();
  for (const command of snapshot.commands) if (command.eventoId) eventIds.add(command.eventoId);
  for (const order of snapshot.portalOrders) if (order.eventoId) eventIds.add(order.eventoId);
  const confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }> = {};
  for (const eventId of eventIds) {
    const occurrence = await (transactionContext?.resolveOccurrence ? transactionContext.resolveOccurrence(eventId) : findConfirmedEventOccurrence(tx, companyId, pointId, eventId));
    confirmedOccurrences[eventId] = { id: occurrence.id, companyId: occurrence.cervejariaId, pointId: occurrence.pontoVendaId };
  }
  if (snapshot.coverage.tenantConflictCommandIds.length || snapshot.coverage.tenantConflictItemIds.length || snapshot.coverage.tenantConflictOrderIds.length || snapshot.coverage.tenantConflictInventoryIds.length) {
    throw new PdvCatalogBlocker('COMMERCE_RECONCILIATION_TENANT_DIVERGED', null, null, 'Reconciliação comercial encontrou vínculos entre tenants.');
  }
  const actualItems = buildPdvCommerceMigrationItems({ companyId, pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedOccurrences });
  await reconstituteConfirmedCommerceCommandSources(tx, companyId, pointId, runId, actualItems);
  if (actualItems.length !== confirmedItems.length || actualItems.some((item, index) => item.type !== confirmedItems[index]?.type || item.id !== confirmedItems[index]?.id)) {
    throw new PdvCatalogBlocker('COMMERCE_RECONCILIATION_COVERAGE_DIVERGED', null, null, 'IDs, ordem ou cobertura comercial mudaram desde a fotografia confirmada.');
  }
  for (let index = 0; index < actualItems.length; index++) {
    const item = actualItems[index];
    if (commercePayloadHash(item.sourcePayload) !== commercePayloadHash(confirmedItems[index].sourcePayload)) {
      throw new PdvCatalogBlocker('COMMERCE_RECONCILIATION_SOURCE_DIVERGED', item.type, item.id, 'Vínculo pai, snapshot, estado, timestamp, total ou quantidade diverge da fotografia confirmada.');
    }
    const map = await verifyMap(tx, item, companyId, pointId, PDV_COMMERCE_TRANSFORM_VERSION);
    if (!map) throw new PdvCatalogBlocker('COMMERCE_RECONCILIATION_MAP_MISSING', item.type, item.id, 'Registro comercial não tem mapa/recibo/destino confirmado.');
  }
  return {
    scopedSourceIdsReconciled: actualItems.length,
    unresolvedCommandIds: snapshot.coverage.unresolvedCommandIds,
    globalCoverage: 'NOT_CERTIFIED',
    stockLedgerReconciliation: 'NOT_PROVEN',
  };
}

/** Restore only source link fields already written under a valid commerce receipt. */
async function reconstituteConfirmedCommerceCommandSources(tx: Db, companyId: string, pointId: string, runId: string, items: any[]) {
  const commands = items.filter((item) => item.type === 'COMANDA');
  if (!commands.length) return;
  const maps = await tx.pdvMigrationMap.findMany({ where: { sourceType: 'COMANDA', sourceId: { in: commands.map((item) => item.id) } } });
  const byCommand = new Map(commands.map((item) => [item.id, item]));
  const changedMaps = maps.filter((map: any) => {
    const item: any = byCommand.get(map.sourceId);
    const original: any = map.sourcePayload;
    return item && original && (original.transformationSourcePointId !== item.sourcePayload.transformationSourcePointId
      || original.transformationSourceOccurrenceId !== item.sourcePayload.transformationSourceOccurrenceId);
  });
  if (!changedMaps.length) return;
  const runIds = [...new Set(changedMaps.map((map: any) => map.lastRunId).filter(Boolean))];
  const batchIds = [...new Set(changedMaps.map((map: any) => map.lastBatchId).filter(Boolean))];
  const [runs, batches] = await Promise.all([
    tx.pdvMigrationRun.findMany({ where: { id: { in: runIds } } }),
    tx.pdvMigrationBatch.findMany({ where: { id: { in: batchIds } } }),
  ]);
  const runsById = new Map(runs.map((row: any) => [row.id, row]));
  const batchesById = new Map(batches.map((row: any) => [row.id, row]));

  for (const map of changedMaps as any[]) {
    const item: any = byCommand.get(map.sourceId);
    const original: any = map.sourcePayload;
    const run: any = runsById.get(map.lastRunId);
    const batch: any = batchesById.get(map.lastBatchId);
    const checkpoint: any = run?.checkpoint;
    const receipt = (batch?.checkpoint as any)?.receipts?.find((row: any) => row.sourceType === 'COMANDA' && row.sourceId === item.id);
    const destinationHash = canonicalPdvPayloadHash({ pontoVendaId: item.destinationData.pontoVendaId, ocorrenciaId: item.destinationData.ocorrenciaId });
    if (map.cervejariaId !== companyId || map.pontoVendaId !== pointId || map.destinationType !== 'COMANDA' || map.destinationId !== item.id
      || map.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || map.payloadHash !== canonicalPdvPayloadHash(original)
      || original.id !== item.id || original.origem !== item.sourcePayload.origem || original.eventoId !== item.sourcePayload.eventoId
      || !run || !runMatchesScope(run, PDV_COMMERCE_SCOPE, companyId, pointId)
      || !['RUNNING', 'BLOCKED', 'COMPLETED'].includes(run.status) || run.status === 'RUNNING' && run.id !== runId
      || checkpoint?.scope !== PDV_COMMERCE_SCOPE || checkpoint?.companyId !== companyId || checkpoint?.pointId !== pointId
      || checkpoint?.transformVersion !== PDV_COMMERCE_TRANSFORM_VERSION || checkpoint?.sourceSnapshotHash !== run.sourceSnapshotHash
      || !checkpoint?.completedSourceKeys?.includes(`COMANDA:${item.id}`)
      || batch?.runId !== run.id || batch?.status !== 'CONFIRMED' || receipt?.destinationType !== 'COMANDA' || receipt?.destinationId !== item.id
      || receipt?.payloadHash !== map.payloadHash || receipt?.destinationHash !== destinationHash
      || item.destinationData.pontoVendaId !== pointId || canonicalPdvPayloadHash(item.sourcePayload) === canonicalPdvPayloadHash(original)) {
      throw new PdvCatalogBlocker('COMMERCE_TRANSFORMATION_PROOF_DIVERGED', 'COMANDA', item.id, 'A fotografia original sÃ³ pode ser restaurada por mapa, run/checkpoint, lote/recibo e destino comercial confirmados.');
    }
    item.sourcePayload.transformationSourcePointId = original.transformationSourcePointId;
    item.sourcePayload.transformationSourceOccurrenceId = original.transformationSourceOccurrenceId;
    if (canonicalPdvPayloadHash(item.sourcePayload) !== map.payloadHash) throw new PdvCatalogBlocker('SOURCE_PAYLOAD_CHANGED', 'COMANDA', item.id, 'Campos alÃ©m dos vÃ­nculos PDV/ocorrÃªncia diferem da fotografia comercial confirmada.');
  }
}

/** Reconciles existing command/order/stock rows and writes only confirmed PDV/event links. */
export async function runPdvCommerceMigration(options: { db: Db; companyId: string; pointId: string; runId: string; maxBatches?: number; batchSize?: number; transactionTimeoutMs?: number; transactionMaxWaitMs?: number; measure?: (stage: string, operation: () => Promise<any>) => Promise<any>; afterDestinationWrite?: (item: any, tx: Db) => Promise<void> | void; afterBatchCommit?: (progress: { tenantId: string; phase: string; cursor: number; total: number; batch: number; durationMs: number }) => Promise<void> | void }) {
  return runPdvScopedMigration({
    ...options, batchSize: options.batchSize ?? 25, transactionTimeoutMs: options.transactionTimeoutMs ?? 30000, transactionMaxWaitMs: options.transactionMaxWaitMs ?? 10000,
    afterBatchCommit: options.afterBatchCommit ?? ((progress) => console.info(JSON.stringify({ event: 'PDV_MIGRATION_BATCH_COMMITTED', ...progress }))),
    scope: PDV_COMMERCE_SCOPE, transformVersion: PDV_COMMERCE_TRANSFORM_VERSION,
    createTransactionContext: async (tx) => {
      let resolver: Promise<(eventId: string) => Promise<any>> | null = null;
      const catalogResolver = createConfirmedCatalogResolver(tx, options.companyId, options.pointId);
      return { resolveOccurrence: async (eventId: string) => {
        resolver ??= measureStage(options, 'occurrenceConfirmation', () => createScopedOccurrenceResolver(tx, options.companyId, options.pointId));
        return (await resolver)(eventId);
      }, resolveCatalog: (sourceType: string, sourceId: string) => measureStage(options, 'catalogConfirmation', () => catalogResolver(sourceType, sourceId)) };
    },
    buildItems: async (tx, pdvSourceKey, transactionContext) => {
      const snapshot = await measureStage(options, 'sourceSnapshot', () => readPdvCommerceSourceSnapshot(tx, options.companyId));
      const eventIds = new Set<string>();
      for (const command of snapshot.commands) if (command.eventoId) eventIds.add(command.eventoId);
      for (const order of snapshot.portalOrders) if (order.eventoId) eventIds.add(order.eventoId);
      const confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }> = {};
      for (const eventId of eventIds) {
        const row = await transactionContext.resolveOccurrence(eventId);
        confirmedOccurrences[eventId] = { id: row.id, companyId: row.cervejariaId, pointId: row.pontoVendaId };
      }
      if (snapshot.coverage.tenantConflictCommandIds.length || snapshot.coverage.tenantConflictItemIds.length || snapshot.coverage.tenantConflictOrderIds.length || snapshot.coverage.tenantConflictInventoryIds.length) throw new PdvCatalogBlocker('COMMERCE_SOURCE_TENANT_CONFLICT', null, null, 'A fotografia contém referências de tenant incompatíveis.');
      const items = buildPdvCommerceMigrationItems({ companyId: options.companyId, pointId: options.pointId, confirmedPdvSourceKey: pdvSourceKey, snapshot, confirmedOccurrences });
      await reconstituteConfirmedCommerceCommandSources(tx, options.companyId, options.pointId, options.runId, items);
      return items;
    },
    confirmExternalDependency: async (tx, sourceType, sourceId, transactionContext) => {
      if (sourceType === 'EVENTO') { await transactionContext.resolveOccurrence(sourceId); return true; }
      if (sourceType === 'CATALOGO_PRODUTO') { await transactionContext.resolveCatalog(sourceType, sourceId); return true; }
      return false;
    },
    writeItem: writeCommerceTarget,
    validateScope: async (tx, items, transactionContext) => {
      const dependency = await canonicalDependency(tx, options.companyId, options.pointId);
      return reconcilePdvCommerce(tx, options.companyId, options.pointId, dependency.sourceKey, options.runId, items, transactionContext);
    },
  });
}
