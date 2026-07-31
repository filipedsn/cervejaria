export interface ProdutoQuiosque {
  id: string;
  nome: string;
  categoria: string | null;
  precoUnit: string;
  exigePreparo: boolean;
  controlaEstoque: boolean;
  ativo: boolean;
  ordem: number;
}

export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';

export const FORMAS_PAGAMENTO: Array<{ valor: FormaPagamento; label: string }> = [
  { valor: 'DINHEIRO', label: 'Dinheiro' },
  { valor: 'PIX', label: 'Pix' },
  { valor: 'CARTAO_DEBITO', label: 'Débito' },
  { valor: 'CARTAO_CREDITO', label: 'Crédito' },
];

export type TipoComanda = 'AVULSA' | 'APELIDO' | 'MESA' | 'FICHA';

export const TIPOS_COMANDA: Array<{ valor: Exclude<TipoComanda, 'AVULSA'>; label: string }> = [
  { valor: 'APELIDO', label: 'Apelido' },
  { valor: 'MESA', label: 'Mesa' },
  { valor: 'FICHA', label: 'Ficha' },
];

export interface ItemPedido {
  id: string;
  produtoId: string;
  nome: string;
  precoUnit: number;
  quantidade: number;
  subtotal: number;
  exigePreparo: boolean;
}

export interface PedidoQuiosque {
  id: string;
  numero: number;
  status: 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';
  observacao: string | null;
  createdAt: string;
  itens: ItemPedido[];
}

export interface PagamentoQuiosque {
  id: string;
  forma: FormaPagamento;
  valor: number;
  valorRecebido: number | null;
  troco: number | null;
  pagoEm: string;
}

export interface ComandaQuiosque {
  id: string;
  tipo: TipoComanda;
  identificador: string | null;
  status: 'ABERTA' | 'FECHADA' | 'CANCELADA';
  pontoVendaId: string;
  createdAt: string;
  fechadaEm: string | null;
  total: number;
  pago: number;
  saldo: number;
  pedidos: PedidoQuiosque[];
  pagamentos: PagamentoQuiosque[];
}

export interface LinhaCarrinho {
  produto: ProdutoQuiosque;
  quantidade: number;
}

export function totalCarrinho(linhas: LinhaCarrinho[]): number {
  const centavos = linhas.reduce(
    (soma, linha) => soma + Math.round(Number(linha.produto.precoUnit) * 100) * linha.quantidade,
    0,
  );
  return centavos / 100;
}

/** Aceita "12,50" e "12.50", que e como o operador digita no celular. */
export function parseValor(entrada: string): number {
  return Number(entrada.replace(/\s/g, '').replace(',', '.'));
}

export function rotuloComanda(comanda: Pick<ComandaQuiosque, 'tipo' | 'identificador'>): string {
  if (comanda.tipo === 'AVULSA') return 'Venda avulsa';
  const prefixo = comanda.tipo === 'MESA' ? 'Mesa' : comanda.tipo === 'FICHA' ? 'Ficha' : '';
  return prefixo ? `${prefixo} ${comanda.identificador}` : (comanda.identificador ?? '');
}
