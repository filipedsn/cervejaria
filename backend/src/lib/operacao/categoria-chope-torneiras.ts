import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { CATEGORIA_CHOPE } from '../produto-utils.js';
import { normalizarNomeCategoria } from './catalogo-categorias.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../canonical-pdv-operational-config.js';

function isNomeChope(value: string): boolean {
  return value.trim().toLocaleLowerCase('pt-BR') === 'chope';
}

export function filtrarCategoriaChopeSeTapsDesligados<T extends string>(
  categorias: readonly T[],
  tapsEnabled: boolean,
): T[] {
  if (tapsEnabled) return [...categorias];
  return categorias.filter((name) => !isNomeChope(name));
}

export async function tapsEnabledDaCervejaria(cervejariaId: string): Promise<boolean> {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId);
  if (canonical) return canonical.tapsEnabled === true;
  const legacy = await prisma.configuracaoOperacional.findUnique({
    where: { cervejariaId },
    select: { tapsEnabled: true },
  });
  return legacy?.tapsEnabled === true;
}

/**
 * Ao habilitar torneiras: garante a categoria PDV "Chope" e vincula chopes
 * sem categoria. Ao desabilitar: não apaga a categoria (produtos podem
 * continuar vinculados); a invisibilidade fica nos listadores.
 */
export async function syncCategoriaChopeComTorneiras(
  cervejariaId: string,
  tapsEnabled: boolean,
): Promise<void> {
  const nomeNormalizado = normalizarNomeCategoria(CATEGORIA_CHOPE);

  if (tapsEnabled) {
    const category = await prisma.categoriaProdutoPdv.upsert({
      where: { cervejariaId_nomeNormalizado: { cervejariaId, nomeNormalizado } },
      create: {
        cervejariaId,
        nome: CATEGORIA_CHOPE,
        nomeNormalizado,
        gamificada: false,
      },
      update: {},
      select: { id: true, nome: true },
    });

    await prisma.produto.updateMany({
      where: {
        cervejariaId,
        tipo: 'BEBIDA',
        formato: 'CHOPE',
        categoriaPdvId: null,
      },
      data: {
        categoriaPdvId: category.id,
        categoria: category.nome,
      },
    });
    return;
  }

  const brewery = await prisma.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: {
      portalCategoriasPermitidas: true,
      portalAlertaBalcaoCategorias: true,
    },
  });
  if (!brewery) return;

  const strip = (value: unknown): string[] | null | undefined => {
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === 'string' && !isNomeChope(item));
  };

  const permitidas = strip(brewery.portalCategoriasPermitidas);
  const alerta = strip(brewery.portalAlertaBalcaoCategorias);
  if (permitidas === undefined && alerta === undefined) return;

  await prisma.cervejaria.update({
    where: { id: cervejariaId },
    data: {
      ...(permitidas !== undefined ? { portalCategoriasPermitidas: permitidas } : {}),
      ...(alerta !== undefined
        ? { portalAlertaBalcaoCategorias: alerta.length > 0 ? alerta : Prisma.DbNull }
        : {}),
    },
  });
}
