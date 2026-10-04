function groupKey(...parts) { return JSON.stringify(parts); }

/** Keep stock quantities separate by physical destination, product, unit and movement type. */
export function summarizeStockImpact(balances, movements) {
  const balanceGroups = new Map();
  for (const row of balances) {
    const key = groupKey(row.pointOfSaleId, row.productId, row.unit);
    const group = balanceGroups.get(key) ?? { pointOfSaleId: row.pointOfSaleId, productId: row.productId, unit: row.unit, rows: 0, milliUnits: 0n };
    group.rows++;
    group.milliUnits += BigInt(row.milliUnits);
    balanceGroups.set(key, group);
  }

  const movementGroups = new Map();
  for (const row of movements) {
    const key = groupKey(row.pointOfSaleId, row.productId, row.unit, row.type);
    const group = movementGroups.get(key) ?? { pointOfSaleId: row.pointOfSaleId, productId: row.productId, unit: row.unit, type: row.type, rows: 0, milliUnits: 0n };
    group.rows++;
    group.milliUnits += BigInt(row.milliUnits);
    movementGroups.set(key, group);
  }

  const sort = (a, b) => groupKey(a.pointOfSaleId, a.productId, a.unit, a.type ?? '').localeCompare(groupKey(b.pointOfSaleId, b.productId, b.unit, b.type ?? ''));
  return {
    balanceRows: balances.length,
    balances: [...balanceGroups.values()].sort(sort).map((row) => ({ ...row, milliUnits: row.milliUnits.toString() })),
    movementRows: movements.length,
    movementsByPointProductUnitAndType: [...movementGroups.values()].sort(sort).map((row) => ({ ...row, milliUnits: row.milliUnits.toString() })),
  };
}
