import { z } from 'zod';
import { prisma } from './prisma.js';
import { STATUS_NA_FILA } from './quiosque/cozinha.js';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './quiosque/capacidades.js';

export const updateOperationalConfigSchema = z
  .object({
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
    ...(input.directSalesEnabled !== undefined ? { directSalesEnabled: input.directSalesEnabled } : {}),
    ...(input.plannedOperationsEnabled !== undefined ? { plannedOperationsEnabled: input.plannedOperationsEnabled } : {}),
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
