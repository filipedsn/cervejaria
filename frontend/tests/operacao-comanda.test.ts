import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estacaoBloqueiaFechamentoComanda,
  estacaoDoPedido,
  itemConfirmadoNaComanda,
  classificarGrupoProdutoOperacao,
  ordenarPedidosPorSenhaDecrescente,
  podeAlterarQuantidadeItemComanda,
  resumirItensComanda,
  temPedidoCozinhaPendente,
  totalPendenteComanda,
  totalItensComanda,
  pedidoVisivelNaComanda,
  rotuloComanda,
  rotuloStatusItemPedido,
  rotuloStatusPedidoResumo,
  type PedidoOperacao,
} from '../src/lib/operacao.ts';

test('cozinha identifica venda avulsa pelo nome informado sem criar cliente cadastrado', () => {
  assert.equal(rotuloComanda({ tipo: 'AVULSA', identificador: 'Filipe', numero: null }), 'Filipe');
  assert.equal(rotuloComanda({ tipo: 'AVULSA', identificador: null, numero: null }), 'Venda avulsa');
});

test('classifica produtos por categoria, sem confundir formato e chope por tap em qualquer modo', () => {
  assert.equal(classificarGrupoProdutoOperacao({ tipo: 'BEBIDA', categoria: 'Drinks', formato: 'OUTRO', precos: [{ volumeMl: 1, preco: 13 }] }), 'bebidas');
  assert.equal(classificarGrupoProdutoOperacao({ tipo: 'BEBIDA', categoria: 'Cervejas', formato: 'LATA', precos: [{ volumeMl: 1, preco: 10 }] }), 'bebidas');
  assert.equal(classificarGrupoProdutoOperacao({ tipo: 'BEBIDA', categoria: 'Chope', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 12 }] }), 'chope');
  assert.equal(classificarGrupoProdutoOperacao({ tipo: 'BEBIDA', categoria: 'Outro', formato: 'OUTRO', precos: [{ volumeMl: 1, preco: 8 }] }), 'outros');
});

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

test('pedido misto mostra status por item e cabeçalho Parcial quando latões já foram atendidos', () => {
  const misto: PedidoOperacao = {
    ...pedido,
    itens: [
      { ...pedido.itens[0]!, id: 'heineken', nome: 'Latão Heineken', balcaoAtendidoEm: '2026-11-01T12:00:00.000Z' },
      { ...pedido.itens[0]!, id: 'amstel', nome: 'Latão Amstel', balcaoAtendidoEm: '2026-11-01T12:00:00.000Z' },
      { ...pedido.itens[1]!, id: 'c-boi', nome: 'C. BOI' },
    ],
  };

  assert.equal(rotuloStatusItemPedido(misto, misto.itens[0]!), 'Entregue');
  assert.equal(rotuloStatusItemPedido(misto, misto.itens[1]!), 'Entregue');
  assert.equal(rotuloStatusItemPedido(misto, misto.itens[2]!), 'Na fila');
  assert.equal(rotuloStatusPedidoResumo(misto), 'Parcial');
});

test('pedido misto concluído unifica latões e porção como Entregue', () => {
  const concluido: PedidoOperacao = {
    ...pedido,
    status: 'ENTREGUE',
    itens: [
      { ...pedido.itens[0]!, id: 'heineken', nome: 'Latão Heineken', balcaoAtendidoEm: '2026-11-01T12:00:00.000Z' },
      { ...pedido.itens[1]!, id: 'c-boi', nome: 'C. BOI' },
      { ...pedido.itens[0]!, id: 'amstel', nome: 'Latão Amstel', balcaoAtendidoEm: '2026-11-01T12:00:00.000Z' },
    ],
  };

  assert.equal(rotuloStatusItemPedido(concluido, concluido.itens[0]!), 'Entregue');
  assert.equal(rotuloStatusItemPedido(concluido, concluido.itens[1]!), 'Entregue');
  assert.equal(rotuloStatusItemPedido(concluido, concluido.itens[2]!), 'Entregue');
  assert.equal(rotuloStatusPedidoResumo(concluido), 'Entregue');
});

test('item sem preparo compõe o resumo imediatamente, mesmo com o pedido ainda na cozinha', () => {
  const comanda = { pedidos: [pedido] } as Parameters<typeof resumirItensComanda>[0];

  assert.equal(itemConfirmadoNaComanda(pedido, pedido.itens[0]!), true);
  assert.equal(itemConfirmadoNaComanda(pedido, pedido.itens[1]!), false);
  assert.deepEqual(resumirItensComanda(comanda).map(({ nome, total }) => ({ nome, total })), [
    { nome: 'Água', total: 16 },
  ]);
  assert.equal(totalPendenteComanda(comanda), 51);
});

