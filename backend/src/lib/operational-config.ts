import { z } from 'zod';
import { prisma } from './prisma.js';
import { STATUS_CANCELAMENTO_PENDENTE, STATUS_NA_FILA } from './operacao/cozinha.js';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './operacao/capacidades.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { diaOperacional } from './operacao/venda.js';
import type { Prisma } from '@prisma/client';
import {
  CanonicalPdvConfigurationError,
  readCanonicalPdvOperationalSettingsIfEnabled,
  type CanonicalPdvOperationalSettings,
} from './canonical-pdv-operational-config.js';
import { recalcComandaTotalInTx } from './comanda-service.js';
import { recalcComandaTotalOperacao } from './operacao/comanda-adapter.js';

export const updateOperationalConfigSchema = z
  .object({
    /** CAIXA is false and EVENTO is true in the persisted compatibility field. */
    operationMode: z.enum(['CAIXA', 'EVENTO']).optional(),
    plannedOperationsEnabled: z.boolean().optional(),
    tapsEnabled: z.boolean().optional(),
    inventoryEnabled: z.boolean().optional(),
    kitchenEnabled: z.boolean().optional(),
    kitchenItemsChargeAtLaunch: z.boolean().optional(),
    allowCloseComandaWithPendingKitchenOrders: z.boolean().optional(),
    whatsappPedidoProntoEnabled: z.boolean().optional(),
    whatsappPedidoProntoNaCozinha: z.boolean().optional(),
    quantidadeMesas: z.number().int().min(0).max(500).optional(),
    completeInitialSetup: z.boolean().optional(),
    confirmacaoEstoque: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.operationMode !== undefined ||
      body.plannedOperationsEnabled !== undefined ||
      body.tapsEnabled !== undefined ||
      body.inventoryEnabled !== undefined ||
      body.kitchenEnabled !== undefined ||
      body.kitchenItemsChargeAtLaunch !== undefined ||
      body.allowCloseComandaWithPendingKitchenOrders !== undefined ||
      body.whatsappPedidoProntoEnabled !== undefined ||
      body.whatsappPedidoProntoNaCozinha !== undefined ||
      body.quantidadeMesas !== undefined ||
      body.completeInitialSetup === true,
    'Informe ao menos uma capacidade para alterar',
  )
  .refine(
    (body) => body.completeInitialSetup !== true || (
      body.tapsEnabled !== undefined &&
      body.inventoryEnabled !== undefined &&
      body.kitchenEnabled !== undefined
    ),
    'A configuração inicial precisa informar modo e recursos',
  )
  .refine(
    (body) => body.operationMode === undefined || body.plannedOperationsEnabled === undefined ||
      (body.operationMode === 'EVENTO') === body.plannedOperationsEnabled,
    'Informe um único modo operacional coerente',
  );

type OperationalConfigClient = Pick<Prisma.TransactionClient,
  | 'configuracaoOperacional'
  | 'configuracaoPontoVenda'
  | 'pontoVenda'
  | 'pedidoOperacao'
  | 'transacaoLog'
  | 'comanda'
  | 'sessaoCaixaOperacao'
  | 'evento'
>;
export type UpdateOperationalConfigInput = z.infer<typeof updateOperationalConfigSchema>;
export type OperationalConfigActor = { userId: string; role: 'DONO' | 'ADMIN' };

export class CanonicalPdvModeChangeUnsupportedError extends CanonicalPdvConfigurationError {
  constructor() {
    super('CANONICAL_PDV_MODE_CHANGE_UNSUPPORTED', 'A operação canônica usa sempre o fluxo Por Caixa; EVENTO permanece como contexto de agenda.');
    this.name = 'CanonicalPdvModeChangeUnsupportedError';
  }
}

export class OperationalTableCountRequiresCanonicalPdvError extends Error {
  statusCode = 400;

  constructor() {
    super('A quantidade de mesas deve ser atualizada pelo endpoint de configuração do Operacao.');
    this.name = 'OperationalTableCountRequiresCanonicalPdvError';
  }
}

export class OperationalModeTransitionBlockedError extends Error {
  statusCode = 409;
  readonly reason: 'OPEN_CASH_REGISTER' | 'ACTIVE_EVENT';

  constructor(reason: 'OPEN_CASH_REGISTER' | 'ACTIVE_EVENT') {
    super(
      reason === 'OPEN_CASH_REGISTER'
        ? 'Feche o caixa antes de mudar para Opera\u00e7\u00f5es / Eventos.'
        : 'Encerre a opera\u00e7\u00e3o ativa antes de mudar para Por caixa.',
    );
    this.name = 'OperationalModeTransitionBlockedError';
    this.reason = reason;
  }
}

export class PendingKitchenCloseDependencyError extends Error {
  statusCode = 400;

  constructor() {
    super('Ative "Pedidos pendentes na cozinha compõem o valor da comanda" antes de permitir fechar comandas com pedidos pendentes.');
    this.name = 'PendingKitchenCloseDependencyError';
  }
}

export class OperationalSetupModeRequiredError extends Error {
  statusCode = 400;

  constructor() {
    super('A configuração inicial LEGACY precisa informar o modo de operação.');
    this.name = 'OperationalSetupModeRequiredError';
  }
}

/** Reads the effective settings; legacy operation parameters are not read in canonical mode. */
export async function readOperationalConfig(cervejariaId: string, db: OperationalConfigClient = prisma) {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId, db);
  if (!canonical) return db.configuracaoOperacional.findUnique({ where: { cervejariaId } });

  // Setup completion is company onboarding metadata, not an operational parameter.
  const setup = await db.configuracaoOperacional.findUnique({
    where: { cervejariaId },
    select: { setupCompletedAt: true },
  });
  return canonicalConfigurationView(canonical, cervejariaId, setup?.setupCompletedAt ?? null);
}

