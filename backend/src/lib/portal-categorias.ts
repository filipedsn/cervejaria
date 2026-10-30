import { prisma } from './prisma.js';
import {
  filtrarCategoriaChopeSeTapsDesligados,
  tapsEnabledDaCervejaria,
} from './operacao/categoria-chope-torneiras.js';

export { CATEGORIA_CHOPE, categoriaParaAlertaBalcao } from './produto-utils.js';
export {
  categoriasElegiveisAlertaBalcao,
  categoriasVisiveisNoPortal,
} from './portal-categorias-policy.js';

/**
 * Categorias selecionáveis no portal / alerta de balcão.
 * "Chope" só aparece com torneiras habilitadas (a categoria é criada no toggle).
 */
export async function listCategoriasEstabelecimento(cervejariaId: string): Promise<string[]> {
  const [categories, legacyCategories, tapsEnabled] = await Promise.all([
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
    tapsEnabledDaCervejaria(cervejariaId),
  ]);

  const names = new Set<string>([
    ...categories.map((category) => category.nome),
    ...legacyCategories
      .map((category) => category.categoria)
      .filter((name): name is string => Boolean(name)),
    'Outros',
  ]);
  return filtrarCategoriaChopeSeTapsDesligados([...names], tapsEnabled).sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
}