test('Bar e Cozinha têm pendência, cobrança ao lançar e bloqueio de fechamento independentes', () => {
  const pedidoBar: PedidoOperacao = {
    ...pedido,
    id: 'pedido-bar',
    numero: 10,
    itens: [{ id: 'gin', produtoId: 'gin', nome: 'Gin tônica', quantidade: 2, precoUnit: 30, subtotal: 60, volumeMl: 0, exigePreparo: true, estacaoPreparo: 'BAR' }],
  };
  const comanda = { pedidos: [pedido, pedidoBar] } as Parameters<typeof resumirItensComanda>[0];

  assert.equal(estacaoDoPedido(pedidoBar), 'BAR');
  assert.equal(estacaoDoPedido(pedido), 'COZINHA');
  assert.equal(totalPendenteComanda(comanda, false, 'COZINHA'), 51);
  assert.equal(totalPendenteComanda(comanda, false, 'BAR'), 60);
  assert.equal(totalPendenteComanda(comanda, { cozinha: false, bar: true }), 51);
  assert.deepEqual(
    resumirItensComanda(comanda, { cozinha: false, bar: true }).map(({ nome, total }) => ({ nome, total })),
    [{ nome: 'Água', total: 16 }, { nome: 'Gin tônica', total: 60 }],
  );

  const regras = {
    kitchenItemsChargeAtLaunch: true,
    allowCloseComandaWithPendingKitchenOrders: true,
    barItemsChargeAtLaunch: false,
    allowCloseComandaWithPendingBarOrders: false,
  };
  assert.equal(estacaoBloqueiaFechamentoComanda(comanda, regras), 'BAR');
  assert.equal(estacaoBloqueiaFechamentoComanda(comanda, { ...regras, barItemsChargeAtLaunch: true, allowCloseComandaWithPendingBarOrders: true }), null);
  assert.equal(temPedidoCozinhaPendente(comanda, 'BAR'), true);
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
    cancelamentoPendenteEm: '2026-09-29T09:59:00.000Z',
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
  assert.equal(pedidoVisivelNaComanda(pedidoComCancelamentoIndividual), true);
});

test('oculta rodada sem itens ou com todos os itens cancelados, mas preserva cancelamento pendente', () => {
  const todosCancelados: PedidoOperacao = {
    ...pedido,
    itens: pedido.itens.map((item) => ({ ...item, canceladoEm: '2026-09-29T10:00:00.000Z' })),
  };
  const cancelamentoPendente: PedidoOperacao = {
    ...pedido,
    status: 'CANCELAMENTO_PENDENTE',
    itens: pedido.itens.map((item) => ({ ...item, cancelamentoPendenteEm: '2026-09-29T10:00:00.000Z' })),
  };

  assert.equal(pedidoVisivelNaComanda(todosCancelados), false);
  assert.equal(pedidoVisivelNaComanda({ ...pedido, itens: [] }), false);
  assert.equal(pedidoVisivelNaComanda(cancelamentoPendente), true);
});

test('senhas da comanda aparecem em ordem numérica decrescente sem mutar a lista', () => {
  const maisAntigo = { ...pedido, id: 'pedido-antigo', numero: 7, createdAt: '2026-09-28T11:00:00.000Z' };
  const maisRecente = { ...pedido, id: 'pedido-recente', numero: 10, createdAt: '2026-09-28T13:00:00.000Z' };
  const mesmaDataMaiorNumero = { ...pedido, id: 'pedido-empate', numero: 11, createdAt: maisRecente.createdAt };
  const maiorNumeroMaisAntigo = { ...pedido, id: 'pedido-numero-maior', numero: 16, createdAt: '2026-09-28T09:00:00.000Z' };
  const pedidos = [maisAntigo, maisRecente, mesmaDataMaiorNumero, maiorNumeroMaisAntigo];

  assert.deepEqual(ordenarPedidosPorSenhaDecrescente(pedidos).map(({ id }) => id), [
    'pedido-numero-maior', 'pedido-empate', 'pedido-recente', 'pedido-antigo',
  ]);
  assert.deepEqual(pedidos.map(({ id }) => id), ['pedido-antigo', 'pedido-recente', 'pedido-empate', 'pedido-numero-maior']);
});
