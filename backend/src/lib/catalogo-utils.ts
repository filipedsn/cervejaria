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

export async function assertProdutoPodeExcluir(produtoId: string, cervejariaId: string) {
  if (await produtoEmComandaAberta(produtoId, cervejariaId)) {
    return 'Este item está em uma comanda aberta e não pode ser excluído.';
  }
  if (await produtoJaVendido(produtoId)) {
    return 'Este item já foi vendido e não pode ser excluído. Desative-o para ocultar das vendas.';
  }
  return null;
}

export async function assertTapPodeExcluir(tap: { produtoId: string | null }, cervejariaId: string) {
  if (tap.produtoId && (await produtoEmComandaAberta(tap.produtoId, cervejariaId))) {
    return 'A bebida deste tap está em uma comanda aberta e o tap não pode ser excluído.';
  }
  return null;
}
