import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ordenarComandasParaOperacao,
  mesasOperacionais,
  rotuloComanda,
  rotuloInternoComanda,
  classificarEstoque,
  limiteQuantidadeProdutoNoCarrinho,
  podeIncrementarQuantidadeProduto,
  resumirItensComanda,
  type ComandaQuiosque,
} from '../src/lib/operacao.ts';

function comanda(id: string, identificador: string, numero: number): ComandaQuiosque {
  return {
    id,
    tipo: 'MESA',
    identificador,
    numero,
    status: 'ABERTA',
    pontoVendaId: 'ponto',
    createdAt: '2026-01-01T00:00:00.000Z',
    fechadaEm: null,
    subtotal: 0,
    desconto: 0,
    total: 0,
    pedidos: [],
    pagamentos: [],
  };
}

test('TQ-F01: mostra mesas sem o sequencial interno e as ordena pelo número físico', () => {
  const ordenadas = ordenarComandasParaOperacao([
    comanda('mesa-3', '3', 5),
    comanda('mesa-1', '1', 1),
    comanda('mesa-4', '4', 4),
    comanda('mesa-2', '2', 2),
  ]);

  assert.deepEqual(ordenadas.map((item) => rotuloComanda(item)), ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4']);
  assert.equal(rotuloComanda(comanda('mesa-10', '10', 99)), 'Mesa 10');
  assert.equal(rotuloInternoComanda(comanda('mesa-3', '3', 5)), 'Comanda #5');
});

test('TQ-F01: reabrir a Mesa 3 mantém a mesa na posição física, mesmo com nova comanda', () => {
  const mesa3Reaberta = comanda('nova-comanda-mesa-3', '3', 12);
  const ordenadas = ordenarComandasParaOperacao([
    comanda('mesa-4', '4', 4),
    mesa3Reaberta,
    comanda('mesa-2', '2', 2),
    comanda('mesa-1', '1', 1),
  ]);

  assert.equal(mesa3Reaberta.numero, 12);
  assert.deepEqual(ordenadas.map((item) => item.identificador), ['1', '2', '3', '4']);
});

test('TQ-F01B: configuração de 12 posições mantém mesas nunca usadas livres e associa a ocupada', () => {
  const mesas = mesasOperacionais(12, [comanda('comanda-mesa-3', '3', 27)]);

  assert.deepEqual(mesas.map((mesa) => mesa.numero), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(mesas[0]!.comanda, null);
  assert.equal(mesas[2]!.comanda?.id, 'comanda-mesa-3');
  assert.equal(mesas[9]!.comanda, null);
});

test('TQ-F01B: reduzir a quantidade configurada não esconde mesa ocupada acima do limite', () => {
  const mesas = mesasOperacionais(10, [comanda('comanda-mesa-12', '12', 27)]);

  assert.deepEqual(mesas.map((mesa) => mesa.numero), [...Array.from({ length: 10 }, (_, index) => index + 1), 12]);
  assert.equal(mesas.at(-1)?.comanda?.id, 'comanda-mesa-12');
});

test('PROD-05: classifica estoque sem poluir estado normal e prioriza esgotado', () => {
  assert.equal(classificarEstoque(3, null), 'NORMAL');
  assert.equal(classificarEstoque(3, 3), 'LOW');
  assert.equal(classificarEstoque(0, 3), 'OUT_OF_STOCK');
});

test('limita quantidade selecionável ao estoque restante do produto', () => {
  const produto = { id: 'latao', controlaEstoque: true };
  const saldos = new Map([['latao', {
    produtoId: 'latao', nome: 'Latão Amistel', categoria: 'Cervejas', quantidade: 1,
    estoqueMinimo: null, unidadeEstoque: 'un' as const, statusEstoque: 'NORMAL' as const,
  }]]);
  const limite = limiteQuantidadeProdutoNoCarrinho(produto, saldos, true);

  assert.equal(limite, 1);
  assert.equal(podeIncrementarQuantidadeProduto(1, limite), false);
  assert.equal(limiteQuantidadeProdutoNoCarrinho(produto, saldos, true, 1), 0);
  assert.equal(limiteQuantidadeProdutoNoCarrinho(produto, undefined, true), 0);
  assert.equal(limiteQuantidadeProdutoNoCarrinho(produto, undefined, false), null);
});

test('consolida produtos repetidos usando valores históricos e ignora pedidos cancelados', () => {
  const conta = {
    pedidos: [
      { status: 'ENTREGUE', itens: [{ produtoId: 'p1', nome: 'Churrasquinho', quantidade: 2, precoUnit: 10, subtotal: 20 }] },
      { status: 'RECEBIDO', itens: [{ produtoId: 'p1', nome: 'Churrasquinho', quantidade: 1, precoUnit: 12, subtotal: 12 }] },
      { status: 'CANCELADO', itens: [{ produtoId: 'p1', nome: 'Churrasquinho', quantidade: 5, precoUnit: 12, subtotal: 60 }] },
      { status: 'CANCELAMENTO_PENDENTE', itens: [{ produtoId: 'p2', nome: 'Refrigerante', quantidade: 1, precoUnit: 8, subtotal: 8 }] },
      { status: 'EM_PREPARO', itens: [{ produtoId: 'p3', nome: 'Porção', quantidade: 1, precoUnit: 20, subtotal: 20, cancelamentoPendenteEm: '2026-09-27T10:00:00.000Z' }] },
      { status: 'ENTREGUE', itens: [{ produtoId: 'p4', nome: 'Suco', quantidade: 1, precoUnit: 7, subtotal: 7, canceladoEm: '2026-09-27T10:01:00.000Z' }] },
    ],
  } as Parameters<typeof resumirItensComanda>[0];

  const resumo = resumirItensComanda(conta);
  assert.equal(resumo.length, 1);
  assert.deepEqual(
    { chave: resumo[0]?.chave, nome: resumo[0]?.nome, quantidade: resumo[0]?.quantidade, total: resumo[0]?.total },
    { chave: 'p1', nome: 'Churrasquinho', quantidade: 3, total: 32 },
  );
  assert.ok(Math.abs((resumo[0]?.precoMedio ?? 0) - 32 / 3) < 0.000001);
});