function canonicalConfigurationView(canonical: CanonicalPdvOperationalSettings, cervejariaId: string, setupCompletedAt: Date | null) {
  return {
    cervejariaId,
    setupCompletedAt,
    directSalesEnabled: true,
    plannedOperationsEnabled: false,
    tapsEnabled: canonical.tapsEnabled,
    inventoryEnabled: canonical.inventoryEnabled,
    kitchenEnabled: canonical.kitchenEnabled,
    kitchenItemsChargeAtLaunch: canonical.kitchenItemsChargeAtLaunch,
    allowCloseComandaWithPendingKitchenOrders: canonical.allowCloseComandaWithPendingKitchenOrders,
    whatsappPedidoProntoEnabled: canonical.whatsappPedidoProntoEnabled,
    whatsappPedidoProntoNaCozinha: canonical.whatsappPedidoProntoNaCozinha,
    quantidadeMesas: canonical.quantidadeMesas ?? 0,
    configurationSource: canonical.source,
    pontoVendaId: canonical.pointId,
  };
}

async function recalculateOpenComandasAfterKitchenPricingChange(db: OperationalConfigClient, cervejariaId: string) {
  const openComandas = await db.comanda.findMany({
    where: {
      status: 'ABERTA',
      OR: [
        { evento: { cervejariaId } },
        { origem: 'CAIXA', pontoVenda: { cervejariaId } },
      ],
    },
    select: { id: true, origem: true },
  });
  for (const comanda of openComandas) {
    if (comanda.origem === 'CAIXA') await recalcComandaTotalOperacao(db as Prisma.TransactionClient, comanda.id);
    else await recalcComandaTotalInTx(db as Prisma.TransactionClient, comanda.id);
  }
}

