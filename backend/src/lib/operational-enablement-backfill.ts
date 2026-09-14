export interface OperationalEnablementBackfillTenant {
  id: string;
  directSalesEnabled: boolean | null;
  plannedOperationsEnabled: boolean | null;
  tapsEnabled: boolean | null;
  legacyDirectSales: boolean;
  legacyPlannedOperations: boolean;
  legacyTaps: boolean;
}

export interface OperationalEnablementBackfillPlan {
  processed: number;
  updates: Array<{ id: string; directSalesEnabled?: boolean; plannedOperationsEnabled?: boolean; tapsEnabled?: boolean }>;
}

/** Selects only NULL values, so explicit enablement is never overwritten. */
export function planOperationalEnablementBackfill(tenants: OperationalEnablementBackfillTenant[]): OperationalEnablementBackfillPlan {
  const updates = tenants.flatMap((tenant) => {
    const update = {
      id: tenant.id,
      ...(tenant.directSalesEnabled === null ? { directSalesEnabled: tenant.legacyDirectSales } : {}),
      ...(tenant.plannedOperationsEnabled === null ? { plannedOperationsEnabled: tenant.legacyPlannedOperations } : {}),
      ...(tenant.tapsEnabled === null ? { tapsEnabled: tenant.legacyTaps } : {}),
    };
    return Object.keys(update).length > 1 ? [update] : [];
  });
  return { processed: tenants.length, updates };
}
