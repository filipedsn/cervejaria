import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolverPagamentos, VendaInvalidaError } from './venda.js';

describe('resolverPagamentos', () => {
  it('aceita lista vazia quando o devido é zero (cortesia)', () => {
    assert.deepEqual(resolverPagamentos([], 0), []);
  });

  it('rejeita lista vazia quando o devido é positivo', () => {
    assert.throws(() => resolverPagamentos([], 100), (err: unknown) => {
      assert.ok(err instanceof VendaInvalidaError);
      assert.match(err.message, /Informe como o cliente pagou/);
      return true;
    });
  });

  it('rejeita soma divergente do devido (pagamento stale)', () => {
    assert.throws(
      () => resolverPagamentos([{ forma: 'PIX', valor: 10 }], 500),
      (err: unknown) => {
        assert.ok(err instanceof VendaInvalidaError);
        assert.match(err.message, /pagamentos somam/);
        return true;
      },
    );
  });

  it('aceita pagamento que quita o devido', () => {
    const resolved = resolverPagamentos([{ forma: 'PIX', valor: 12.5 }], 1250);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.valor, 12.5);
    assert.equal(resolved[0]!.troco, null);
  });
});