/** Persists requested enablements only; it never provisions or deletes resources. */
export async function updateOperationalConfig(
  db: OperationalConfigClient,
  cervejariaId: string,
  input: UpdateOperationalConfigInput,
  actor?: OperationalConfigActor,
) {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId, db);
  if (canonical) return updateCanonicalOperationalConfig(db, cervejariaId, input, canonical, actor);
  if (input.completeInitialSetup === true && input.operationMode === undefined) {
    throw new OperationalSetupModeRequiredError();
  }
  if (input.quantidadeMesas !== undefined) throw new OperationalTableCountRequiresCanonicalPdvError();

  const operationMode = input.operationMode ?? (
    input.plannedOperationsEnabled === undefined
      ? undefined
      : input.plannedOperationsEnabled ? 'EVENTO' : 'CAIXA'
  );
  const current = await db.configuracaoOperacional.findUnique({ where: { cervejariaId } });
  const kitchenItemsChargeAtLaunch = input.kitchenItemsChargeAtLaunch ?? current?.kitchenItemsChargeAtLaunch ?? false;
  const clearPendingClosePermission = input.kitchenItemsChargeAtLaunch === false || (
    input.kitchenItemsChargeAtLaunch === true &&
    current?.kitchenItemsChargeAtLaunch !== true &&
    current?.allowCloseComandaWithPendingKitchenOrders === true
  );
  if (input.allowCloseComandaWithPendingKitchenOrders === true && !kitchenItemsChargeAtLaunch) {
    throw new PendingKitchenCloseDependencyError();
  }
  const currentMode = current?.plannedOperationsEnabled === true ? 'EVENTO' : 'CAIXA';
  const modeChanged = operationMode !== undefined && operationMode !== currentMode;

  // Serialize mode changes with caixa/evento open/close transactions when the
  // real Prisma transaction client is available. This closes the basic race
  // between a mode switch and an opening/activation request.
  if (modeChanged && '$executeRaw' in db && typeof db.$executeRaw === 'function') {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cervejariaId}, 0))`;
  }

  if (modeChanged && operationMode === 'EVENTO' && db.sessaoCaixaOperacao?.findFirst) {
    const openCash = await db.sessaoCaixaOperacao.findFirst({
      where: { cervejariaId, status: 'ABERTO' },
      select: { id: true },
    });
    if (openCash) {
      const blocked = new OperationalModeTransitionBlockedError('OPEN_CASH_REGISTER');
      emitAuditEvent({
        action: 'operational_mode_change_blocked',
        message: blocked.message,
        outcome: 'failure',
        entityType: 'ConfiguracaoOperacional',
        entityId: cervejariaId,
        metadata: { tenantId: cervejariaId, currentMode, requestedMode: operationMode, reason: blocked.reason },
      });
      throw blocked;
    }
  }

  if (modeChanged && operationMode === 'CAIXA' && db.evento?.findFirst) {
    const activeEvent = await db.evento.findFirst({
      where: { cervejariaId, status: 'ABERTO' },
      select: { id: true },
    });
    if (activeEvent) {
      const blocked = new OperationalModeTransitionBlockedError('ACTIVE_EVENT');
      emitAuditEvent({
        action: 'operational_mode_change_blocked',
        message: blocked.message,
        outcome: 'failure',
        entityType: 'ConfiguracaoOperacional',
        entityId: cervejariaId,
        metadata: { tenantId: cervejariaId, currentMode, requestedMode: operationMode, reason: blocked.reason },
      });
      throw blocked;
    }
  }

  // A new tenant has no persisted choice yet; treat that unset value as the
  // default disabled state so saving the default does not trigger a warning.
  const inventoryChanges = input.inventoryEnabled !== undefined && input.inventoryEnabled !== (current?.inventoryEnabled ?? false);
  const kitchenTurnsOff = input.kitchenEnabled === false && current?.kitchenEnabled !== false;

  if (inventoryChanges && input.confirmacaoEstoque !== true) {
    throw new ConfirmacaoEstoqueObrigatoriaError();
  }

  if (kitchenTurnsOff) {
    const activeOrder = await db.pedidoOperacao.findFirst({
      where: {
        cervejariaId,
        status: { in: [...STATUS_NA_FILA, STATUS_CANCELAMENTO_PENDENTE] },
        itensComanda: { some: { exigePreparo: true } },
      },
      select: { id: true },
    });
    if (activeOrder) throw new CozinhaComPedidosAtivosError();
  }

  const data = {
    ...(operationMode !== undefined
      ? {
          plannedOperationsEnabled: operationMode === 'EVENTO',
        }
      : {}),
    ...(input.tapsEnabled !== undefined ? { tapsEnabled: input.tapsEnabled } : {}),
    ...(input.inventoryEnabled !== undefined ? { inventoryEnabled: input.inventoryEnabled } : {}),
    ...(input.kitchenEnabled !== undefined ? { kitchenEnabled: input.kitchenEnabled } : {}),
    ...(input.kitchenItemsChargeAtLaunch !== undefined ? { kitchenItemsChargeAtLaunch: input.kitchenItemsChargeAtLaunch } : {}),
    ...(input.allowCloseComandaWithPendingKitchenOrders !== undefined
      ? { allowCloseComandaWithPendingKitchenOrders: input.allowCloseComandaWithPendingKitchenOrders }
      : {}),
    ...(clearPendingClosePermission
      ? { allowCloseComandaWithPendingKitchenOrders: false }
      : {}),
    ...(input.whatsappPedidoProntoEnabled !== undefined
      ? { whatsappPedidoProntoEnabled: input.whatsappPedidoProntoEnabled }
      : {}),
    ...(input.whatsappPedidoProntoNaCozinha !== undefined
      ? { whatsappPedidoProntoNaCozinha: input.whatsappPedidoProntoNaCozinha }
      : {}),
    ...(input.completeInitialSetup === true ? { setupCompletedAt: new Date() } : {}),
  };

  const updated = await db.configuracaoOperacional.upsert({
    where: { cervejariaId },
    create: { cervejariaId, ...data },
    update: data,
  });
  if (
    input.kitchenItemsChargeAtLaunch !== undefined &&
    input.kitchenItemsChargeAtLaunch !== (current?.kitchenItemsChargeAtLaunch ?? false)
  ) {
    await recalculateOpenComandasAfterKitchenPricingChange(db, cervejariaId);
  }
  return updated;
}

async function updateCanonicalOperationalConfig(
  db: OperationalConfigClient,
  cervejariaId: string,
  input: UpdateOperationalConfigInput,
  current: CanonicalPdvOperationalSettings,
  actor?: OperationalConfigActor,
) {
  const requestedMode = input.operationMode ?? (
    input.plannedOperationsEnabled === undefined
      ? undefined
      : input.plannedOperationsEnabled ? 'EVENTO' : 'CAIXA'
  );
  if (requestedMode === 'EVENTO') throw new CanonicalPdvModeChangeUnsupportedError();

  const effectiveKitchenCharge = input.kitchenItemsChargeAtLaunch ?? current.kitchenItemsChargeAtLaunch;
  const clearPendingClosePermission = input.kitchenItemsChargeAtLaunch === false || (
    input.kitchenItemsChargeAtLaunch === true &&
    current.kitchenItemsChargeAtLaunch !== true &&
    current.allowCloseComandaWithPendingKitchenOrders === true
  );
  if (input.allowCloseComandaWithPendingKitchenOrders === true && !effectiveKitchenCharge) {
    throw new PendingKitchenCloseDependencyError();
  }

  const inventoryChanges = input.inventoryEnabled !== undefined && input.inventoryEnabled !== current.inventoryEnabled;
  if (inventoryChanges && input.confirmacaoEstoque !== true) throw new ConfirmacaoEstoqueObrigatoriaError();

  const kitchenTurnsOff = input.kitchenEnabled === false && current.kitchenEnabled !== false;
  if (kitchenTurnsOff) {
    const activeOrder = await db.pedidoOperacao.findFirst({
      where: {
        cervejariaId,
        status: { in: [...STATUS_NA_FILA, STATUS_CANCELAMENTO_PENDENTE] },
        itensComanda: { some: { exigePreparo: true } },
      },
      select: { id: true },
    });
    if (activeOrder) throw new CozinhaComPedidosAtivosError();
  }

  const patch: Prisma.ConfiguracaoPontoVendaUpdateInput = {
    ...(input.tapsEnabled !== undefined ? { tapsEnabled: input.tapsEnabled } : {}),
    ...(input.inventoryEnabled !== undefined ? { inventoryEnabled: input.inventoryEnabled } : {}),
    ...(input.kitchenEnabled !== undefined ? { kitchenEnabled: input.kitchenEnabled } : {}),
    ...(input.kitchenItemsChargeAtLaunch !== undefined ? { kitchenItemsChargeAtLaunch: input.kitchenItemsChargeAtLaunch } : {}),
    ...(input.allowCloseComandaWithPendingKitchenOrders !== undefined
      ? { allowCloseComandaWithPendingKitchenOrders: input.allowCloseComandaWithPendingKitchenOrders }
      : {}),
    ...(clearPendingClosePermission ? { allowCloseComandaWithPendingKitchenOrders: false } : {}),
    ...(input.whatsappPedidoProntoEnabled !== undefined
      ? { whatsappPedidoProntoEnabled: input.whatsappPedidoProntoEnabled }
      : {}),
    ...(input.whatsappPedidoProntoNaCozinha !== undefined
      ? { whatsappPedidoProntoNaCozinha: input.whatsappPedidoProntoNaCozinha }
      : {}),
    ...(input.quantidadeMesas !== undefined ? { quantidadeMesas: input.quantidadeMesas } : {}),
  };
  const fieldNames = Object.keys(patch) as Array<keyof typeof patch>;
  const changes = fieldNames.flatMap((field) => {
    const next = patch[field];
    const previous = current[field as keyof CanonicalPdvOperationalSettings];
    return next !== previous ? [{ field: String(field), previous, next }] : [];
  });

  const updated = changes.length > 0
    ? await db.configuracaoPontoVenda.update({ where: { pontoVendaId: current.pointId }, data: patch })
    : null;

  // Keep onboarding metadata on its existing company setup record. No legacy
  // operational parameter is read or written in this branch.
  let setupCompletedAt: Date | null = null;
  if (input.completeInitialSetup === true) {
    const setup = await db.configuracaoOperacional.update({
      where: { cervejariaId },
      data: { setupCompletedAt: new Date() },
      select: { setupCompletedAt: true },
    });
    setupCompletedAt = setup.setupCompletedAt;
  } else {
    const setup = await db.configuracaoOperacional.findUnique({
      where: { cervejariaId },
      select: { setupCompletedAt: true },
    });
    setupCompletedAt = setup?.setupCompletedAt ?? null;
  }

  if (changes.length > 0) {
    await db.transacaoLog.create({
      data: {
        cervejariaId,
        tipo: 'CAPABILITY_CHANGED',
        usuarioId: actor?.userId ?? null,
        entidadeTipo: 'ConfiguracaoPontoVenda',
        entidadeId: current.pointId,
        metadata: {
          operacao: 'CANONICAL_PDV_SETTINGS_CHANGED',
          tenantId: cervejariaId,
          pontoVendaId: current.pointId,
          origem: actor?.role ?? 'SYSTEM',
          alteracoes: changes.map(({ field, previous, next }) => ({ campo: field, anterior: previous ?? null, novo: next ?? null })),
        } as Prisma.InputJsonValue,
      },
    });
  }

  if (
    input.kitchenItemsChargeAtLaunch !== undefined &&
    input.kitchenItemsChargeAtLaunch !== current.kitchenItemsChargeAtLaunch
  ) {
    await recalculateOpenComandasAfterKitchenPricingChange(db, cervejariaId);
  }

  const effective = {
    ...current,
    ...(updated ?? {}),
    source: 'CANONICAL_PDV' as const,
    pointId: current.pointId,
  };
  return canonicalConfigurationView(effective, cervejariaId, setupCompletedAt);
}
