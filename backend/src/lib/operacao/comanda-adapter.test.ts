import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INCLUDE_COMANDA_OPERACAO } from './comanda-adapter.js';

describe('INCLUDE_COMANDA_OPERACAO', () => {
  it('não solicita a relação aditiva de configuração do PDV no include operacional legado', () => {
    const pontoVenda = INCLUDE_COMANDA_OPERACAO.pontoVenda;
    assert.equal(typeof pontoVenda, 'object');
    assert.equal('configuracaoPdv' in ((pontoVenda as { select: object }).select), false);
  });
});
