import assert from 'node:assert/strict';
import test from 'node:test';
import { agregarMetricasMes, listarMesesAdmin, resolverMesAdmin } from './cervejaria-stats.js';

// 2026-11-02 02:30 UTC = 2026-11-01 23:30 em Brasília.
const now = new Date('2026-11-02T02:30:00Z');

test('mês padrão segue o calendário de Brasília, não o UTC do servidor', () => {
  const mes = resolverMesAdmin(undefined, now);
  assert.equal(mes?.chave, '2026-11');
  assert.equal(mes?.inicio.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(mes?.fimExclusivo.toISOString(), '2026-12-01T03:00:00.000Z');
});

test('o intervalo inclui o último dia do mês inteiro', () => {
  const outubro = resolverMesAdmin('2026-10', now)!;
  const ultimoMinuto = new Date('2026-11-01T02:59:00Z'); // 31/10 23:59 BRT
  assert.ok(ultimoMinuto >= outubro.inicio && ultimoMinuto < outubro.fimExclusivo);
  const viradaBrt = new Date('2026-11-01T03:00:00Z'); // 01/11 00:00 BRT
  assert.ok(!(viradaBrt < outubro.fimExclusivo));
});

test('dezembro termina na virada para janeiro do ano seguinte', () => {
  const dezembro = resolverMesAdmin('2025-12', now)!;
  assert.equal(dezembro.fimExclusivo.toISOString(), '2026-01-01T03:00:00.000Z');
});

test('chave inválida ou mês futuro é recusado', () => {
  for (const chave of ['2026-13', '2026-1', 'outubro', '2026-12', '2027-01']) {
    assert.equal(resolverMesAdmin(chave, now), null, chave);
  }
});

test('meses do seletor vão do atual até o mês da primeira venda', () => {
  const meses = listarMesesAdmin(new Date('2026-08-15T12:00:00Z'), now);
  assert.deepEqual(meses.map((m) => m.chave), ['2026-11', '2026-10', '2026-09', '2026-08']);
  assert.deepEqual(listarMesesAdmin(null, now).map((m) => m.chave), ['2026-11']);
});

test('agrega comandas de evento e de caixa por empresa e escolhe o mais vendido', () => {
  const metricas = agregarMetricasMes(
    { chave: '2026-10', label: 'out. de 2026' },
    [
      { id: 'evento-1', total: '10.10', cervejariaId: 'cia' },
      { id: 'caixa-1', total: 20.2, cervejariaId: 'cia' },
      { id: 'caixa-2', total: '58678.00', cervejariaId: 'churrasquinho' },
      { id: 'orfa', total: 999, cervejariaId: null },
    ],
    [
      { comandaId: 'evento-1', produtoId: 'pilsen', quantidade: 2 },
      { comandaId: 'caixa-1', produtoId: 'ipa', quantidade: 3 },
      { comandaId: 'caixa-1', produtoId: 'pilsen', quantidade: 2 },
      { comandaId: 'caixa-2', produtoId: 'espeto', quantidade: 5 },
      { comandaId: 'orfa', produtoId: 'ipa', quantidade: 50 },
    ],
    new Map([['pilsen', 'Pilsen'], ['ipa', 'IPA'], ['espeto', 'Espeto']]),
  );

  assert.deepEqual(metricas.get('cia'), {
    chave: '2026-10',
    mes: 'out. de 2026',
    faturamento: 30.3,
    comandasAtendidas: 2,
    tiposProduto: 2,
    produtoMaisVende: 'Pilsen',
  });
  assert.equal(metricas.get('churrasquinho')?.faturamento, 58678);
  assert.equal(metricas.get('churrasquinho')?.produtoMaisVende, 'Espeto');
  assert.equal(metricas.size, 2);
});

test('empate no mais vendido é resolvido pelo nome em ordem alfabética', () => {
  const metricas = agregarMetricasMes(
    { chave: '2026-10', label: 'out. de 2026' },
    [{ id: 'c1', total: 10, cervejariaId: 'a' }],
    [
      { comandaId: 'c1', produtoId: 'z', quantidade: 1 },
      { comandaId: 'c1', produtoId: 'b', quantidade: 1 },
    ],
    new Map([['z', 'Weiss'], ['b', 'Bock']]),
  );
  assert.equal(metricas.get('a')?.produtoMaisVende, 'Bock');
});
