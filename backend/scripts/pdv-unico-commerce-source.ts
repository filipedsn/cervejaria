import type { Prisma } from '@prisma/client';
import { readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';

/** Transaction-owned read of the already shared command/order/inventory graph. */
export async function readPdvCommerceSourceSnapshot(tx: Prisma.TransactionClient, companyId: string) {
  const graph = await readPdvPlanningSourceSnapshot(tx, companyId);
  const unresolvedCommands = await tx.comanda.findMany({
    where: { eventoId: null, pontoVendaId: null },
    select: { id: true, origem: true, status: true },
    orderBy: { id: 'asc' },
  });
  const coverage = {
    commandCount: graph.commands.length,
    itemCount: graph.commands.reduce((n: number, row: any) => n + row.itens.length, 0),
    soldOptionalCount: graph.commands.reduce((n: number, row: any) => n + row.itens.reduce((m: number, item: any) => m + item.opcionais.length, 0), 0),
    kitchenOrderCount: graph.orders.length,
    kitchenItemLinkCount: graph.orders.reduce((n: number, row: any) => n + row.itensComanda.length, 0),
    kitchenStatusHistoryCount: graph.orders.reduce((n: number, row: any) => n + row.historicoStatus.length, 0),
    inventoryBalanceCount: graph.balances.length,
    inventoryMovementCount: graph.stockMovements.length,
    unresolvedCommandCount: unresolvedCommands.length,
    unresolvedCommandIds: unresolvedCommands.map((row: any) => row.id),
    tenantConflictCommandIds: graph.commands.filter((row: any) =>
      (row.eventoId && row.evento?.cervejariaId !== companyId) ||
      (row.pontoVendaId && row.pontoVenda?.cervejariaId !== companyId) ||
      (row.clienteId && row.cliente?.cervejariaId !== companyId)).map((row: any) => row.id),
    tenantConflictItemIds: graph.commands.flatMap((row: any) => row.itens.filter((item: any) =>
      (item.produtoId && item.produto?.cervejariaId !== companyId) || item.opcionais.some((optional: any) =>
        (optional.opcionalId && optional.opcional?.grupo?.produto?.cervejariaId !== companyId) ||
        (optional.opcionalId && optional.opcional?.produtoEstoqueId && optional.opcional.produtoEstoque?.cervejariaId !== companyId) ||
        (optional.opcionalCatalogoId && optional.opcionalCatalogo?.cervejariaId !== companyId))).map((item: any) => item.id)),
    tenantConflictOrderIds: graph.orders.filter((row: any) =>
      (row.comanda?.eventoId && row.comanda.evento?.cervejariaId !== companyId) ||
      (row.comanda?.pontoVendaId && row.comanda.pontoVenda?.cervejariaId !== companyId) ||
      (row.pontoVendaId && row.pontoVenda?.cervejariaId !== companyId)).map((row: any) => row.id),
    tenantConflictInventoryIds: [...graph.balances, ...graph.stockMovements].filter((row: any) =>
      row.pontoVenda?.cervejariaId !== companyId || row.produto?.cervejariaId !== companyId).map((row: any) => row.id),
  };
  return { ...graph, coverage };
}
