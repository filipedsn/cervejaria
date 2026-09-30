import { z } from 'zod';
import { prisma } from './prisma.js';
import { STATUS_CANCELAMENTO_PENDENTE, STATUS_NA_FILA } from './operacao/cozinha.js';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './operacao/capacidades.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { diaOperacional } from './operacao/venda.js';

export const updateOperationalConfigSchema = z
  .object({
    /** CAIXA is false and EVENTO is true in the persisted compatibility field. */
    operationMode: z.enum(['CAIXA', 'EVENTO']).optional(),
    plannedOperationsEnabled: z.boolean().optional(),
    tapsEnabled: z.boolean().optional(),
    inventoryEnabled: z.boolean().optional(),
    kitchenEnabled: z.boolean().optional(),
    kitchenItemsChargeAtLaunch: z.boolean().optional(),
    whatsappPedidoProntoEnabled: z.boolean().optional(),
    whatsappPedidoProntoNaCozinha: z.boolean().optional(),
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
      body.whatsappPedidoProntoEnabled !== undefined ||
      body.whatsappPedidoProntoNaCozinha !== undefined ||
      body.completeInitialSetup === true,
    'Informe ao menos uma capacidade para alterar',
  )
  .refine(
    (body) => body.completeInitialSetup !== true || (
      body.operationMode !== undefined &&
      body.tapsEnabled !== undefined &&
      body.inventoryEnabled !== undefined &&
      body.kitchenEnabled !== undefined
    ),
    'A configuração inicial precisa informar modo e recursos',
  );

type OperationalConfigClient = Pick<typeof prisma, 'configuracaoOperacional' | 'pedidoOperacao'> &
  Partial<Pick<typeof prisma, 'sessaoCaixaOperacao' | 'evento'>>;
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
  const operationMode = input.operationMode ?? (
    input.plannedOperationsEnabled === undefined
      ? undefined
      : input.plannedOperationsEnabled ? 'EVENTO' : 'CAIXA'
  );
  const current = await db.configuracaoOperacional.findUnique({ where: { cervejariaId } });
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
      where: { cervejariaId, status: 'ABERTO', diaOperacional: diaOperacional() },
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
    ...(input.whatsappPedidoProntoEnabled !== undefined
      ? { whatsappPedidoProntoEnabled: input.whatsappPedidoProntoEnabled }
      : {}),
    ...(input.whatsappPedidoProntoNaCozinha !== undefined
      ? { whatsappPedidoProntoNaCozinha: input.whatsappPedidoProntoNaCozinha }
      : {}),
    ...(input.completeInitialSetup === true ? { setupCompletedAt: new Date() } : {}),
  };

  return db.configuracaoOperacional.upsert({
    where: { cervejariaId },
    create: { cervejariaId, ...data },
    update: data,
  });
}
