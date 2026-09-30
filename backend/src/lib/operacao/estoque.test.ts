import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { baixarEstoqueDoPedido, classificarEstoque, estornarEstoqueItemPedido } from './estoque.js';

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

describe('estornarEstoqueItemPedido', () => {
  it('devolve somente o item cancelado e seu opcional ao saldo e ao movimento', async () => {
    const entradas: Array<{ produtoId: string; quantidade: number }> = [];
    const movimentos: Array<{ produtoId: string; quantidade: number; tipo: string }> = [];
    const tx = {
      $executeRaw: async () => 1,
      inventoryBalance: {
        upsert: async () => ({}),
        update: async ({ where, data }: { where: { pontoVendaId_produtoId: { produtoId: string } }; data: { quantidade: { increment: number } } }) => {
          entradas.push({ produtoId: where.pontoVendaId_produtoId.produtoId, quantidade: data.quantidade.increment });
        },
      },
      inventoryMovement: { create: async ({ data }: { data: { produtoId: string; quantidade: number; tipo: string } }) => { movimentos.push(data); } },
      produto: { findFirst: async () => ({ nome: 'Molho', controlaEstoque: true }) },
    } as unknown as Prisma.TransactionClient;

    await estornarEstoqueItemPedido(tx, {
      moduloControlaEstoque: true, cervejariaId: 'empresa', pontoVendaId: 'ponto', pedidoId: 'pedido',
      produtoId: 'boi', nome: 'Boi', quantidade: 2, controlaEstoque: true,
      registradoPorId: 'dono', opcionais: [{ produtoEstoqueId: 'molho', quantidade: 1 }],
    });
    assert.deepEqual(entradas, [
      { produtoId: 'boi', quantidade: 2 },
      { produtoId: 'molho', quantidade: 2 },
    ]);
    assert.deepEqual(movimentos.map(({ produtoId, quantidade, tipo }) => ({ produtoId, quantidade, tipo })), [
      { produtoId: 'boi', quantidade: 2, tipo: 'ESTORNO_VENDA' },
      { produtoId: 'molho', quantidade: 2, tipo: 'ESTORNO_VENDA' },
    ]);
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
