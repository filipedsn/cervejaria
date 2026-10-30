import { prisma } from './prisma.js';
import { CATEGORIA_CHOPE } from './produto-utils.js';

export { CATEGORIA_CHOPE, categoriaParaAlertaBalcao } from './produto-utils.js';

/**
 * Categorias selecionáveis no portal / alerta de balcão.
 * Inclui "Chope" quando há produto de chope ativo (formato CHOPE ou categoria Chope),
 * mesmo sem linha em categoriaProdutoPdv — caso típico de PDV só com torneiras.
 */
export async function listCategoriasEstabelecimento(cervejariaId: string): Promise<string[]> {
  const [categories, legacyCategories, chopeCount] = await Promise.all([
    prisma.categoriaProdutoPdv.findMany({
      where: { cervejariaId },
      orderBy: [{ nomeNormalizado: 'asc' }, { nome: 'asc' }],
      select: { nome: true },
    }),
    prisma.produto.findMany({
      where: { cervejariaId, ativo: true, categoria: { not: null } },
      distinct: ['categoria'],
      select: { categoria: true },
    }),
    prisma.produto.count({
      where: {
        cervejariaId,
        ativo: true,
        tipo: 'BEBIDA',
        OR: [
          { formato: 'CHOPE' },
          { formato: null, categoria: { equals: CATEGORIA_CHOPE, mode: 'insensitive' } },
        ],
      },
    }),
  ]);

  const names = new Set<string>([
    ...categories.map((category) => category.nome),
    ...legacyCategories
      .map((category) => category.categoria)
      .filter((name): name is string => Boolean(name)),
    'Outros',
  ]);
  if (chopeCount > 0) names.add(CATEGORIA_CHOPE);
  return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
