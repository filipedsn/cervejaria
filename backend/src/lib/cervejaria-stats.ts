import { prisma } from './prisma.js';
import { toNumber } from './utils.js';

export interface MesAtualStats {
  mes: string;
  faturamento: number;
  comandasAtendidas: number;
  tiposProduto: number;
  produtoMaisVende: string | null;
}

function getMesAtualRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const mes = now.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
  return { start, end, mes };
}

export async function getStatsMesAtualPorCervejaria(): Promise<Map<string, MesAtualStats>> {
  const { start, end, mes } = getMesAtualRange();
  const result = new Map<string, MesAtualStats>();

  const comandas = await prisma.comanda.findMany({
    where: {
      status: 'FECHADA',
      evento: { data: { gte: start, lte: end } },
    },
    select: {
      total: true,
      evento: { select: { cervejariaId: true } },
      itens: {
        select: {
          quantidade: true,
          produtoId: true,
          produto: { select: { nome: true } },
        },
      },
    },
  });

  const byCervejaria = new Map<
    string,
    {
      faturamento: number;
      comandas: number;
      produtos: Map<string, { nome: string; qtd: number }>;
    }
  >();

  for (const comanda of comandas) {
    const cid = comanda.evento.cervejariaId;
    const current = byCervejaria.get(cid) ?? {
      faturamento: 0,
      comandas: 0,
      produtos: new Map(),
    };

    current.faturamento += toNumber(comanda.total);
    current.comandas += 1;

    for (const item of comanda.itens) {
      const p = current.produtos.get(item.produtoId) ?? {
        nome: item.produto.nome,
        qtd: 0,
      };
      p.qtd += item.quantidade;
      current.produtos.set(item.produtoId, p);
    }

    byCervejaria.set(cid, current);
  }

  for (const [cid, data] of byCervejaria) {
    let produtoMaisVende: string | null = null;
    let maxQtd = 0;
    for (const p of data.produtos.values()) {
      if (p.qtd > maxQtd) {
        maxQtd = p.qtd;
        produtoMaisVende = p.nome;
      }
    }

    result.set(cid, {
      mes,
      faturamento: data.faturamento,
      comandasAtendidas: data.comandas,
      tiposProduto: data.produtos.size,
      produtoMaisVende,
    });
  }

  return result;
}

export function emptyMesAtualStats(mes: string): MesAtualStats {
  return {
    mes,
    faturamento: 0,
    comandasAtendidas: 0,
    tiposProduto: 0,
    produtoMaisVende: null,
  };
}

export function getMesAtualLabel(): string {
  return getMesAtualRange().mes;
}
