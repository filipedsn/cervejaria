import type { RankingEntry, RankingResponse } from '../types';

const DEMO_NOMES = [
  'Poliana',
  'Filipe',
  'Marcos',
  'Ana Clara',
  'Ricardo',
  'Juliana',
  'Bruno',
  'Camila',
  'Diego',
  'Fernanda',
  'Gustavo',
  'Helena',
  'Igor',
  'Larissa',
  'Mateus',
  'Natália',
  'Otávio',
  'Patrícia',
  'Renato',
  'Sofia',
  'Thiago',
  'Vanessa',
  'Wesley',
  'Yasmin',
  'Zeca',
];

export function buildDemoRanking(count = 20): RankingEntry[] {
  const total = Math.min(Math.max(count, 1), DEMO_NOMES.length);

  return Array.from({ length: total }, (_, index) => {
    const posicao = index + 1;
    const baseMl = 4200 - index * 175 + (index % 3) * 40;
    const totalMl = Math.max(300, baseMl);
    const pedidos = Math.max(1, Math.round(totalMl / 500));
    const totalValor = pedidos * (14.5 + (index % 4) * 2.25);

    return {
      posicao,
      clienteId: `demo-${posicao}`,
      nome: DEMO_NOMES[index],
      telefone: null,
      totalMl,
      totalValor: Math.round(totalValor * 100) / 100,
      pedidos,
    };
  });
}

export function buildDemoRankingResponse(count = 20): RankingResponse {
  return {
    evento: {
      id: 'demo',
      nome: 'Copa do Mundo — Jogo do Brasil x Marrocos',
      local: 'Igarapé',
      data: new Date().toISOString().slice(0, 10),
    },
    ranking: buildDemoRanking(count),
  };
}
