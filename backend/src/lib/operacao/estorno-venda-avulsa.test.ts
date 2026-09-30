import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma } from '@prisma/client';
import { distribuirEstorno, estornarVendaAvulsaFechada } from './estorno-venda-avulsa.js';
import { totaisPorForma } from './caixa.js';
import { resumoCaixaEvento } from '../evento-caixa.js';

test('lançamento negativo reduz o esperado do caixa em CAIXA e EVENTO', () => {
  const pagamentos = [
    { forma: 'PIX' as const, valor: 14 },
    { forma: 'PIX' as const, valor: -14 },
  ];
  assert.deepEqual(totaisPorForma(pagamentos).pix, 0);
  const sessao = {
    id: 'caixa', eventoId: 'evento', status: 'ABERTO', trocoInicial: 0,
    abertoEm: new Date(), fechadoEm: null,
    contadoDinheiro: null, contadoPix: null, contadoDebito: null,
    contadoCredito: null, contadoCartao: null, observacaoFechamento: null,
    movimentos: [], pagamentos,
  } as unknown as Parameters<typeof resumoCaixaEvento>[0];
  assert.equal(resumoCaixaEvento(sessao)?.esperado.PIX, 0);
});

test('distribui estorno entre formas sem exceder saldo e preserva centavos', () => {
  assert.deepEqual(
    distribuirEstorno([
      { forma: 'PIX', valor: 10 },
      { forma: 'DINHEIRO', valor: 5 },
      { forma: 'PIX', valor: -2 },
    ], 1100),
    [{ forma: 'PIX', valor: -8 }, { forma: 'DINHEIRO', valor: -3 }],
  );
  assert.throws(() => distribuirEstorno([{ forma: 'PIX', valor: 2 }], 300), /insuficientes/);
});

test('cancela item pago: ajusta total e desconto e lança estorno no caixa atual', async () => {
  const pagamentosCriados: unknown[] = [];
  const atualizacoes: unknown[] = [];
  const tx = {
    comanda: {
      findUniqueOrThrow: async () => ({
        id: 'venda', tipo: 'AVULSA', status: 'FECHADA', total: 23, desconto: 2,
        itens: [
          { precoUnit: 15, quantidade: 1, cancelamentoPendenteEm: new Date(), canceladoEm: null },
          { precoUnit: 10, quantidade: 1, cancelamentoPendenteEm: null, canceladoEm: null },
        ],
        pagamentos: [{ forma: 'PIX', valor: 23 }],
      }),
      update: async (input: unknown) => { atualizacoes.push(input); },
    },
    pagamento: { createMany: async (input: unknown) => { pagamentosCriados.push(input); } },
  } as unknown as Prisma.TransactionClient;

  const resultado = await estornarVendaAvulsaFechada(tx, {
    comandaId: 'venda', registradoPorId: 'dono', sessaoCaixaId: 'caixa-atual',
  });
  assert.deepEqual(resultado, { valorEstornado: 15, totalNovo: 8 });
  assert.deepEqual(pagamentosCriados, [{ data: [{
    comandaId: 'venda', forma: 'PIX', valor: -15, registradoPorId: 'dono',
    sessaoCaixaId: 'caixa-atual', sessaoCaixaEventoId: null,
  }] }]);
  assert.deepEqual(atualizacoes, [{ where: { id: 'venda' }, data: { total: 8, desconto: 2 } }]);
});

test('estorno integral zera o caixa e cancela a venda; divergência financeira bloqueia', async () => {
  let criado = 0;
  let atualizado: unknown;
  const venda = {
    id: 'venda', tipo: 'AVULSA', status: 'FECHADA', total: 14, desconto: 0,
    itens: [{ precoUnit: 14, quantidade: 1, cancelamentoPendenteEm: new Date(), canceladoEm: null }],
    pagamentos: [{ forma: 'DINHEIRO', valor: 14 }],
  };
  const tx = {
    comanda: {
      findUniqueOrThrow: async () => venda,
      update: async (input: unknown) => { atualizado = input; },
    },
    pagamento: { createMany: async () => { criado += 1; } },
  } as unknown as Prisma.TransactionClient;
  await estornarVendaAvulsaFechada(tx, { comandaId: 'venda', registradoPorId: 'dono', sessaoCaixaEventoId: 'evento' });
  assert.equal(criado, 1);
  assert.deepEqual(atualizado, { where: { id: 'venda' }, data: { total: 0, desconto: 0, status: 'CANCELADA' } });

  venda.pagamentos[0].valor = 13;
  await assert.rejects(
    () => estornarVendaAvulsaFechada(tx, { comandaId: 'venda', registradoPorId: 'dono' }),
    /saldo de pagamentos não confere/,
  );
  assert.equal(criado, 1);
});
