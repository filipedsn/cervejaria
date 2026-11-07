import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  escolhasCompletas,
  fatorPrecoCombo,
  precoBaseCombo,
  precoEscolhasCombo,
  resumoEscolhasCombo,
  type GrupoCombo,
} from '../src/lib/combo';

const opcao = (id: string, nome: string, precoNoCombo: number, quantidade = 1) => ({
  id, produtoId: `p-${id}`, nome, ativo: true, categoria: null, precoNoCombo, quantidade, exigePreparo: true, controlaEstoque: true,
});

const grupos: GrupoCombo[] = [
  { id: 'g1', nome: 'Churrasquinho', minimo: 1, maximo: 1, somenteCardapioTurno: false, opcoes: [opcao('boi', 'Boi', 10), opcao('frango', 'Frango', 8)] },
  { id: 'g2', nome: 'Acompanhamento', minimo: 1, maximo: 1, somenteCardapioTurno: false, opcoes: [opcao('arroz', 'Arroz', 5), opcao('farofa', 'Farofa', 3, 2)] },
  { id: 'g3', nome: 'Bebida', minimo: 0, maximo: 1, somenteCardapioTurno: false, opcoes: [opcao('refri', 'Refri', 5)] },
];

it('o "a partir de" soma as opções mais baratas dos grupos obrigatórios', () => {
  assert.equal(precoBaseCombo(grupos), 13);
});

it('o valor do combo soma as escolhas e aplica o fator do cardápio', () => {
  const escolhas = { g1: ['boi'], g2: ['farofa'], g3: ['refri'] };
  assert.equal(precoEscolhasCombo(grupos, escolhas, 1), 21);
  assert.equal(precoEscolhasCombo(grupos, escolhas, fatorPrecoCombo(15.6, 13)), 25.2);
  assert.deepEqual(resumoEscolhasCombo(grupos, escolhas), ['Boi', '2× Farofa', 'Refri']);
});

it('o combo só fica completo com o mínimo de cada grupo', () => {
  assert.equal(escolhasCompletas(grupos, { g1: ['boi'] }), false);
  assert.equal(escolhasCompletas(grupos, { g1: ['boi'], g2: ['arroz'] }), true);
  assert.equal(fatorPrecoCombo(10, 0), 1);
});
