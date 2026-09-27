import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularFinanceiroComanda, itemVaiParaCozinha, resolverPagamentos, subtotalComandaEmCentavos, VendaInvalidaError } from './venda.js';

describe('itemVaiParaCozinha', () => {
  it('não cria fila latente enquanto a cozinha está desligada', () => {
    assert.equal(itemVaiParaCozinha(false, true), false);
    assert.equal(itemVaiParaCozinha(true, true), true);
    assert.equal(itemVaiParaCozinha(true, false), false);
  });
});

describe('resolverPagamentos', () => {
  it('aceita lista vazia quando o devido é zero (cortesia)', () => {
    assert.deepEqual(resolverPagamentos([], 0), []);
  });

  it('rejeita lista vazia quando o devido é positivo', () => {
    assert.throws(() => resolverPagamentos([], 100), (err: unknown) => {
      assert.ok(err instanceof VendaInvalidaError);
      assert.match(err.message, /Informe como o cliente pagou/);
      return true;
    });
  });

  it('rejeita soma divergente do devido (pagamento stale)', () => {
    assert.throws(
      () => resolverPagamentos([{ forma: 'PIX', valor: 10 }], 500),
      (err: unknown) => {
        assert.ok(err instanceof VendaInvalidaError);
        assert.match(err.message, /pagamentos somam/);
        return true;
      },
    );
  });

  it('aceita pagamento que quita o devido', () => {
    const resolved = resolverPagamentos([{ forma: 'PIX', valor: 12.5 }], 1250);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.valor, 12.5);
    assert.equal(resolved[0]!.troco, null);
  });
});

describe('subtotalComandaEmCentavos', () => {
  it('conta pedidos entregues como consumo e mantém pedidos não entregues fora do total', () => {
    const comanda = {
      pedidosOperacao: [
        { id: 'batata', status: 'ENTREGUE', itensComanda: [{ precoUnit: 25, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'costela', status: 'ENTREGUE', itensComanda: [{ precoUnit: 14, quantidade: 3, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'boi', status: 'ENTREGUE', itensComanda: [{ precoUnit: 13, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { id: 'pronto', status: 'PRONTO', itensComanda: [{ precoUnit: 17.67, quantidade: 3, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
      ],
      itens: [
        { pedidoCozinhaId: 'entregue', precoUnit: 14, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null },
        { pedidoCozinhaId: 'pronto', precoUnit: 17.67, quantidade: 3, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null },
      ],
    } as unknown as Parameters<typeof subtotalComandaEmCentavos>[0];

    assert.equal(subtotalComandaEmCentavos(comanda), 8000);
  });
});

describe('calcularFinanceiroComanda', () => {
  it('compartilha consumido, aberto e total líquido com itens avulsos e pedidos', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'ABERTA',
      desconto: 5,
      itensSemPedido: [
        { precoUnit: 10, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null },
        { precoUnit: 99, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null, pedidoCozinhaId: 'pedido-pronto' },
      ],
      pedidos: [
        { status: 'ENTREGUE', itens: [{ precoUnit: 15, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'PRONTO', itens: [{ precoUnit: 20, quantidade: 2, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'RECEBIDO', itens: [{ precoUnit: 13, quantidade: 1, exigePreparo: false, cancelamentoPendenteEm: null, canceladoEm: null }] },
        { status: 'CANCELADO', itens: [{ precoUnit: 50, quantidade: 1, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: null }] },
      ],
    });

    assert.deepEqual(financeiro, { subtotal: 3800, valorEmAberto: 4000, desconto: 500, total: 3300 });
  });

  it('preserva o valor final persistido e zera valor em aberto após fechamento', () => {
    const financeiro = calcularFinanceiroComanda({
      status: 'FECHADA',
      totalPersistido: 17,
      itensSemPedido: [],
      pedidos: [{ status: 'RECEBIDO', itens: [{ precoUnit: 20, quantidade: 1 }] }],
    });

    assert.deepEqual(financeiro, { subtotal: 2000, valorEmAberto: 0, desconto: 0, total: 1700 });
  });
});
