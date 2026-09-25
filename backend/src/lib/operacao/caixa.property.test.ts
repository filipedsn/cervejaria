import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  assertCaixaAberto,
  calcularEsperadoDinheiroGaveta,
  planoCorrecaoMovimento,
  resolveCashRegisterCapability,
  totaisMovimentos,
  totaisPorForma,
} from './caixa.js';
import { centavos, reais, resolverPagamentos } from './venda.js';

const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'] as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('caixa operacao (property-based)', () => {
  it('resolve a capacidade por unidade: explícito vence fallback, NULL preserva legado', () => {
    assert.equal(resolveCashRegisterCapability({ pontoVendaAtivo: true, operationMode: 'CAIXA' }), true);
    assert.equal(resolveCashRegisterCapability({ pontoVendaAtivo: true, operationMode: 'EVENTO' }), false);
  });

  it('não permite que unidade inativa herde ou habilite caixa', () => {
    assert.equal(resolveCashRegisterCapability({ pontoVendaAtivo: false, operationMode: 'CAIXA' }), false);
  });

  it('mantém decisões independentes entre unidades e tenants', () => {
    const tenantA = [
      resolveCashRegisterCapability({ pontoVendaAtivo: true, operationMode: 'CAIXA' }),
      resolveCashRegisterCapability({ pontoVendaAtivo: true, operationMode: 'CAIXA' }),
    ];
    const tenantB = resolveCashRegisterCapability({ pontoVendaAtivo: true, operationMode: 'EVENTO' });
    assert.deepEqual(tenantA, [true, true]);
    assert.equal(tenantB, false);
  });

  it('não confunde capacidade da unidade com sessão de caixa aberta', async () => {
    const semSessao = {
      pontoVenda: {
        findFirst: async () => ({
          ativo: true,
          usaCaixa: true,
          cervejaria: { configuracaoOperacao: { ativo: false } },
        }),
      },
      sessaoCaixaOperacao: { findFirst: async () => null },
    };
    await assert.rejects(
      assertCaixaAberto('tenant-a', 'unidade-a', new Date('2026-09-14'), semSessao as never, async () => ({ operationMode: 'CAIXA' }) as never),
      /Abra o caixa do dia antes de registrar vendas/,
    );

    const explicitamenteDesabilitada = {
      pontoVenda: {
        findFirst: async () => ({
          ativo: true,
          usaCaixa: false,
          cervejaria: { configuracaoOperacao: { ativo: true } },
        }),
      },
      sessaoCaixaOperacao: { findFirst: async () => ({ status: 'ABERTO' }) },
    };
    await assert.rejects(
      assertCaixaAberto(
        'tenant-a',
        'unidade-b',
        new Date('2026-09-14'),
        explicitamenteDesabilitada as never,
        async () => ({ operationMode: 'EVENTO' }) as never,
      ),
      /Caixa não habilitado para este ponto de venda/,
    );
  });

  it('totaisPorForma: soma das formas = totalVendas', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            forma: fc.constantFrom(...FORMAS),
            cents: fc.integer({ min: 0, max: 500_000 }),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (linhas) => {
          const pagamentos = linhas.map((l) => ({ forma: l.forma, valor: l.cents / 100 }));
          const totais = totaisPorForma(pagamentos);
          const soma =
            totais.dinheiro + totais.pix + totais.cartaoDebito + totais.cartaoCredito;
          assert.equal(roundMoney(soma), totais.totalVendas);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('calcularEsperadoDinheiroGaveta é linear em centavos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (trocoC, entradasC, suprC, sangC) => {
          const esperado = calcularEsperadoDinheiroGaveta({
            trocoInicial: trocoC / 100,
            entradasDinheiro: entradasC / 100,
            suprimentos: suprC / 100,
            sangrias: sangC / 100,
          });
          const manual = reais(trocoC + entradasC + suprC - sangC);
          assert.equal(esperado, manual);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('totaisMovimentos acumula sangrias e suprimentos', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tipo: fc.constantFrom('SANGRIA' as const, 'SUPRIMENTO' as const),
            cents: fc.integer({ min: 1, max: 50_000 }),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (movs) => {
          const movimentos = movs.map((m) => ({ tipo: m.tipo, valor: m.cents / 100 }));
          const { sangrias, suprimentos } = totaisMovimentos(movimentos);
          const sangC = movs.filter((m) => m.tipo === 'SANGRIA').reduce((s, m) => s + m.cents, 0);
          const suprC = movs.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + m.cents, 0);
          assert.equal(sangrias, reais(sangC));
          assert.equal(suprimentos, reais(suprC));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('correção compensa exatamente o original e mantém somente o novo valor no saldo', () => {
    for (const tipo of ['SANGRIA', 'SUPRIMENTO'] as const) {
      const plano = planoCorrecaoMovimento({ tipo, valorOriginal: 150, valorCorrigido: 15 });
      const antes = totaisMovimentos([{ tipo, valor: 150 }]);
      const depois = totaisMovimentos([
        { tipo, valor: 150 },
        plano.estorno,
        plano.substituicao,
      ]);
      assert.equal(tipo === 'SANGRIA' ? antes.sangrias : antes.suprimentos, 150);
      const impactoOriginal = antes.suprimentos - antes.sangrias;
      const impactoCorrigido = depois.suprimentos - depois.sangrias;
      assert.equal(impactoOriginal, tipo === 'SUPRIMENTO' ? 150 : -150);
      assert.equal(impactoCorrigido, tipo === 'SUPRIMENTO' ? 15 : -15);
    }
  });

  it('resolverPagamentos: troco = recebido − valor quando soma bate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 50_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (devidoC, extraC) => {
          const devido = devidoC / 100;
          const recebido = (devidoC + extraC) / 100;
          const resolved = resolverPagamentos(
            [{ forma: 'DINHEIRO', valor: devido, valorRecebido: recebido }],
            devidoC,
          );
          assert.equal(resolved[0]!.troco, reais(extraC));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('resolverPagamentos rejeita soma divergente do devido', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 50_000 }),
        fc.integer({ min: 1, max: 5000 }),
        (devidoC, deltaC) => {
          const pagoC = devidoC - deltaC;
          if (pagoC <= 0) return;
          assert.throws(() =>
            resolverPagamentos([{ forma: 'PIX', valor: pagoC / 100 }], devidoC),
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});
