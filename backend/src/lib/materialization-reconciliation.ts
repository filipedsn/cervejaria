export interface MaterializationCounts {
  establishmentsTotal: number;
  operationalConfigTotal: number;
  operationalModeMaterialized: number;
  operationalModeUnmaterialized: number;
  activePdvTotal: number;
  pdvCashCapabilityExplicit: number;
  pdvCashFallbackRequired: number;
}

export interface MaterializationReconciliation extends MaterializationCounts {
  pass: boolean;
  blockers: string[];
}

export function reconcileMaterialization(counts: MaterializationCounts): MaterializationReconciliation {
  const blockers: string[] = [];
  if (counts.operationalModeUnmaterialized > 0) blockers.push('operational_mode_unmaterialized');
  if (counts.pdvCashFallbackRequired > 0) blockers.push('pdv_cash_fallback_required');
  return { ...counts, pass: blockers.length === 0, blockers };
}
