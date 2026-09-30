import { toNumber } from './utils.js';

type ComandaFinanceira = {
  total: unknown;
  pagamentos: Array<{ forma: string; valor: unknown }>;
  contaReceber?: { valorOriginal: unknown } | null;
};

export function resumoFinanceiroComandas(comandas: ComandaFinanceira[]) {
  let vendido = 0;
  let recebido = 0;
  let aReceber = 0;
  const porPagamento = new Map<string, number>();

  for (const comanda of comandas) {
    vendido += toNumber(comanda.total);
    const pago = comanda.pagamentos.reduce((soma, pagamento) => {
      const valor = toNumber(pagamento.valor);
      porPagamento.set(pagamento.forma, (porPagamento.get(pagamento.forma) ?? 0) + valor);
      return soma + valor;
    }, 0);
    recebido += pago;
    if (comanda.contaReceber) {
      aReceber += Math.max(0, toNumber(comanda.contaReceber.valorOriginal) - pago);
    }
  }

  const naoConciliado = Math.max(0, vendido - recebido - aReceber);
  return {
    vendido,
    recebido,
    aReceber,
    naoConciliado,
    porPagamento: [...porPagamento.entries()]
      .map(([forma, valor]) => ({
        forma,
        valor,
        percentual: recebido > 0 ? Math.round((valor / recebido) * 100) : 0,
      }))
      .sort((a, b) => b.valor - a.valor),
  };
}
