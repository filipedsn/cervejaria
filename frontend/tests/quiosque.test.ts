import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ordenarComandasParaOperacao,
  mesasOperacionais,
  rotuloComanda,
  rotuloInternoComanda,
  classificarEstoque,
  type ComandaQuiosque,
} from '../src/lib/quiosque.ts';

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
