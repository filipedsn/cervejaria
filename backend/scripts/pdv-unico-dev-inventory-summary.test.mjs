import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeStockImpact } from './pdv-unico-dev-inventory-summary.mjs';

test('stock impact does not add quantities across products, units, PDVs or movement types', () => {
  const summary = summarizeStockImpact([
    { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', milliUnits: '1250' },
    { pointOfSaleId: 'pdv-a', productId: 'glass', unit: 'UNIDADE', milliUnits: '3000' },
    { pointOfSaleId: 'pdv-b', productId: 'beer', unit: 'LITRO', milliUnits: '500' },
  ], [
    { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', type: 'ENTRADA', milliUnits: '2000' },
    { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', type: 'PERDA', milliUnits: '250' },
    { pointOfSaleId: 'pdv-a', productId: 'glass', unit: 'UNIDADE', type: 'ENTRADA', milliUnits: '4000' },
  ]);

  assert.deepEqual(summary, {
    balanceRows: 3,
    balances: [
      { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', rows: 1, milliUnits: '1250' },
      { pointOfSaleId: 'pdv-a', productId: 'glass', unit: 'UNIDADE', rows: 1, milliUnits: '3000' },
      { pointOfSaleId: 'pdv-b', productId: 'beer', unit: 'LITRO', rows: 1, milliUnits: '500' },
    ],
    movementRows: 3,
    movementsByPointProductUnitAndType: [
      { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', type: 'ENTRADA', rows: 1, milliUnits: '2000' },
      { pointOfSaleId: 'pdv-a', productId: 'beer', unit: 'LITRO', type: 'PERDA', rows: 1, milliUnits: '250' },
      { pointOfSaleId: 'pdv-a', productId: 'glass', unit: 'UNIDADE', type: 'ENTRADA', rows: 1, milliUnits: '4000' },
    ],
  });
});
