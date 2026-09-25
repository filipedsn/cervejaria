import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  StatusPedidoCozinhaDesatualizadoError,
  TRANSICOES,
  aplicarStatusPedidoCozinha,
  filtroListaPedidosCozinha,
} from './cozinha.js';

type Status = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';

function txComPedido(statusInicial: Status) {
  let status = statusInicial;
  const historico: Status[] = [];
  const tx = {
    pedidoQuiosque: {
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
    pedidoQuiosqueStatusHistorico: {
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
      aplicarStatusPedidoCozinha(db.tx as never, origem, 'CANCELADO'),
    ]);

    assert.equal(resultados.filter((resultado) => resultado.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter((resultado) => resultado.status === 'rejected').length, 1);
    assert.equal(db.historico.length, 1);
    assert.ok(['EM_PREPARO', 'CANCELADO'].includes(db.status()));
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
      status: { in: ['RECEBIDO', 'EM_PREPARO', 'PRONTO'] },
    });
  });

  it('inclui apenas entregues do dia atual ao carregar fila e entregues juntos', () => {
    assert.deepEqual(filtroListaPedidosCozinha(true, hoje), {
      OR: [
        { status: { in: ['RECEBIDO', 'EM_PREPARO', 'PRONTO'] } },
        { status: 'ENTREGUE', diaOperacional: hoje },
      ],
    });
  });
});
