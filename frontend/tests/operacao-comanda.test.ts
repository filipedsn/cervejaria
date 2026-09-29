import assert from 'node:assert/strict';
import test from 'node:test';
import {
  itemConfirmadoNaComanda,
  podeAlterarQuantidadeItemComanda,
  resumirItensComanda,
  totalPendenteComanda,
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
