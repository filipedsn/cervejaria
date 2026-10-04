import type { Prisma } from '@prisma/client';

/** Complete, tenant-scoped configuration/catalog photograph shared by inventory and the catalog migrator. No client is opened on import. */
export async function readPdvCatalogSourceSnapshot(tx: Prisma.TransactionClient, companyId: string) {
  const [pdvs, operationalConfig, moduleConfig, products, menus, optionals] = await Promise.all([
    tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, nome: true, ativo: true, usaCaixa: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    tx.configuracaoOperacional.findUnique({ where: { cervejariaId: companyId } }),
    tx.configuracaoOperacao.findUnique({ where: { cervejariaId: companyId } }),
    tx.produto.findMany({ where: { cervejariaId: companyId }, select: {
      id: true, nome: true, categoria: true, descricao: true, cor: true, estilo: true, tipo: true, formato: true,
      controlaEstoque: true, exigePreparo: true, ordem: true, ativo: true, cervejariaId: true, createdAt: true, updatedAt: true,
      precos: { select: { id: true, produtoId: true, volumeMl: true, preco: true }, orderBy: [{ volumeMl: 'asc' }, { id: 'asc' }] },
      gruposOpcionais: { select: { id: true, produtoId: true, nome: true, obrigatorio: true, maximo: true, ordem: true, ativo: true, createdAt: true, updatedAt: true,
        opcoes: { select: { id: true, grupoId: true, nome: true, precoAdicional: true, produtoEstoqueId: true, ordem: true, ativo: true, createdAt: true, updatedAt: true, produtoEstoque: { select: { id: true, cervejariaId: true } } }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] } }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] },
    }, orderBy: { id: 'asc' } }),
    tx.cardapio.findMany({ where: { cervejariaId: companyId }, select: { id: true, nome: true, ativo: true, chopeVolumesConfigurados: true, cervejariaId: true, createdAt: true, updatedAt: true,
      produtos: { select: { id: true, cardapioId: true, produtoId: true, volumeMl: true, precoUnit: true, produto: { select: { id: true, cervejariaId: true } } }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }, { id: 'asc' }] } }, orderBy: { id: 'asc' } }),
    tx.opcional.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, nome: true, preco: true, ativo: true, createdAt: true, updatedAt: true,
      produtos: { select: { id: true, produtoId: true, opcionalId: true, ordem: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] } }, orderBy: { id: 'asc' } }),
  ]);
  return { companyId, pdvs, operationalConfig, moduleConfig, products, menus, optionals };
}
