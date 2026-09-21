import { z } from 'zod';
import { prisma } from './prisma.js';
import { STATUS_NA_FILA } from './quiosque/cozinha.js';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './quiosque/capacidades.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';

export const updateOperationalConfigSchema = z
  .object({
    /** CAIXA is false and EVENTO is true in the persisted compatibility field. */
    operationMode: z.enum(['CAIXA', 'EVENTO']).optional(),
    directSalesEnabled: z.boolean().optional(),
    plannedOperationsEnabled: z.boolean().optional(),
    tapsEnabled: z.boolean().optional(),
    inventoryEnabled: z.boolean().optional(),
    kitchenEnabled: z.boolean().optional(),
    confirmacaoEstoque: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.operationMode !== undefined ||
      body.directSalesEnabled !== undefined ||
      body.plannedOperationsEnabled !== undefined ||
      body.tapsEnabled !== undefined ||
      body.inventoryEnabled !== undefined ||
      body.kitchenEnabled !== undefined,
    'Informe ao menos uma capacidade para alterar',
  );

type OperationalConfigClient = Pick<typeof prisma, 'configuracaoOperacional' | 'pedidoQuiosque'> &
  Partial<Pick<typeof prisma, 'sessaoCaixaQuiosque' | 'evento'>>;
export type UpdateOperationalConfigInput = z.infer<typeof updateOperationalConfigSchema>;

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

/** Persists requested enablements only; it never provisions or deletes resources. */
export async function updateOperationalConfig(
  db: OperationalConfigClient,
  cervejariaId: string,
  input: UpdateOperationalConfigInput,
) {
  const modeFromLegacyFields = input.plannedOperationsEnabled !== undefined
    ? input.plannedOperationsEnabled
      ? 'EVENTO'
      : 'CAIXA'
    : input.directSalesEnabled !== undefined
      ? input.directSalesEnabled
        ? 'CAIXA'
        : 'EVENTO'
      : undefined;
  const operationMode = input.operationMode ?? modeFromLegacyFields;
  if (
    input.operationMode !== undefined &&
    modeFromLegacyFields !== undefined &&
    input.operationMode !== modeFromLegacyFields
  ) {
    throw new Error('Modo operacional contraditório');
  }
  if (
    input.directSalesEnabled !== undefined &&
    input.plannedOperationsEnabled !== undefined &&
    input.directSalesEnabled === input.plannedOperationsEnabled
  ) {
    throw new Error('CAIXA e EVENTO são modos mutuamente exclusivos');
  }
  const current = await db.configuracaoOperacional.findUnique({ where: { cervejariaId } });
  const currentMode = current?.plannedOperationsEnabled === true ? 'EVENTO' : 'CAIXA';
  const modeChanged = operationMode !== undefined && operationMode !== currentMode;

  // Serialize mode changes with caixa/evento open/close transactions when the
  // real Prisma transaction client is available. This closes the basic race
  // between a mode switch and an opening/activation request.
  if (modeChanged && '$executeRaw' in db && typeof db.$executeRaw === 'function') {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cervejariaId}, 0))`;
  }

  if (modeChanged && operationMode === 'EVENTO' && db.sessaoCaixaQuiosque?.findFirst) {
    const openCash = await db.sessaoCaixaQuiosque.findFirst({
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

  const inventoryChanges = input.inventoryEnabled !== undefined && input.inventoryEnabled !== current?.inventoryEnabled;
  const kitchenTurnsOff = input.kitchenEnabled === false && current?.kitchenEnabled !== false;

  if (inventoryChanges && input.confirmacaoEstoque !== true) {
    throw new ConfirmacaoEstoqueObrigatoriaError();
  }

  if (kitchenTurnsOff) {
    const activeOrder = await db.pedidoQuiosque.findFirst({
      where: { cervejariaId, status: { in: STATUS_NA_FILA }, itensComanda: { some: { exigePreparo: true } } },
      select: { id: true },
    });
    if (activeOrder) throw new CozinhaComPedidosAtivosError();
  }

  const data = {
    ...(operationMode !== undefined
      ? {
          plannedOperationsEnabled: operationMode === 'EVENTO',
          // Kept as a physical compatibility projection until legacy readers are retired.
          directSalesEnabled: operationMode === 'CAIXA',
        }
      : {}),
    ...(input.tapsEnabled !== undefined ? { tapsEnabled: input.tapsEnabled } : {}),
    ...(input.inventoryEnabled !== undefined ? { inventoryEnabled: input.inventoryEnabled } : {}),
    ...(input.kitchenEnabled !== undefined ? { kitchenEnabled: input.kitchenEnabled } : {}),
  };

  return db.configuracaoOperacional.upsert({
    where: { cervejariaId },
    create: { cervejariaId, ...data },
    update: data,
  });
}
