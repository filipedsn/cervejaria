import assert from 'node:assert/strict';
import test from 'node:test';
import { isChopeConfiguravelNaTapOperacao } from './produto-utils.js';

test('only explicit draft-beer products can be assigned to an operation tap', () => {
  assert.equal(isChopeConfiguravelNaTapOperacao({ tipo: 'BEBIDA', formato: 'CHOPE', categoria: 'Cervejas' }), true);
  assert.equal(isChopeConfiguravelNaTapOperacao({ tipo: 'BEBIDA', formato: null, categoria: ' Chope ' }), true);
  assert.equal(isChopeConfiguravelNaTapOperacao({ tipo: 'BEBIDA', formato: 'VINHO' as never, categoria: 'Chope' }), false);
  assert.equal(isChopeConfiguravelNaTapOperacao({ tipo: 'BEBIDA', formato: null, categoria: 'Bebidas' }), false);
  assert.equal(isChopeConfiguravelNaTapOperacao({ tipo: 'COMIDA', formato: 'CHOPE', categoria: 'Chope' }), false);
});
