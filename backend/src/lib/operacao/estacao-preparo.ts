import type { EstacaoPreparo } from '@prisma/client';

export type { EstacaoPreparo };

export const ESTACOES_PREPARO: readonly EstacaoPreparo[] = ['COZINHA', 'BAR'];

/**
 * Cobrança dos itens de preparo no lançamento. `boolean` vale para todas as
 * estações (ex.: venda avulsa já paga); o objeto respeita a opção de cada uma.
 */
export type CobrancaAoLancar = boolean | { cozinha: boolean; bar: boolean };

export type ItemComEstacao = { exigePreparo: boolean; estacaoPreparo?: EstacaoPreparo | null };

/** Linhas anteriores ao Bar não têm estação gravada e sempre foram da Cozinha. */
export function estacaoDoItem(item: { estacaoPreparo?: EstacaoPreparo | null }): EstacaoPreparo {
  return item.estacaoPreparo === 'BAR' ? 'BAR' : 'COZINHA';
}

export function itemDaEstacao(item: ItemComEstacao, estacao: EstacaoPreparo): boolean {
  return item.exigePreparo && estacaoDoItem(item) === estacao;
}

/** Um pedido nunca mistura estações; o primeiro item de preparo define a fila. */
export function estacaoDoPedido(itens: ItemComEstacao[]): EstacaoPreparo | null {
  const item = itens.find((candidate) => candidate.exigePreparo);
  return item ? estacaoDoItem(item) : null;
}

export function cobrancaAoLancarDasConfiguracoes(settings: {
  kitchenItemsChargeAtLaunch?: boolean | null;
  barItemsChargeAtLaunch?: boolean | null;
} | null | undefined): { cozinha: boolean; bar: boolean } {
  return {
    cozinha: settings?.kitchenItemsChargeAtLaunch === true,
    bar: settings?.barItemsChargeAtLaunch === true,
  };
}

export function estacaoCobraAoLancar(cobranca: CobrancaAoLancar | null | undefined, estacao: EstacaoPreparo): boolean {
  if (cobranca === undefined || cobranca === null) return false;
  if (typeof cobranca === 'boolean') return cobranca;
  return estacao === 'BAR' ? cobranca.bar : cobranca.cozinha;
}

/** O item de preparo entra no total já no lançamento? Itens de balcão sempre entram. */
export function itemCobradoAoLancar(item: ItemComEstacao, cobranca: CobrancaAoLancar | null | undefined): boolean {
  return !item.exigePreparo || estacaoCobraAoLancar(cobranca, estacaoDoItem(item));
}

export function nomeEstacao(estacao: EstacaoPreparo): string {
  return estacao === 'BAR' ? 'bar' : 'cozinha';
}

/** Produto escolhe a estação; ela só recebe o item se estiver ligada no estabelecimento. */
export function itemVaiParaEstacao(
  produto: { exigePreparo: boolean; estacaoPreparo?: EstacaoPreparo | null },
  estacoesAtivas: { temCozinha: boolean; temBar: boolean },
): boolean {
  if (!produto.exigePreparo) return false;
  return estacaoDoItem(produto) === 'BAR' ? estacoesAtivas.temBar : estacoesAtivas.temCozinha;
}
