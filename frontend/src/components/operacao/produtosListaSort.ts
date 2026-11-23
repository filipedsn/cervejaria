import type { OperacaoDashboardProdutoListaItem } from '../../lib/operacao';

export type OrdenacaoProdutos = 'receita' | 'quantidade';

export function toNum(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function compareProdutosLista(
  a: OperacaoDashboardProdutoListaItem,
  b: OperacaoDashboardProdutoListaItem,
  ordenar: OrdenacaoProdutos,
): number {
  const qtyA = toNum(a.quantidadeVendida);
  const qtyB = toNum(b.quantidadeVendida);
  const recA = toNum(a.receita);
  const recB = toNum(b.receita);
  if (ordenar === 'quantidade') {
    return qtyB - qtyA || recB - recA || a.nome.localeCompare(b.nome, 'pt-BR');
  }
  return recB - recA || qtyB - qtyA || a.nome.localeCompare(b.nome, 'pt-BR');
}
