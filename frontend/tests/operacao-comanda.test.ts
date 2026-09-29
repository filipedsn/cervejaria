import assert from 'node:assert/strict';
import test from 'node:test';
import {
  itemConfirmadoNaComanda,
  ordenarPedidosMaisRecentes,
  podeAlterarQuantidadeItemComanda,
  resumirItensComanda,
  totalPendenteComanda,
  totalItensComanda,
  type PedidoOperacao,
} from '../src/lib/operacao.ts';

const pedido: PedidoOperacao = {
  id: 'pedido-1',
  numero: 9,
  status: 'RECEBIDO',
  observacao: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  itens: [
    {
      id: 'agua', produtoId: 'agua', nome: 'Água', quantidade: 4,
      precoUnit: 4, subtotal: 16, volumeMl: 0, exigePreparo: false,
    },
    {
      id: 'medalhao', produtoId: 'medalhao', nome: 'Medalhão', quantidade: 3,
      precoUnit: 17, subtotal: 51, volumeMl: 0, exigePreparo: true,
    },
  ],
};

test('item sem preparo compõe o resumo imediatamente, mesmo com o pedido ainda na cozinha', () => {
  const comanda = { pedidos: [pedido] } as Parameters<typeof resumirItensComanda>[0];

  assert.equal(itemConfirmadoNaComanda(pedido, pedido.itens[0]!), true);
  assert.equal(itemConfirmadoNaComanda(pedido, pedido.itens[1]!), false);
  assert.deepEqual(resumirItensComanda(comanda).map(({ nome, total }) => ({ nome, total })), [
    { nome: 'Água', total: 16 },
  ]);
  assert.equal(totalPendenteComanda(comanda), 51);
});

test('quantidade de item entregue fica somente para leitura', () => {
  const comanda = { status: 'ABERTA' } as Parameters<typeof podeAlterarQuantidadeItemComanda>[0];
  const pedidoEntregue = { ...pedido, status: 'ENTREGUE' as const };
  const pedidoSemPreparo = { ...pedido, itens: [pedido.itens[0]!] };

  assert.equal(podeAlterarQuantidadeItemComanda(comanda, pedidoSemPreparo), true);
  assert.equal(podeAlterarQuantidadeItemComanda(comanda, pedidoEntregue), false);
});

test('cancelar o item de cozinha nao cancela a bebida no mesmo ticket', () => {
  const comida = {
    ...pedido.itens[1]!,
    id: 'churrasquinho',
    nome: 'Churrasquinho Boi',
    quantidade: 1,
    precoUnit: 14,
    subtotal: 14,
    canceladoEm: '2026-09-29T10:00:00.000Z',
  };
  const cerveja = {
    ...pedido.itens[0]!,
    id: 'cerveja',
    nome: 'Long Neck Heineken Zero',
    quantidade: 1,
    precoUnit: 13,
    subtotal: 13,
  };
  const pedidoComCancelamentoIndividual: PedidoOperacao = {
    ...pedido,
    status: 'CANCELADO',
    itens: [comida, cerveja],
  };
  const comanda = { status: 'ABERTA', pedidos: [pedidoComCancelamentoIndividual] } as Parameters<typeof resumirItensComanda>[0];

  assert.equal(itemConfirmadoNaComanda(pedidoComCancelamentoIndividual, comida), false);
  assert.equal(itemConfirmadoNaComanda(pedidoComCancelamentoIndividual, cerveja), true);
  assert.equal(totalItensComanda(comanda), 1);
  assert.deepEqual(resumirItensComanda(comanda).map(({ nome, total }) => ({ nome, total })), [
    { nome: 'Long Neck Heineken Zero', total: 13 },
  ]);
  assert.equal(podeAlterarQuantidadeItemComanda(comanda, pedidoComCancelamentoIndividual, cerveja), true);
});

test('pedidos da comanda aparecem do lançamento mais recente para o mais antigo sem mutar a lista', () => {
  const maisAntigo = { ...pedido, id: 'pedido-antigo', numero: 7, createdAt: '2026-09-28T11:00:00.000Z' };
  const maisRecente = { ...pedido, id: 'pedido-recente', numero: 10, createdAt: '2026-09-28T13:00:00.000Z' };
  const mesmaDataMaiorNumero = { ...pedido, id: 'pedido-empate', numero: 11, createdAt: maisRecente.createdAt };
  const pedidos = [maisAntigo, maisRecente, mesmaDataMaiorNumero];

  assert.deepEqual(ordenarPedidosMaisRecentes(pedidos).map(({ id }) => id), [
    'pedido-empate', 'pedido-recente', 'pedido-antigo',
  ]);
  assert.deepEqual(pedidos.map(({ id }) => id), ['pedido-antigo', 'pedido-recente', 'pedido-empate']);
});
