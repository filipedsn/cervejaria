import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { atribuirTapMontado } from './venda.js';

function fakeTx(montagens: Record<string, string>) {
  const consultas: unknown[] = [];
  const tx = {
    tapMontagem: {
      findFirst: async (args: { where: { produtoId: string } }) => {
        consultas.push(args);
        const tapId = montagens[args.where.produtoId];
        return tapId ? { tapId } : null;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, consultas };
}

describe('atribuirTapMontado', () => {
  it('usa o tap em que o chope está montado no turno', async () => {
    const { tx, consultas } = fakeTx({ chope: 'tap-1' });
    const [item] = await atribuirTapMontado(tx, 'sessao-1', [{ produtoId: 'chope', quantidade: 1, volumeMl: 500 }]);
    assert.equal(item.tapId, 'tap-1');
    assert.equal(item.volumeMl, 500);
    assert.deepEqual((consultas[0] as { where: unknown }).where, { sessaoCaixaId: 'sessao-1', produtoId: 'chope', encerradoEm: null, tap: { ativo: true } });
  });

  it('não altera itens sem volume nem itens que já informam o tap', async () => {
    const { tx, consultas } = fakeTx({});
    const itens = [{ produtoId: 'lata', quantidade: 2 }, { produtoId: 'chope', quantidade: 1, volumeMl: 300, tapId: 'tap-9' }];
    assert.deepEqual(await atribuirTapMontado(tx, 'sessao-1', itens), itens);
    assert.equal(consultas.length, 0);
  });

  it('recusa chope que não está montado em nenhum tap do turno', async () => {
    const { tx } = fakeTx({});
    await assert.rejects(
      atribuirTapMontado(tx, 'sessao-1', [{ produtoId: 'chope', quantidade: 1, volumeMl: 500 }]),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && err.message === 'Este chope não está sendo servido agora',
    );
  });
});
