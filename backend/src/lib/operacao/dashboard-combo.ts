import { toNumber } from '../utils.js';
import { itemContaNaVendaLiquida } from '../venda-liquida.js';

/** Item mínimo para discriminar venda solta vs via combo no Quadro. */
export type ItemDashboardCombo = {
  produtoId: string | null;
  nome: string | null;
  quantidade: number;
  precoUnit: unknown;
  canceladoEm?: unknown;
  cancelamentoPendenteEm?: unknown;
  comboInstanciaId?: string | null;
  comboProdutoId?: string | null;
  comboNome?: string | null;
};

/**
 * Separa receita/quantidade de itens vendidos sozinhos vs dentro de combo.
 * Combos vendidos = instâncias distintas (`comboInstanciaId`); receita = soma dos componentes.
 */
export function agregarItensSoltosECombo(itens: ItemDashboardCombo[], receitaTotalComandas: number) {
  let itensVendidos = 0;
  let receitaCombo = 0;
  const instancias = new Set<string>();
  const porProduto = new Map<string, {
    produtoId: string;
    nome: string;
    quantidade: number;
    receita: number;
    quantidadeSolta: number;
    receitaSolta: number;
    quantidadeEmCombo: number;
    receitaEmCombo: number;
  }>();
  const porCombo = new Map<string, {
    comboProdutoId: string;
    nome: string;
    quantidade: number;
    receita: number;
    instancias: Set<string>;
  }>();

  for (const item of itens) {
    if (!item.produtoId || !itemContaNaVendaLiquida(item)) continue;
    itensVendidos += item.quantidade;
    const itemValor = toNumber(item.precoUnit) * item.quantidade;
    const emCombo = Boolean(item.comboInstanciaId && item.comboProdutoId);
    const prod = porProduto.get(item.produtoId) ?? {
      produtoId: item.produtoId,
      nome: item.nome ?? 'Item',
      quantidade: 0,
      receita: 0,
      quantidadeSolta: 0,
      receitaSolta: 0,
      quantidadeEmCombo: 0,
      receitaEmCombo: 0,
    };
    prod.quantidade += item.quantidade;
    prod.receita += itemValor;
    if (emCombo) {
      prod.quantidadeEmCombo += item.quantidade;
      prod.receitaEmCombo += itemValor;
      receitaCombo += itemValor;
      instancias.add(item.comboInstanciaId!);
      const combo = porCombo.get(item.comboProdutoId!) ?? {
        comboProdutoId: item.comboProdutoId!,
        nome: item.comboNome?.trim() || 'Combo',
        quantidade: 0,
        receita: 0,
        instancias: new Set<string>(),
      };
      if (item.comboNome?.trim()) combo.nome = item.comboNome.trim();
      combo.receita += itemValor;
      combo.instancias.add(item.comboInstanciaId!);
      combo.quantidade = combo.instancias.size;
      porCombo.set(item.comboProdutoId!, combo);
    } else {
      prod.quantidadeSolta += item.quantidade;
      prod.receitaSolta += itemValor;
    }
    porProduto.set(item.produtoId, prod);
  }

  const base = receitaTotalComandas > 0 ? receitaTotalComandas : 0;
  const porProdutoArr = Array.from(porProduto.values())
    .map((produto) => ({
      produtoId: produto.produtoId,
      nome: produto.nome,
      quantidade: produto.quantidade,
      receita: produto.receita,
      quantidadeSolta: produto.quantidadeSolta,
      receitaSolta: produto.receitaSolta,
      quantidadeEmCombo: produto.quantidadeEmCombo,
      receitaEmCombo: produto.receitaEmCombo,
      percentual: base > 0 ? Math.round((produto.receita / base) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15);

  const porComboArr = Array.from(porCombo.values())
    .map(({ instancias: _instancias, ...combo }) => ({
      ...combo,
      percentual: base > 0 ? Math.round((combo.receita / base) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15);

  return {
    itensVendidos,
    receitaCombo,
    percentualReceitaCombo: base > 0 ? Math.round((receitaCombo / base) * 100) : 0,
    combosVendidos: instancias.size,
    porProduto: porProdutoArr,
    porCombo: porComboArr,
  };
}
