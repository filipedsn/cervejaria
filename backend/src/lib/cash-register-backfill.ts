export interface CashRegisterBackfillUnit {
  id: string;
  usaCaixa: boolean | null;
  legacyQuiosqueActive: boolean;
}

export interface CashRegisterBackfillPlan {
  updateIds: string[];
  processed: number;
  alreadyExplicitTrue: number;
  alreadyExplicitFalse: number;
  skipped: number;
  fallbackRequired: number;
}

/** Pure, idempotent selection rule for materializing legacy unit capability. */
export function planCashRegisterBackfill(units: CashRegisterBackfillUnit[]): CashRegisterBackfillPlan {
  const plan: CashRegisterBackfillPlan = { updateIds: [], processed: units.length, alreadyExplicitTrue: 0, alreadyExplicitFalse: 0, skipped: 0, fallbackRequired: 0 };
  for (const unit of units) {
    if (unit.usaCaixa === true) plan.alreadyExplicitTrue += 1;
    else if (unit.usaCaixa === false) plan.alreadyExplicitFalse += 1;
    else if (unit.legacyQuiosqueActive) { plan.updateIds.push(unit.id); plan.fallbackRequired += 1; }
    else plan.skipped += 1;
  }
  return plan;
}
