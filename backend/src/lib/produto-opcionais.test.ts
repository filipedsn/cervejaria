import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { resolverOpcionais } from './produto-opcionais.js';

function fakeTx(vinculos: unknown[]) {
  return { produtoOpcionalVinculo: { findMany: async () => vinculos } } as unknown as Prisma.TransactionClient;
}

describe('resolverOpcionais', () => {
  it('recusa opcional não vinculado com erro de validação 400', async () => {
    await assert.rejects(
      resolverOpcionais(fakeTx([]), 'produto-1', [{ opcionalId: 'opcional-x' }]),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && err.message === 'Opcional não vinculado a este produto',
    );
  });

  it('recusa quantidade de opcional inválida com erro de validação 400', async () => {
    const vinculo = { opcionalId: 'opcional-1', opcional: { id: 'opcional-1', nome: 'Bacon', preco: 3 } };
    await assert.rejects(
      resolverOpcionais(fakeTx([vinculo]), 'produto-1', [{ opcionalId: 'opcional-1', quantidade: 0 }]),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && err.message === 'Quantidade de opcional inválida',
    );
  });

  it('resolve opcional vinculado com preço adicional', async () => {
    const vinculo = { opcionalId: 'opcional-1', opcional: { id: 'opcional-1', nome: 'Bacon', preco: 3 } };
    const [resolvido] = await resolverOpcionais(fakeTx([vinculo]), 'produto-1', [{ opcionalId: 'opcional-1', quantidade: 2 }]);
    assert.equal(resolvido.precoAdicional, 3);
    assert.equal(resolvido.quantidade, 2);
  });
});
