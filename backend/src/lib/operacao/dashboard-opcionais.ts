import { toNumber } from '../utils.js';
import { itemContaNaVendaLiquida } from '../venda-liquida.js';

export type ItemComOpcionaisDashboard = {
  canceladoEm?: unknown;
  cancelamentoPendenteEm?: unknown;
  quantidade: number;
  opcionais?: Array<{
    opcionalCatalogoId?: string | null;
    opcionalId?: string | null;
    nome: string;
    precoAdicional: unknown;
    quantidade: number;
  }>;
};

/**
 * Agrega faturamento e quantidade de opcionais em comandas fechadas.
 * Chave preferencial: opcionalCatalogoId; fallback: nome normalizado.
 */
export function agregarOpcionaisVendidos(itens: ItemComOpcionaisDashboard[], receitaTotalComandas: number) {
  let receitaOpcionais = 0;
  let unidadesOpcionais = 0;
  const porOpcional = new Map<string, {
    opcionalId: string;
    nome: string;
    quantidade: number;
    receita: number;
  }>();

  for (const item of itens) {
    if (!itemContaNaVendaLiquida(item)) continue;
    for (const opcional of item.opcionais ?? []) {
      const qtd = item.quantidade * opcional.quantidade;
      const receita = toNumber(opcional.precoAdicional) * qtd;
      if (qtd <= 0) continue;
      unidadesOpcionais += qtd;
      receitaOpcionais += receita;
      const key = opcional.opcionalCatalogoId || opcional.opcionalId || `nome:${opcional.nome.trim().toLocaleLowerCase('pt-BR')}`;
      const atual = porOpcional.get(key) ?? {
        opcionalId: key,
        nome: opcional.nome,
        quantidade: 0,
        receita: 0,
      };
      if (opcional.nome.trim()) atual.nome = opcional.nome.trim();
      atual.quantidade += qtd;
      atual.receita += receita;
      porOpcional.set(key, atual);
    }
  }

  const base = receitaTotalComandas > 0 ? receitaTotalComandas : 0;
  return {
    receitaOpcionais,
    unidadesOpcionais,
    percentualReceitaOpcionais: base > 0 ? Math.round((receitaOpcionais / base) * 100) : 0,
    porOpcional: Array.from(porOpcional.values())
      .map((item) => ({
        ...item,
        percentual: base > 0 ? Math.round((item.receita / base) * 100) : 0,
      }))
      .sort((a, b) => b.receita - a.receita)
      .slice(0, 15),
  };
}
