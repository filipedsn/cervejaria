import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agruparContasPorCliente } from '../src/lib/contas-pendentes-grupo';
import { montarMensagemCobrancaContas } from '../src/lib/contas-pendentes-cobranca';
import type { ContaPendenteOperacao } from '../src/lib/operacao';

function conta(parcial: Partial<ContaPendenteOperacao> & { id: string; clienteId: string; saldo: number }): ContaPendenteOperacao {
  return {
    id: parcial.id,
    cliente: parcial.cliente ?? { id: parcial.clienteId, nome: 'João', telefone: '27999990000' },
    comanda: parcial.comanda ?? {
      id: 'cmd-' + parcial.id,
      numero: 1,
      identificador: 'A1',
      tipo: 'COMANDA',
      fechadaEm: '2026-10-28T23:00:00.000Z',
      diaOperacional: '2026-10-28',
      pontoVenda: { id: 'pdv', nome: 'Food Truck' },
      itens: [{ nome: 'Chope', quantidade: 2 }],
    },
    valorOriginal: parcial.valorOriginal ?? parcial.saldo,
    recebido: parcial.recebido ?? 0,
    saldo: parcial.saldo,
    createdAt: parcial.createdAt ?? '2026-10-28T23:00:00.000Z',
    pagamentos: parcial.pagamentos ?? [],
  };
}

describe('agruparContasPorCliente', () => {
  it('consolida várias contas do mesmo cliente em um grupo', () => {
    const grupos = agruparContasPorCliente([
      conta({ id: '1', clienteId: 'c1', saldo: 10, createdAt: '2026-10-27T20:00:00.000Z', comanda: {
        id: 'a', numero: 1, identificador: null, tipo: 'COMANDA', fechadaEm: '2026-10-27T20:00:00.000Z', diaOperacional: '2026-10-27',
        pontoVenda: { id: 'p', nome: 'PDV' }, itens: [{ nome: 'Burger', quantidade: 1 }],
      }}),
      conta({ id: '2', clienteId: 'c1', saldo: 20, createdAt: '2026-10-28T20:00:00.000Z', comanda: {
        id: 'b', numero: 2, identificador: null, tipo: 'COMANDA', fechadaEm: '2026-10-28T20:00:00.000Z', diaOperacional: '2026-10-28',
        pontoVenda: { id: 'p', nome: 'PDV' }, itens: [{ nome: 'Chope', quantidade: 2 }],
      }}),
      conta({ id: '3', clienteId: 'c2', saldo: 5, cliente: { id: 'c2', nome: 'Ana', telefone: null } }),
    ]);
    assert.equal(grupos.length, 2);
    const joao = grupos.find((g) => g.clienteId === 'c1');
    assert.ok(joao);
    assert.equal(joao.contas.length, 2);
    assert.equal(joao.saldo, 30);
    assert.equal(joao.contas[0].id, '1');
  });
});

describe('montarMensagemCobrancaContas', () => {
  it('detalha N turnos e o total', () => {
    const texto = montarMensagemCobrancaContas([
      conta({ id: '1', clienteId: 'c1', saldo: 10, comanda: {
        id: 'a', numero: 1, identificador: null, tipo: 'COMANDA', fechadaEm: '2026-10-27T20:00:00.000Z', diaOperacional: '2026-10-27',
        pontoVenda: { id: 'p', nome: 'Food Truck' }, itens: [{ nome: 'Burger', quantidade: 1 }],
      }}),
      conta({ id: '2', clienteId: 'c1', saldo: 20, comanda: {
        id: 'b', numero: 2, identificador: null, tipo: 'COMANDA', fechadaEm: '2026-10-28T20:00:00.000Z', diaOperacional: '2026-10-28',
        pontoVenda: { id: 'p', nome: 'Food Truck' }, itens: [{ nome: 'Chope', quantidade: 2 }],
      }}),
    ], { nome: 'Tap Quiver', chavePix: 'pix@tap.com' });
    assert.match(texto, /2 consumos/);
    assert.match(texto, /Turno/);
    assert.match(texto, /Valor total pendente/);
    assert.match(texto, /Chave PIX: pix@tap\.com/);
    assert.match(texto, /Tap Quiver/);
  });

  it('mantém tom monocomanda quando há só um turno', () => {
    const texto = montarMensagemCobrancaContas([conta({ id: '1', clienteId: 'c1', saldo: 15 })]);
    assert.match(texto, /Resumo do consumo/);
    assert.match(texto, /Valor pendente/);
    assert.doesNotMatch(texto, /Valor total pendente/);
  });
});
