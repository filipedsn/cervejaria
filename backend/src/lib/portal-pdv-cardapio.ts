import { prisma } from './prisma.js';
import { isPortalCategoryAllowed, filterPortalCategories } from './portal-catalog.js';
import { isBebidaChopeOperacao } from './produto-utils.js';
import { listProdutosOperacionaisTurno } from './operacao/sessao-cardapio.js';
import { resolveUniqueOpenCashSession } from './operacao/cash-session-resolution.js';
import { listTapsComChopeAtualPdv } from './tap-montagem.js';
import { toNumber } from './utils.js';
import { CATEGORIA_CHOPE } from './produto-utils.js';

export type PortalPdvChope = {
  tapId: string;
  tapNumero: number;
  tapNome: string | null;
  produto: {
    id: string;
    nome: string;
    precos: Array<{ volumeMl: number; preco: number }>;
  };
};

/**
 * Cardápio do portal PDV: itens unitários + chopes no template de torneira
 * (mesmo padrão da aba Chopes do atendente / portal de evento).
 */
export async function buildPublicPdvCardapio(params: {
  cervejariaId: string;
  pontoVendaId: string;
  dia: Date;
  tapsEnabled: boolean;
  allowedCategories: string[] | null;
}): Promise<{ produtos: Awaited<ReturnType<typeof listProdutosOperacionaisTurno>>; chopes: PortalPdvChope[] }> {
  const { cervejariaId, pontoVendaId, dia, tapsEnabled, allowedCategories } = params;
  const produtos = await listProdutosOperacionaisTurno(cervejariaId, pontoVendaId, dia, tapsEnabled);
  const unitarios = filterPortalCategories(
    produtos.filter((produto) => !isBebidaChopeOperacao(produto)),
    allowedCategories,
  );

  const showChopes = tapsEnabled && isPortalCategoryAllowed(CATEGORIA_CHOPE, allowedCategories);
  if (!showChopes) return { produtos: unitarios, chopes: [] };

  const sessoes = await prisma.sessaoCaixaOperacao.findMany({
    where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
    orderBy: { abertoEm: 'desc' },
    select: { id: true },
    take: 2,
  });
  const sessao = resolveUniqueOpenCashSession(sessoes);
  if (!sessao) return { produtos: unitarios, chopes: [] };

  const taps = await listTapsComChopeAtualPdv(sessao.id, pontoVendaId, cervejariaId);
  const precosTurno = new Map<string, number>();
  for (const produto of produtos) {
    if (!isBebidaChopeOperacao(produto)) continue;
    const volumeMl = produto.volumeMl ?? 0;
    if (volumeMl <= 1) continue;
    const preco = typeof produto.precoEfetivo === 'number' ? produto.precoEfetivo : toNumber(produto.precoUnit);
    if (preco > 0) precosTurno.set(`${produto.id}:${volumeMl}`, preco);
  }

  const chopes: PortalPdvChope[] = taps
    .filter((tap) => tap.ativo && tap.chopeAtual)
    .map((tap) => {
      const produto = tap.chopeAtual!;
      const turnoPrecos = [...precosTurno.entries()]
        .filter(([key]) => key.startsWith(`${produto.id}:`))
        .map(([key, preco]) => ({ volumeMl: Number(key.slice(produto.id.length + 1)), preco }))
        .filter((row) => Number.isFinite(row.volumeMl) && row.volumeMl > 1 && row.preco > 0)
        .sort((a, b) => a.volumeMl - b.volumeMl);
      const catalogoPrecos = (produto.precos ?? [])
        .filter((row) => row.volumeMl > 1)
        .map((row) => ({
          volumeMl: row.volumeMl,
          preco: precosTurno.get(`${produto.id}:${row.volumeMl}`) ?? toNumber(row.preco),
        }))
        .filter((row) => row.preco > 0);
      return {
        tapId: tap.id,
        tapNumero: tap.numero,
        tapNome: tap.nome,
        produto: {
          id: produto.id,
          nome: produto.nome,
          precos: turnoPrecos.length > 0 ? turnoPrecos : catalogoPrecos,
        },
      };
    })
    .filter((chope) => chope.produto.precos.length > 0);

  return { produtos: unitarios, chopes };
}
