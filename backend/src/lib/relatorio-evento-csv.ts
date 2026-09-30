import { csvRow } from './csv.js';
import { resumoFinanceiroComandas } from './financeiro-contas.js';
import { toNumber } from './utils.js';

type ComandaCsv = {
  id: string;
  total: unknown;
  fechadaEm: Date | null;
  updatedAt: Date;
  cliente: { nome: string; telefone: string | null } | null;
  contaReceber: { valorOriginal: unknown } | null;
  pagamentos: Array<{ forma: string; valor: unknown; pagoEm: Date }>;
  itens: Array<{
    nome: string | null;
    volumeMl: number;
    quantidade: number;
    precoUnit: unknown;
    produto: { nome: string } | null;
  }>;
};

export function buildRelatorioEventoCsv(comandas: ComandaCsv[]) {
  const lines = ['cliente,telefone,produto,volume_ml,quantidade,preco_unit,subtotal,forma_pagamento,valor_pago,fechado_em,comanda_id,total_comanda,saldo_pendente,valor_nao_conciliado,data_recebimentos'];

  for (const comanda of comandas) {
    const financeiro = resumoFinanceiroComandas([comanda]);
    const formas = comanda.pagamentos.map((pagamento) => `${pagamento.forma}:${toNumber(pagamento.valor).toFixed(2)}`).join('|');
    const datasRecebimentos = comanda.pagamentos.map((pagamento) => pagamento.pagoEm.toISOString()).join('|');
    const itens = comanda.itens.length ? comanda.itens : [null];
    for (const [index, item] of itens.entries()) {
      const primeiraLinha = index === 0;
      lines.push(csvRow([
        comanda.cliente?.nome ?? '',
        comanda.cliente?.telefone ?? '',
        item?.produto?.nome ?? item?.nome ?? '',
        item?.volumeMl ?? '',
        item?.quantidade ?? '',
        item ? toNumber(item.precoUnit).toFixed(2) : '',
        item ? (toNumber(item.precoUnit) * item.quantidade).toFixed(2) : '',
        primeiraLinha ? formas : '',
        primeiraLinha ? financeiro.recebido.toFixed(2) : '',
        (comanda.fechadaEm ?? comanda.updatedAt).toISOString(),
        comanda.id,
        primeiraLinha ? financeiro.vendido.toFixed(2) : '',
        primeiraLinha ? financeiro.aReceber.toFixed(2) : '',
        primeiraLinha ? financeiro.naoConciliado.toFixed(2) : '',
        primeiraLinha ? datasRecebimentos : '',
      ]));
    }
  }

  return '\uFEFF' + lines.join('\n');
}
