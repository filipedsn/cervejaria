import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumoCaixaEvento } from './evento-caixa.js';

describe('resumoCaixaEvento', () => {
  it('reconcilia troco, pagamentos e movimentos de caixa', () => {
    const resumo = resumoCaixaEvento({
      id: 'cash-1', eventoId: 'event-1', status: 'ABERTO', trocoInicial: 100,
      abertoEm: new Date(), fechadoEm: null, contadoDinheiro: null, contadoPix: null,
      contadoDebito: null, contadoCredito: null, contadoCartao: null, observacaoFechamento: null,
      movimentos: [
        { id: 's1', tipo: 'SUPRIMENTO', valor: 20, observacao: null, createdAt: new Date() },
        { id: 's2', tipo: 'SANGRIA', valor: 15, observacao: null, createdAt: new Date() },
      ],
      pagamentos: [
        { forma: 'DINHEIRO', valor: 30 }, { forma: 'PIX', valor: 45 },
        { forma: 'CARTAO', valor: 2 }, { forma: 'CARTAO_DEBITO', valor: 12 }, { forma: 'CARTAO_CREDITO', valor: 13 },
      ],
    });
    assert.deepEqual(resumo?.esperado, { DINHEIRO: 135, PIX: 45, CARTAO: 2, CARTAO_DEBITO: 12, CARTAO_CREDITO: 13 });
    assert.equal(resumo?.suprimentos, 20);
    assert.equal(resumo?.sangrias, 15);
  });

  it('calcula divergência por forma após fechamento', () => {
    const resumo = resumoCaixaEvento({
      id: 'cash-2', eventoId: 'event-1', status: 'FECHADO', trocoInicial: 50,
      abertoEm: new Date(), fechadoEm: new Date(), contadoDinheiro: 45, contadoPix: 20,
      contadoDebito: 0, contadoCredito: 0, contadoCartao: 0, observacaoFechamento: null,
      movimentos: [], pagamentos: [{ forma: 'DINHEIRO', valor: 10 }, { forma: 'PIX', valor: 20 }],
    });
    assert.deepEqual(resumo?.divergencia, { DINHEIRO: -15, PIX: 0, CARTAO: 0, CARTAO_DEBITO: 0, CARTAO_CREDITO: 0 });
  });

  it('returns null before the first event cash session', () => {
    assert.equal(resumoCaixaEvento(null), null);
  });
});
