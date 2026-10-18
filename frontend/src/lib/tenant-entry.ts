export const OPERACAO_NO_ACCESS_PATH = '/operacao/sem-acesso';

export type OperacaoEntryAccess = {
  can: (permission: string) => boolean;
  kitchenEnabled: boolean;
  inventoryEnabled: boolean;
};

/** First operational screen the user can actually use, in the order of daily work. */
export function getOperacaoEntryPath({ can, kitchenEnabled, inventoryEnabled }: OperacaoEntryAccess): string {
  if (can('command.read')) return '/operacao/comandas';
  if (kitchenEnabled && can('kitchen.read')) return '/operacao/cozinha';
  if (can('cash.open') || can('cash.values.read')) return '/operacao/caixa';
  if (inventoryEnabled && can('inventory.read')) return '/operacao/estoque';
  return OPERACAO_NO_ACCESS_PATH;
}

export function getTenantCashEntryPath(
  operationMode: 'CAIXA' | 'EVENTO' | null,
  activePointOfSaleCount: number,
  access: OperacaoEntryAccess,
): string | null {
  if (operationMode !== 'CAIXA') return null;
  return activePointOfSaleCount > 0 ? getOperacaoEntryPath(access) : '/operacao/caixa';
}
