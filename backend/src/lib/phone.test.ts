import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPhoneBr, normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('normaliza telefone nacional com ou sem formataÃ§Ã£o', () => {
    assert.equal(normalizePhone('(27) 98128-3526'), '27981283526');
    assert.equal(normalizePhone('27 3123-4567'), '2731234567');
  });

  it('remove o cÃ³digo do Brasil para manter a identidade do cliente', () => {
    assert.equal(normalizePhone('+55 (27) 98128-3526'), '27981283526');
    assert.equal(normalizePhone('552731234567'), '2731234567');
  });

  it('nÃ£o remove DDD 55 em telefone nacional', () => {
    assert.equal(normalizePhone('(55) 98128-3526'), '55981283526');
  });

  it('formata celular no padrÃ£o nacional com o primeiro dÃ­gito separado', () => {
    assert.equal(formatPhoneBr('27981283526'), '(27) 9 8128-3526');
  });

  it('formata telefone fixo no padrÃ£o nacional', () => {
    assert.equal(formatPhoneBr('2731234567'), '(27) 3123-4567');
  });
});
