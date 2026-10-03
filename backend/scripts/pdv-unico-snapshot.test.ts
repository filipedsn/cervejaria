import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCommandSnapshot } from './pdv-unico-snapshot.js';

test('serializa saída com IDs, valores e estados exatos sem vazar PII', () => {
  const createdAt = new Date('2026-09-03T13:14:15.123Z');
  const cancelledAt = new Date('2026-09-03T13:18:15.123Z');
  const snapshot = serializeCommandSnapshot({
    id: 'cmd-synthetic', origem: 'CAIXA', status: 'FECHADA', tipo: 'COMANDA', numero: 17,
    eventoId: null, clienteId: 'client-synthetic', pontoVendaId: 'pdv-synthetic',
    abertaPorId: 'user-opened', fechadoPorId: 'user-closed', fechadaEm: cancelledAt,
    diaOperacional: null, eventoData: null, createdAt, updatedAt: cancelledAt,
    total: '12.34', desconto: '0.50',
    itens: [{
      id: 'item-synthetic', produtoId: 'product-synthetic', tapId: 'tap-synthetic',
      volumeMl: 400, quantidade: 2, precoUnit: '6.17', exigePreparo: true, paraViagem: true,
      cancelamentoPendenteEm: createdAt, canceladoEm: cancelledAt,
      pedidoCozinhaId: 'order-synthetic', createdAt,
      opcionais: [{ id: 'optional-synthetic', opcionalId: 'option-synthetic', opcionalCatalogoId: 'catalog-optional-synthetic', precoAdicional: '0.12', quantidade: 3 }],
    }],
  });
  assert.equal(snapshot.id, 'cmd-synthetic');
  assert.equal(snapshot.pointOfSaleId, 'pdv-synthetic');
  assert.equal(snapshot.operationDayEvidence, 'UTC_FALLBACK_UNVERIFIED');
  assert.equal(snapshot.operationDayTimezone, 'UTC_FALLBACK_ONLY');
  assert.equal(snapshot.totalCents, '1234');
  assert.equal(snapshot.discountCents, '50');
  assert.deepEqual(snapshot.items[0], {
    id: 'item-synthetic', productId: 'product-synthetic', tapId: 'tap-synthetic', volumeMl: 400,
    quantity: 2, unitPriceCents: '617', kitchenRequired: true, takeAway: true,
    cancelPendingAt: createdAt.toISOString(), cancelledAt: cancelledAt.toISOString(),
    kitchenOrderId: 'order-synthetic', createdAt: createdAt.toISOString(),
    optionals: [{ id: 'optional-synthetic', productOptionId: 'option-synthetic', catalogOptionalId: 'catalog-optional-synthetic', centsEach: '12', quantity: 3 }],
  });
  const output = JSON.stringify(snapshot);
  assert.equal(output.includes('nome'), false);
  assert.equal(output.includes('observacao'), false);
  assert.equal(output.includes('telefone'), false);
});
