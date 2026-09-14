export interface OperationalEnablementBackfillTenant {
  id: string;
  directSalesEnabled: boolean | null;
  plannedOperationsEnabled: boolean | null;
  tapsEnabled: boolean | null;
  inventoryEnabled: boolean | null;
  kitchenEnabled: boolean | null;
  legacyDirectSales: boolean;
  legacyPlannedOperations: boolean;
  legacyTaps: boolean;
  legacyInventory: boolean;
  legacyKitchen: boolean;
}

export interface OperationalEnablementBackfillPlan {
  processed: number;
  updates: Array<{
    id: string;
    directSalesEnabled?: boolean;
    plannedOperationsEnabled?: boolean;
    tapsEnabled?: boolean;
    inventoryEnabled?: boolean;
    kitchenEnabled?: boolean;
  }>;
}

/** Selects only NULL values, so explicit enablement is never overwritten. */
export function planOperationalEnablementBackfill(tenants: OperationalEnablementBackfillTenant[]): OperationalEnablementBackfillPlan {
  const updates = tenants.flatMap((tenant) => {
    const update = {
      id: tenant.id,
      ...(tenant.directSalesEnabled === null ? { directSalesEnabled: tenant.legacyDirectSales } : {}),
      ...(tenant.plannedOperationsEnabled === null ? { plannedOperationsEnabled: tenant.legacyPlannedOperations } : {}),
      ...(tenant.tapsEnabled === null ? { tapsEnabled: tenant.legacyTaps } : {}),
      ...(tenant.inventoryEnabled === null ? { inventoryEnabled: tenant.legacyInventory } : {}),
      ...(tenant.kitchenEnabled === null ? { kitchenEnabled: tenant.legacyKitchen } : {}),
    };
    return Object.keys(update).length > 1 ? [update] : [];
  });
  return { processed: tenants.length, updates };
}
