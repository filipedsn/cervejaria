import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  StatusPedidoCozinhaDesatualizadoError,
  TRANSICOES,
  aplicarStatusPedidoCozinha,
  filtroListaPedidosCozinha,
  resumoPedidoCozinha,
} from './cozinha.js';

type Status = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELAMENTO_PENDENTE' | 'CANCELADO';

function txComPedido(statusInicial: Status) {
  let status = statusInicial;
  const historico: Status[] = [];
  const tx = {
    pedidoOperacao: {
      updateMany: async ({ where, data }: { where: { status: Status }; data: { status: Status } }) => {
        if (status !== where.status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: 'pedido-1',
        status,
        itensComanda: [],
        comanda: { id: 'comanda-1', tipo: 'MESA', identificador: null, numero: 1 },
      }),
    },
    pedidoOperacaoStatusHistorico: {
      create: async ({ data }: { data: { status: Status } }) => {
        historico.push(data.status);
      },
    },
  };
  return { tx, status: () => status, historico };
}

describe('aplicarStatusPedidoCozinha', () => {
  it('persiste uma transição normal e cria um único histórico', async () => {
    const db = txComPedido('RECEBIDO');
    const pedido = await aplicarStatusPedidoCozinha(
      db.tx as never,
      { id: 'pedido-1', status: 'RECEBIDO' },
      'EM_PREPARO',
    );

    assert.equal(pedido.status, 'EM_PREPARO');
    assert.equal(db.status(), 'EM_PREPARO');
    assert.deepEqual(db.historico, ['EM_PREPARO']);
  });

  it('aceita somente uma transição concorrente originada no mesmo status', async () => {
    const db = txComPedido('RECEBIDO');
    const origem = { id: 'pedido-1', status: 'RECEBIDO' as const };
    const resultados = await Promise.allSettled([
      aplicarStatusPedidoCozinha(db.tx as never, origem, 'EM_PREPARO'),
      aplicarStatusPedidoCozinha(db.tx as never, origem, 'CANCELAMENTO_PENDENTE'),
    ]);

    assert.equal(resultados.filter((resultado) => resultado.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter((resultado) => resultado.status === 'rejected').length, 1);
    assert.equal(db.historico.length, 1);
    assert.ok(['EM_PREPARO', 'CANCELAMENTO_PENDENTE'].includes(db.status()));
  });

  it('rejeita transição baseada em status stale sem criar histórico', async () => {
    const db = txComPedido('EM_PREPARO');

    await assert.rejects(
      aplicarStatusPedidoCozinha(
        db.tx as never,
        { id: 'pedido-1', status: 'RECEBIDO' },
        'EM_PREPARO',
      ),
      StatusPedidoCozinhaDesatualizadoError,
    );
    assert.equal(db.status(), 'EM_PREPARO');
    assert.deepEqual(db.historico, []);
  });

  it('mantém bloqueado o salto RECEBIDO para ENTREGUE pela regra da rota', () => {
    assert.equal(TRANSICOES.RECEBIDO.includes('ENTREGUE'), false);
  });
});

describe('filtroListaPedidosCozinha', () => {
  const hoje = new Date('2026-08-27T03:00:00.000Z');

  it('mantém pedidos pendentes de dias anteriores visíveis na fila', () => {
    assert.deepEqual(filtroListaPedidosCozinha(false, hoje), {
      OR: [
        {
          status: { in: ['RECEBIDO', 'EM_PREPARO', 'PRONTO'] },
        },
        { status: 'CANCELAMENTO_PENDENTE' },
      ],
    });
  });

  it('inclui apenas entregues do dia atual ao carregar fila e entregues juntos', () => {
    assert.deepEqual(filtroListaPedidosCozinha(true, hoje), {
      OR: [
        {
          status: { in: ['RECEBIDO', 'EM_PREPARO', 'PRONTO'] },
        },
        { status: 'CANCELAMENTO_PENDENTE' },
        { status: 'ENTREGUE', diaOperacional: hoje },
      ],
    });
  });
});

describe('resumoPedidoCozinha', () => {
  it('preserva para viagem quando a flag está no item da comanda', () => {
    const resumo = resumoPedidoCozinha({
      id: 'pedido-1',
      numero: 2,
      status: 'RECEBIDO',
      paraViagem: false,
      observacao: null,
      createdAt: new Date(),
      statusDesde: new Date(),
      entregueEm: null,
      itensComanda: [{
        id: 'item-1',
        nome: 'Churrasquinho',
        quantidade: 1,
        precoUnit: 14,
        exigePreparo: true,
        paraViagem: true,
      }],
      comanda: { id: 'comanda-1', tipo: 'COMANDA', identificador: null, numero: 1 },
    } as never);

    assert.equal(resumo.paraViagem, true);
  });

  it('destaca item com cancelamento solicitado e omite item já confirmado', () => {
    const resumo = resumoPedidoCozinha({
      id: 'pedido-1', numero: 2, status: 'EM_PREPARO', paraViagem: false,
      observacao: null, createdAt: new Date(), statusDesde: new Date(), entregueEm: null,
      itensComanda: [
        { id: 'pendente', nome: 'Boi', quantidade: 1, precoUnit: 14, exigePreparo: true, cancelamentoPendenteEm: new Date(), canceladoEm: null },
        { id: 'confirmado', nome: 'Costela', quantidade: 1, precoUnit: 14, exigePreparo: true, cancelamentoPendenteEm: null, canceladoEm: new Date() },
      ],
      comanda: { id: 'comanda-1', tipo: 'COMANDA', identificador: null, numero: 1 },
    } as never);

    assert.equal(resumo.itens.length, 1);
    assert.equal(resumo.itens[0].id, 'pendente');
    assert.equal(resumo.itens[0].cancelamentoPendente, true);
  });

  it('mantém a escolha para viagem independente em cada item e preserva dados agrupados', () => {
    const itens = [false, true, false].map((paraViagem, index) => ({
      id: `item-${index + 1}`,
      nome: index === 1 ? 'C. BOI' : index === 0 ? 'C. COSTELA' : 'C. LINGUIÇA',
      quantidade: index === 0 ? 2 : 1,
      precoUnit: 14,
      exigePreparo: true,
      paraViagem,
      opcionais: [{ id: `op-${index + 1}`, nome: ['Farinha', 'Molho'][index % 2], precoAdicional: 1, quantidade: 1 }],
    }));
    const pedido = {
      id: 'pedido-1', numero: 2, status: 'RECEBIDO', paraViagem: true,
      observacao: null, createdAt: new Date(), statusDesde: new Date(), entregueEm: null,
      itensComanda: itens,
      comanda: { id: 'comanda-1', tipo: 'COMANDA', identificador: null, numero: 1 },
    };

    const esperado = [false, true, false];
    const resumo = resumoPedidoCozinha(pedido as never);
    assert.equal(resumo.paraViagem, true, 'o agregado do pedido continua disponível para o cartão');
    assert.deepEqual(resumo.itens.map((item) => item.paraViagem), esperado);
    assert.deepEqual(resumo.itens.map((item) => item.quantidade), [2, 1, 1]);
    assert.deepEqual(resumo.itens.map((item) => item.opcionais[0]?.nome), ['Farinha', 'Molho', 'Farinha']);

    // Cobre os quatro padrões de escolha no payload usado por listagem e realtime.
    for (const escolhas of [[], [1], [0, 2], [0, 1, 2]]) {
      const linhas = itens.map((item, index) => ({ ...item, paraViagem: escolhas.includes(index) }));
      const resultado = resumoPedidoCozinha({ ...pedido, paraViagem: escolhas.length > 0, itensComanda: linhas } as never);
      assert.deepEqual(resultado.itens.map((item) => item.paraViagem), linhas.map((item) => item.paraViagem));
    }

    const mesmoProduto = resumoPedidoCozinha({ ...pedido, itensComanda: [
      { ...itens[1], id: 'igual-1', paraViagem: false },
      { ...itens[1], id: 'igual-2', paraViagem: true },
    ] } as never);
    assert.deepEqual(mesmoProduto.itens.map((item) => [item.nome, item.paraViagem]), [['C. BOI', false], ['C. BOI', true]]);
  });
});
