import type { Prisma } from '@prisma/client';

export type OpcionalSelecionadoInput = { opcionalId: string; quantidade?: number };
export type OpcionalResolvido = { opcionalId: string; nome: string; precoAdicional: number; quantidade: number; produtoEstoqueId: string | null; opcionalCatalogoId?: string };

export async function resolverOpcionais(tx: Prisma.TransactionClient, produtoId: string, selecionados?: OpcionalSelecionadoInput[]): Promise<OpcionalResolvido[]> {
  const entradas = selecionados ?? [];
  if (!entradas.length) return [];
  const ids = [...new Set(entradas.map((item) => item.opcionalId))];
  const vinculos = await tx.produtoOpcionalVinculo.findMany({ where: { produtoId, opcionalId: { in: ids }, opcional: { ativo: true } }, include: { opcional: true } });
  if (vinculos.length !== ids.length) throw Object.assign(new Error('Opcional não vinculado a este produto'), { statusCode: 400 });
  const porId = new Map(vinculos.map((vinculo) => [vinculo.opcionalId, vinculo.opcional]));
  return entradas.map((entrada) => {
    const opcional = porId.get(entrada.opcionalId)!;
    const quantidade = entrada.quantidade ?? 1;
    if (!Number.isInteger(quantidade) || quantidade < 1) throw Object.assign(new Error('Quantidade de opcional inválida'), { statusCode: 400 });
    return { opcionalId: opcional.id, nome: opcional.nome, precoAdicional: Number(opcional.preco), quantidade, produtoEstoqueId: null, opcionalCatalogoId: opcional.id };
  });
}

export async function listarOpcionaisProduto(prisma: Prisma.TransactionClient | typeof import('./prisma.js').prisma, produtoId: string) {
  return prisma.produtoOpcionalVinculo.findMany({ where: { produtoId, opcional: { ativo: true } }, include: { opcional: true }, orderBy: [{ ordem: 'asc' }, { opcional: { nome: 'asc' } }] });
}

export type GrupoOpcionalInput = { nome: string; obrigatorio?: boolean; maximo?: number; ordem?: number; opcoes: Array<{ nome: string; precoAdicional?: number; produtoEstoqueId?: string | null; ordem?: number }> };
export async function substituirOpcionaisProduto(tx: Prisma.TransactionClient, produtoId: string, cervejariaId: string, opcionalIds: string[]) {
  const produto = await tx.produto.findFirst({ where: { id: produtoId, cervejariaId }, select: { id: true, pontoVendaId: true } });
  if (!produto) throw Object.assign(new Error('Produto não encontrado'), { statusCode: 404 });
  const ids = [...new Set(opcionalIds)];
  if (ids.length) {
    const optionals = await tx.opcional.findMany({ where: { id: { in: ids }, cervejariaId }, select: { id: true, pontoVendaId: true } });
    if (optionals.length !== ids.length || optionals.some((opcional) => produto.pontoVendaId !== opcional.pontoVendaId)) {
      throw Object.assign(new Error('Opcional não pertence à empresa ou ao ponto de venda'), { statusCode: 404 });
    }
  }
  await tx.produtoOpcionalVinculo.deleteMany({ where: { produtoId } });
  if (ids.length) await tx.produtoOpcionalVinculo.createMany({ data: ids.map((opcionalId, ordem) => ({ produtoId, opcionalId, cervejariaId, pontoVendaId: produto.pontoVendaId, ordem })) });
  return listarOpcionaisProduto(tx, produtoId);
}
