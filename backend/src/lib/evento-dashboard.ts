import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import type { FormatoBebida, ProdutoTipo } from '@prisma/client';

type ProdutoAgg = {
  produtoId: string;
  nome: string;
  tipo: ProdutoTipo;
  formato: FormatoBebida | null;
  volumeMl: number;
  quantidade: number;
  valor: number;
};

function itemKey(produtoId: string, volumeMl: number) {
  return `${produtoId}:${volumeMl}`;
}

function addItem(map: Map<string, ProdutoAgg>, item: {
  produtoId: string;
  volumeMl: number;
  quantidade: number;
  precoUnit: { toString(): string };
  produto: { nome: string; tipo: ProdutoTipo; formato: FormatoBebida | null };
}) {
  const key = itemKey(item.produtoId, item.volumeMl);
  const current = map.get(key) ?? {
    produtoId: item.produtoId,
    nome: item.produto.nome,
    tipo: item.produto.tipo,
    formato: item.produto.formato,
    volumeMl: item.volumeMl,
    quantidade: 0,
    valor: 0,
  };
  current.quantidade += item.quantidade;
  current.valor += toNumber(item.precoUnit) * item.quantidade;
  map.set(key, current);
}

function mapToSortedArray(map: Map<string, ProdutoAgg>) {
  return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
}

export async function buildEventoDashboard(eventoId: string, cervejariaId: string) {
  const evento = await prisma.evento.findFirst({
    where: { id: eventoId, cervejariaId },
    select: { id: true, nome: true, local: true, data: true, horaInicio: true, horaFim: true, status: true },
  });

  if (!evento) return null;

  const comandas = await prisma.comanda.findMany({
    where: { eventoId },
    include: {
      itens: { include: { produto: true } },
    },
  });

  let comandasAbertas = 0;
  let comandasFechadas = 0;
  let vendasAvulsas = 0;
  let valorAberto = 0;
  let valorFechado = 0;
  let receitaAvulsa = 0;
  const aberto = new Map<string, ProdutoAgg>();
  const fechado = new Map<string, ProdutoAgg>();

  for (const comanda of comandas) {
    const isAvulsa = comanda.tipo === 'AVULSA';
    if (comanda.status === 'ABERTA') {
      if (!isAvulsa) {
        comandasAbertas += 1;
        valorAberto += toNumber(comanda.total);
        for (const item of comanda.itens) addItem(aberto, item);
      }
    } else if (comanda.status === 'FECHADA') {
      if (isAvulsa) {
        vendasAvulsas += 1;
        receitaAvulsa += toNumber(comanda.total);
      } else {
        comandasFechadas += 1;
        valorFechado += toNumber(comanda.total);
      }
      for (const item of comanda.itens) addItem(fechado, item);
    }
  }

  return {
    evento,
    resumo: {
      comandasAbertas,
      comandasFechadas,
      vendasAvulsas,
      valorAberto,
      valorFechado,
      receitaAvulsa,
    },
    porProduto: {
      aberto: mapToSortedArray(aberto),
      fechado: mapToSortedArray(fechado),
    },
  };
}
