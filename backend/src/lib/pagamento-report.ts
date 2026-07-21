import { toNumber } from './utils.js';

export const FORMA_PAGAMENTO_SEM_REGISTRO = 'SEM_REGISTRO';

type ComandaComPagamentos = {
  total: { toString(): string } | number;
  pagamentos: Array<{ forma: string; valor: { toString(): string } | number }>;
};

/** Soma pagamentos registrados; diferença vs total vai para SEM_REGISTRO. */
export function accumulatePorPagamento(
  porPagamento: Map<string, number>,
  comanda: ComandaComPagamentos,
) {
  const valor = toNumber(comanda.total);
  let recorded = 0;
  for (const pag of comanda.pagamentos) {
    const v = toNumber(pag.valor);
    porPagamento.set(pag.forma, (porPagamento.get(pag.forma) ?? 0) + v);
    recorded += v;
  }
  const gap = valor - recorded;
  if (gap > 0.009) {
    porPagamento.set(
      FORMA_PAGAMENTO_SEM_REGISTRO,
      (porPagamento.get(FORMA_PAGAMENTO_SEM_REGISTRO) ?? 0) + gap,
    );
  }
}
