export function getTenantCashEntryPath(
  operationMode: 'CAIXA' | 'EVENTO' | null,
  activePointOfSaleCount: number,
): string | null {
  if (operationMode !== 'CAIXA') return null;
  return activePointOfSaleCount > 0 ? '/operacao/comandas' : '/operacao/caixa';
}
