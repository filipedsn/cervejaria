/**
 * Regra canônica de venda líquida para indicadores e relatórios.
 *
 * Cancelamento total de item (inclusive ENTREGUE) preserva `quantidade` e marca
 * `canceladoEm` — esse item não conta como vendido. Cancelamento parcial reduz
 * `quantidade` no próprio item e registra histórico; a quantidade remanescente
 * continua contando, sem descontar de novo o trecho já retirado.
 *
 * `cancelamentoPendenteEm` também exclui o item: ainda não é venda consumada
 * para cobrança nem para ranking/indicadores.
 *
 * Estoque (estorno vs perda) é ortogonal a esta regra.
 */
export function itemContaNaVendaLiquida(item: {
  canceladoEm?: unknown;
  cancelamentoPendenteEm?: unknown;
}): boolean {
  return !item.cancelamentoPendenteEm && !item.canceladoEm;
}

export function somarQuantidadeVendaLiquida(
  itens: Array<{ quantidade: number; canceladoEm?: unknown; cancelamentoPendenteEm?: unknown }>,
): number {
  return itens.reduce(
    (soma, item) => (itemContaNaVendaLiquida(item) ? soma + item.quantidade : soma),
    0,
  );
}
