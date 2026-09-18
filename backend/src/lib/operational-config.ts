import { z } from 'zod';
import { prisma } from './prisma.js';
import { STATUS_NA_FILA } from './quiosque/cozinha.js';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './quiosque/capacidades.js';

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

type OperationalConfigClient = Pick<typeof prisma, 'configuracaoOperacional' | 'pedidoQuiosque'>;
export type UpdateOperationalConfigInput = z.infer<typeof updateOperationalConfigSchema>;

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
