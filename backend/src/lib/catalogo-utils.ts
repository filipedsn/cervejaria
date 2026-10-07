import { prisma } from './prisma.js';

export async function produtoEmComandaAberta(produtoId: string, cervejariaId: string) {
  const count = await prisma.itemComanda.count({
    where: {
      produtoId,
      comanda: {
        status: 'ABERTA',
        evento: { cervejariaId },
      },
    },
  });
  return count > 0;
}

export async function produtoJaVendido(produtoId: string) {
  const count = await prisma.itemComanda.count({ where: { produtoId } });
  return count > 0;
}

export async function produtoJaUsadoEmMontagemDeTap(produtoId: string) {
  const count = await prisma.tapMontagem.count({ where: { produtoId } });
  return count > 0;
}

export async function assertProdutoPodeExcluir(produtoId: string, cervejariaId: string) {
  if (await produtoEmComandaAberta(produtoId, cervejariaId)) {
    return 'Este item está em uma comanda aberta e não pode ser excluído.';
  }
  if (await produtoJaVendido(produtoId)) {
    return 'Este item já foi vendido e não pode ser excluído. Desative-o para ocultar das vendas.';
  }
  if (await produtoJaUsadoEmMontagemDeTap(produtoId)) {
    return 'Este item já foi usado na montagem de um tap e não pode ser excluído. Desative-o para ocultar das vendas.';
  }
  return null;
}

export async function assertTapPodeExcluir(tap: { id: string; produtoId: string | null }, cervejariaId: string) {
  if (tap.produtoId && (await produtoEmComandaAberta(tap.produtoId, cervejariaId))) {
    return 'A bebida deste tap está em uma comanda aberta e o tap não pode ser excluído.';
  }
  if (await prisma.tapMontagem.count({ where: { tapId: tap.id } })) {
    return 'Este Tap possui histÃ³rico de montagens e nÃ£o pode ser excluÃ­do. Desative-o para ocultar das vendas.';
  }
  return null;
}
