import type { Prisma } from '@prisma/client';

export type OpcionalSelecionadoInput = { opcionalId: string; quantidade?: number };
export type OpcionalResolvido = { opcionalId: string; nome: string; precoAdicional: number; quantidade: number; produtoEstoqueId: string | null; opcionalCatalogoId?: string };

export async function resolverOpcionais(tx: Prisma.TransactionClient, produtoId: string, selecionados?: OpcionalSelecionadoInput[]): Promise<OpcionalResolvido[]> {
  const entradas = selecionados ?? [];
  if (!entradas.length) return [];
  const ids = [...new Set(entradas.map((item) => item.opcionalId))];
  const vinculos = await tx.produtoOpcionalVinculo.findMany({ where: { produtoId, opcionalId: { in: ids }, opcional: { ativo: true } }, include: { opcional: true } });
  if (vinculos.length !== ids.length) throw new Error('Opcional não vinculado a este produto');
  const porId = new Map(vinculos.map((vinculo) => [vinculo.opcionalId, vinculo.opcional]));
  return entradas.map((entrada) => {
    const opcional = porId.get(entrada.opcionalId)!;
    const quantidade = entrada.quantidade ?? 1;
    if (!Number.isInteger(quantidade) || quantidade < 1) throw new Error('Quantidade de opcional inválida');
    return { opcionalId: opcional.id, nome: opcional.nome, precoAdicional: Number(opcional.preco), quantidade, produtoEstoqueId: null, opcionalCatalogoId: opcional.id };
  });
}

export async function listarOpcionaisProduto(prisma: Prisma.TransactionClient | typeof import('./prisma.js').prisma, produtoId: string) {
  return prisma.produtoOpcionalVinculo.findMany({ where: { produtoId, opcional: { ativo: true } }, include: { opcional: true }, orderBy: [{ ordem: 'asc' }, { opcional: { nome: 'asc' } }] });
}

export type GrupoOpcionalInput = { nome: string; obrigatorio?: boolean; maximo?: number; ordem?: number; opcoes: Array<{ nome: string; precoAdicional?: number; produtoEstoqueId?: string | null; ordem?: number }> };
export async function substituirOpcionaisProduto(tx: Prisma.TransactionClient, produtoId: string, opcionalIds: string[]) {
  await tx.produtoOpcionalVinculo.deleteMany({ where: { produtoId } });
  if (opcionalIds.length) await tx.produtoOpcionalVinculo.createMany({ data: [...new Set(opcionalIds)].map((opcionalId, ordem) => ({ produtoId, opcionalId, ordem })) });
  return listarOpcionaisProduto(tx, produtoId);
}
