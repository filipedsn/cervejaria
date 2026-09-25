import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { baixarEstoqueDoPedido, classificarEstoque } from './estoque.js';

describe('classificarEstoque', () => {
  it('mantém normal sem mínimo configurado', () => {
    assert.equal(classificarEstoque(3, null), 'NORMAL');
  });

  it('marca baixo no mínimo sem bloquear o saldo positivo', () => {
    assert.equal(classificarEstoque(3, 3), 'LOW');
  });

  it('marca esgotado independentemente do mínimo', () => {
    assert.equal(classificarEstoque(0, null), 'OUT_OF_STOCK');
    assert.equal(classificarEstoque(0, 3), 'OUT_OF_STOCK');
  });
});

describe('baixarEstoqueDoPedido', () => {
  it('mantém a venda sem movimentar saldo quando o módulo está desligado', async () => {
    let chamadasAoBanco = 0;
    const tx = new Proxy(
      {},
      {
        get: () => {
          chamadasAoBanco += 1;
          throw new Error('estoque não deveria ser acessado');
        },
      },
    ) as Prisma.TransactionClient;

    await baixarEstoqueDoPedido(tx, {
      moduloControlaEstoque: false,
      cervejariaId: 'tenant-a',
      pontoVendaId: 'ponto-a',
      pedidoId: 'pedido-a',
      registradoPorId: 'user-a',
      itens: [],
    });
    assert.equal(chamadasAoBanco, 0);
  });
});
