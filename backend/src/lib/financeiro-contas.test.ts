import assert from 'node:assert/strict';
import test from 'node:test';
import { resumoFinanceiroComandas } from './financeiro-contas.js';
import { buildRelatorioEventoCsv } from './relatorio-evento-csv.js';

test('separa venda, recebimento parcial, saldo a receber e valor sem conciliação', () => {
  const resumo = resumoFinanceiroComandas([
    { total: 30, contaReceber: { valorOriginal: 30 }, pagamentos: [{ forma: 'PIX', valor: 10 }] },
    { total: 5, pagamentos: [] },
  ]);
  assert.equal(resumo.vendido, 35);
  assert.equal(resumo.recebido, 10);
  assert.equal(resumo.aReceber, 20);
  assert.equal(resumo.naoConciliado, 5);
  assert.deepEqual(resumo.porPagamento, [{ forma: 'PIX', valor: 10, percentual: 100 }]);
});

test('CSV registra valores financeiros apenas uma vez por comanda com vários itens', () => {
  const csv = buildRelatorioEventoCsv([{
    id: 'comanda-1', total: 30, fechadaEm: new Date('2026-09-01T20:00:00Z'), updatedAt: new Date('2026-09-01T20:00:00Z'),
    cliente: { nome: 'Cliente', telefone: null }, contaReceber: { valorOriginal: 30 },
    pagamentos: [{ forma: 'PIX', valor: 10, pagoEm: new Date('2026-10-02T12:00:00Z') }],
    itens: [
      { nome: 'Item A', volumeMl: 0, quantidade: 1, precoUnit: 10, produto: null },
      { nome: 'Item B', volumeMl: 0, quantidade: 1, precoUnit: 20, produto: null },
    ],
  }]);
  const [header, first, second] = csv.replace(/^\uFEFF/, '').split('\n')
    .map((line) => line.split(',').map((field) => field.replace(/^"|"$/g, '')));
  assert.equal(header.length, 15);
  assert.equal(first[8], '10.00');
  assert.equal(first[11], '30.00');
  assert.equal(first[12], '20.00');
  assert.equal(first[14], '2026-10-02T12:00:00.000Z');
  assert.equal(second[8], '');
  assert.equal(second[11], '');
  assert.equal(second[12], '');
});
