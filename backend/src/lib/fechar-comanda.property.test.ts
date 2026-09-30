import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { allocatePagamentosToComandas, type PagamentoInput } from './fechar-comanda.js';

const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_DEBITO', 'CARTAO_CREDITO'] as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumPagamentos(map: Map<string, PagamentoInput[]>): number {
  let total = 0;
  for (const lines of map.values()) {
    for (const line of lines) total += line.valor;
  }
  return roundMoney(total);
}

const comandaArb = fc.uniqueArray(
  fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
    cents: fc.integer({ min: 1, max: 500_000 }),
  }),
  { minLength: 1, maxLength: 8, selector: (c) => c.id },
);

/** Divide centavos em linhas de pagamento sem sobra. */
function splitCentsToPagamentos(sumCents: number, lines: number, formas: typeof FORMAS): PagamentoInput[] {
  const n = Math.max(1, Math.min(lines, formas.length, sumCents));
  let remaining = sumCents;
  const out: PagamentoInput[] = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const cents = isLast ? remaining : Math.max(1, Math.floor(remaining / (n - i)));
    remaining -= cents;
    out.push({ forma: formas[i % formas.length]!, valor: cents / 100 });
  }
  return out;
}

describe('allocatePagamentosToComandas (property-based)', () => {
  it('rejeita diferença acumulada de centavos entre comandas e pagamentos', () => {
    const comandas = [
      { id: 'a', total: 2042.89 },
      { id: 'b', total: 0.01 },
    ];

    assert.throws(() =>
      allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 2042.88 }]),
    );
    assert.throws(() =>
      allocatePagamentosToComandas(comandas, [{ forma: 'PIX', valor: 2042.92 }]),
    );
  });

  it('preserva totais quando pool = soma das comandas', () => {
    fc.assert(
      fc.property(comandaArb, fc.integer({ min: 1, max: 6 }), (comandas, payLines) => {
        const totals = comandas.map((c) => ({ id: c.id, total: c.cents / 100 }));
        const sumCents = comandas.reduce((s, c) => s + c.cents, 0);
        const pagamentos = splitCentsToPagamentos(sumCents, payLines, FORMAS);

        const map = allocatePagamentosToComandas(totals, pagamentos);

        assert.equal(map.size, comandas.length);
        for (const comanda of totals) {
          const lines = map.get(comanda.id);
          assert.ok(lines);
          const allocated = roundMoney(lines!.reduce((s, p) => s + p.valor, 0));
          assert.equal(allocated, comanda.total);
          for (const line of lines!) {
            assert.ok(line.valor > 0);
          }
        }
        assert.equal(sumPagamentos(map), roundMoney(sumCents / 100));
      }),
      { numRuns: 300 },
    );
  });

  it('rejeita pool insuficiente ou com sobra', () => {
    fc.assert(
      fc.property(comandaArb, fc.integer({ min: 2, max: 5000 }), (comandas, deltaCents) => {
        const totals = comandas.map((c) => ({ id: c.id, total: c.cents / 100 }));
        const sum = roundMoney(comandas.reduce((s, c) => s + c.cents, 0) / 100);
        const delta = deltaCents / 100;
        const tooLow = roundMoney(sum - delta);
        const tooHigh = roundMoney(sum + delta);

        if (tooLow <= 0) return;

        assert.throws(() =>
          allocatePagamentosToComandas(totals, [{ forma: 'PIX', valor: tooLow }]),
        );
        assert.throws(() =>
          allocatePagamentosToComandas(totals, [{ forma: 'PIX', valor: tooHigh }]),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('é determinístico para mesma entrada', () => {
    fc.assert(
      fc.property(comandaArb, (comandas) => {
        const totals = comandas.map((c) => ({ id: c.id, total: c.cents / 100 }));
        const sumCents = comandas.reduce((s, c) => s + c.cents, 0);
        const pagamentos = splitCentsToPagamentos(sumCents, 2, FORMAS);

        const a = allocatePagamentosToComandas(totals, pagamentos);
        const b = allocatePagamentosToComandas(totals, pagamentos);
        assert.deepEqual([...a.entries()], [...b.entries()]);
      }),
      { numRuns: 100 },
    );
  });
});
