import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPhone } from '../src/lib/phone';

describe('formatPhone', () => {
  it('formata celular nacional com o nono dígito separado', () => {
    assert.equal(formatPhone('27981283526'), '(27) 9 8128-3526');
  });

  it('remove prefixo 55 colado antes de aplicar a máscara', () => {
    assert.equal(formatPhone('+55 (27) 98128-3526'), '(27) 9 8128-3526');
  });

  it('preserva DDD 55 em telefone nacional sem prefixo internacional', () => {
    assert.equal(formatPhone('(55) 98128-3526'), '(55) 9 8128-3526');
  });

  it('formata telefone fixo sem dígito móvel separado', () => {
    assert.equal(formatPhone('2731234567'), '(27) 3123-4567');
  });
});
