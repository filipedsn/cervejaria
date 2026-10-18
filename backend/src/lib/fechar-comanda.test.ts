import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocatePagamentosToComandas,
  assertPagamentosParaTotal,
  assertValorPagamentosParaTotal,
  podeDeixarContaPendente,
  resolveSessaoCaixaRealizacaoForClose,
} from './fechar-comanda.js';

describe('allocatePagamentosToComandas', () => {
  it('distribui pagamento único entre comandas em ordem de id', () => {
    const comandas = [
      { id: 'b', total: 40 },
      { id: 'a', total: 60 },
    ];
    const map = allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 100 }]);
    const a = map.get('a')!;
    const b = map.get('b')!;
    assert.equal(a.length, 1);
    assert.equal(a[0]!.forma, 'PIX');
    assert.equal(a[0]!.valor, 60);
    assert.equal(b[0]!.valor, 40);
  });

  it('distribui split entre comandas', () => {
    const comandas = [
      { id: 'a', total: 60 },
      { id: 'b', total: 40 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 50 },
      { forma: 'PIX', valor: 50 },
    ]);
    const sumA = map.get('a')!.reduce((s, p) => s + p.valor, 0);
    const sumB = map.get('b')!.reduce((s, p) => s + p.valor, 0);
    assert.equal(sumA, 60);
    assert.equal(sumB, 40);
  });

  it('distribui entre 3 comandas consumindo pool até zero', () => {
    const comandas = [
      { id: 'a', total: 10 },
      { id: 'b', total: 20 },
      { id: 'c', total: 30 },
    ];
    const map = allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 60 }]);
    const global = [...map.values()].flat().reduce((s, p) => s + p.valor, 0);
    assert.equal(global, 60);
    assert.equal(map.get('a')!.reduce((s, p) => s + p.valor, 0), 10);
    assert.equal(map.get('b')!.reduce((s, p) => s + p.valor, 0), 20);
    assert.equal(map.get('c')!.reduce((s, p) => s + p.valor, 0), 30);
  });

  it('prioriza comanda a (lexicográfico) no water-fill', () => {
    const comandas = [
      { id: 'b', total: 25 },
      { id: 'a', total: 25 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 30 },
      { forma: 'PIX', valor: 20 },
    ]);
    const a = map.get('a')!;
    assert.equal(a.reduce((s, p) => s + p.valor, 0), 25);
    assert.equal(a[0]!.forma, 'DINHEIRO');
    assert.equal(a[0]!.valor, 25);
    const b = map.get('b')!;
    assert.equal(b.reduce((s, p) => s + p.valor, 0), 25);
  });

  it('distribui split com centavos sem sobra', () => {
    const comandas = [
      { id: 'a', total: 12 },
      { id: 'b', total: 16 },
    ];
    const map = allocatePagamentosToComandas(comandas, [
      { forma: 'DINHEIRO', valor: 11.2 },
      { forma: 'PIX', valor: 16.8 },
    ]);
    assert.equal(map.get('a')!.reduce((s, p) => s + p.valor, 0), 12);
    assert.equal(map.get('b')!.reduce((s, p) => s + p.valor, 0), 16);
  });

  it('lança erro quando pool é insuficiente', () => {
    assert.throws(
      () =>
        allocatePagamentosToComandas([{ id: 'a', total: 50 }], [{ forma: 'PIX', valor: 30 }]),
      /Alocação incompleta/,
    );
  });

  it('lança erro quando pool tem sobra', () => {
    assert.throws(
      () =>
        allocatePagamentosToComandas([{ id: 'a', total: 50 }], [{ forma: 'PIX', valor: 60 }]),
      /Sobra no pool/,
    );
  });
});

describe('assertPagamentosParaTotal', () => {
  it('aceita lista vazia quando total é zero (cortesia)', () => {
    assert.doesNotThrow(() => assertPagamentosParaTotal(0, []));
  });

  it('rejeita pagamento vazio com total positivo', () => {
    assert.throws(() => assertPagamentosParaTotal(10, []), /Informe como o cliente pagou/);
  });

  it('rejeita pagamento não vazio com total zero', () => {
    assert.throws(
      () => assertPagamentosParaTotal(0, [{ valor: 1 }]),
      /Conta zerada não exige pagamento/,
    );
  });

  it('aceita pagamento não vazio com total positivo', () => {
    assert.doesNotThrow(() => assertPagamentosParaTotal(25.5, [{ valor: 25.5 }]));
  });
});

describe('assertValorPagamentosParaTotal', () => {
  it('rejeita pagamento calculado sobre total desatualizado', () => {
    assert.throws(
      () => assertValorPagamentosParaTotal(24, [{ valor: 12 }]),
      /difere do total da comanda/,
    );
  });

  it('aceita pagamentos que somam o total final', () => {
    assert.doesNotThrow(() =>
      assertValorPagamentosParaTotal(24, [
        { valor: 10 },
        { valor: 14 },
      ]),
    );
  });
});

describe('podeDeixarContaPendente', () => {
  it('permite contas a receber em CAIXA e EVENTO, mas não no quiosque', () => {
    assert.equal(podeDeixarContaPendente('CAIXA'), true);
    assert.equal(podeDeixarContaPendente('EVENTO'), true);
    assert.equal(podeDeixarContaPendente('QUIOSQUE'), false);
  });
});

describe('resolveSessaoCaixaRealizacaoForClose', () => {
  it('não exige sessão para EVENTO', () => {
    assert.equal(
      resolveSessaoCaixaRealizacaoForClose({ origem: 'EVENTO', sessaoCaixaId: null }),
      undefined,
    );
  });

  it('grava a sessão informada em CAIXA sem vínculo prévio', () => {
    assert.equal(
      resolveSessaoCaixaRealizacaoForClose({ origem: 'CAIXA', sessaoCaixaId: 'sess-1' }),
      'sess-1',
    );
  });

  it('rejeita fechamento CAIXA sem sessão', () => {
    assert.throws(
      () => resolveSessaoCaixaRealizacaoForClose({ origem: 'CAIXA', sessaoCaixaId: null }),
      (error: unknown) =>
        error instanceof Error
        && error.message.includes('sessão de caixa de realização')
        && (error as { statusCode?: number }).statusCode === 409,
    );
  });

  it('mantém vínculo já gravado quando a sessão do fechamento coincide', () => {
    assert.equal(
      resolveSessaoCaixaRealizacaoForClose({
        origem: 'CAIXA',
        sessaoCaixaId: 'sess-1',
        alreadyLinkedId: 'sess-1',
      }),
      'sess-1',
    );
  });

  it('rejeita atravessar turnos quando já há vínculo diferente', () => {
    assert.throws(
      () =>
        resolveSessaoCaixaRealizacaoForClose({
          origem: 'CAIXA',
          sessaoCaixaId: 'sess-2',
          alreadyLinkedId: 'sess-1',
        }),
      /não pode atravessar turnos/,
    );
  });
});
