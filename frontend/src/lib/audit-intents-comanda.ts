import { formatAuditMoney, type AuditIntent, type AuditIntentItem } from './audit-context';

type ItemLike = {
  id?: string;
  produtoId?: string;
  nome: string;
  quantidade: number;
  volumeMl?: number | null;
  precoUnit?: number | null;
};

type LinhaLike = {
  produto: { id: string; nome: string; precoUnit?: string | number };
  quantidade: number;
  tapId?: string;
  volumeMl?: number;
  precoUnit?: number;
  paraViagem?: boolean;
  observacao?: string;
  opcionais?: Array<{ opcionalId: string; nome: string; precoAdicional: number; quantidade: number }>;
  combo?: { resumo: string[] };
};

type ComandaItensLike = {
  pedidos?: Array<{ numero?: number; itens: ItemLike[] }>;
} | null | undefined;

const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_DEBITO: 'Débito',
  CARTAO_CREDITO: 'Crédito',
};

function descreverItem(nome: string, quantidade: number, volumeMl?: number | null, extras: string[] = []): string {
  const volume = volumeMl ? ` ${volumeMl}ml` : '';
  const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  return `${quantidade}x ${nome}${volume}${suffix}`;
}

export function encontrarItemComanda(comanda: ComandaItensLike, itemId: string): (ItemLike & { pedidoNumero?: number }) | undefined {
  for (const pedido of comanda?.pedidos ?? []) {
    const item = pedido.itens.find((row) => row.id === itemId);
    if (item) return { ...item, pedidoNumero: pedido.numero };
  }
  return undefined;
}

/** Observação is free text and is only reported as present/absent. */
export function intentLancarItens(itens: LinhaLike[]): AuditIntent {
  const linhas: AuditIntentItem[] = itens.map((linha) => {
    const precoUnit = linha.precoUnit ?? Number(linha.produto.precoUnit);
    return {
      produtoId: linha.produto.id,
      produtoNome: linha.produto.nome,
      quantidade: linha.quantidade,
      volumeMl: linha.volumeMl,
      precoUnit: Number.isFinite(precoUnit) ? precoUnit : undefined,
      tapId: linha.tapId,
      paraViagem: linha.paraViagem ?? false,
      temObservacao: Boolean(linha.observacao?.trim()),
      opcionais: linha.opcionais?.length
        ? linha.opcionais.map((opcional) => `${opcional.quantidade}x ${opcional.nome}`).join(', ')
        : undefined,
    };
  });
  const partes = itens.map((linha) => {
    const extras: string[] = [];
    if (linha.opcionais?.length) extras.push(`+ ${linha.opcionais.map((o) => o.nome).join(', ')}`);
    if (linha.combo?.resumo.length) extras.push(`com ${linha.combo.resumo.join(', ')}`);
    if (linha.paraViagem) extras.push('para viagem');
    if (linha.observacao?.trim()) extras.push('com observação');
    return descreverItem(linha.produto.nome, linha.quantidade, linha.volumeMl, extras);
  });
  const quantidadeTotal = itens.reduce((total, linha) => total + linha.quantidade, 0);
  return {
    summary: `Incluir ${partes.join('; ')}`,
    itensLinhas: itens.length,
    itensQuantidade: quantidadeTotal,
    itens: linhas,
  };
}

export function intentRemoverItem(
  comanda: ComandaItensLike,
  params: { itemId: string; quantidade?: number; delivered?: { tratamentoEstoque: string; quantidadeEsperada: number } },
): AuditIntent {
  const item = encontrarItemComanda(comanda, params.itemId);
  const quantidade = params.quantidade ?? item?.quantidade;
  const nome = item?.nome ?? `item ${params.itemId}`;
  const alvo = quantidade ? descreverItem(nome, quantidade, item?.volumeMl) : nome;
  return {
    summary: `${params.delivered ? 'Cancelar item já entregue' : 'Remover'} ${alvo}${item?.pedidoNumero ? ` da senha ${item.pedidoNumero}` : ''}`,
    itemId: params.itemId,
    produtoId: item?.produtoId,
    produtoNome: item?.nome,
    quantidadeRemover: quantidade,
    quantidadeAtual: item?.quantidade,
    entregue: Boolean(params.delivered),
    tratamentoEstoque: params.delivered?.tratamentoEstoque,
    pedidoNumero: item?.pedidoNumero,
  };
}

export function intentAlterarQuantidadeItem(
  comanda: ComandaItensLike,
  params: { itemId: string; quantidade: number },
): AuditIntent {
  const item = encontrarItemComanda(comanda, params.itemId);
  const nome = item?.nome ?? `item ${params.itemId}`;
  return {
    summary: `Alterar quantidade de ${nome}${item?.volumeMl ? ` ${item.volumeMl}ml` : ''} de ${item?.quantidade ?? '?'} para ${params.quantidade}`,
    itemId: params.itemId,
    produtoId: item?.produtoId,
    produtoNome: item?.nome,
    quantidadeAnterior: item?.quantidade,
    quantidadeNova: params.quantidade,
    pedidoNumero: item?.pedidoNumero,
  };
}

export function intentFecharComanda(params: {
  pagamentos: Array<{ forma: string; valor: number }>;
  desconto?: number;
  descontoAnterior?: number;
  aplicarDesconto?: boolean;
  deixarPendente?: boolean;
}): AuditIntent {
  const pagamentos = params.pagamentos.map((p) => `${PAYMENT_LABELS[p.forma] ?? p.forma} ${formatAuditMoney(p.valor) ?? p.valor}`);
  const totalPago = params.pagamentos.reduce((total, p) => total + p.valor, 0);
  const desconto = params.aplicarDesconto && params.desconto ? ` com desconto de ${formatAuditMoney(params.desconto)}` : '';
  const pendente = params.deixarPendente ? ' deixando saldo pendente para o cliente' : '';
  const corpo = pagamentos.length > 0 ? ` recebendo ${pagamentos.join(' + ')}` : ' sem pagamento';
  return {
    summary: `Fechar a conta${corpo}${desconto}${pendente}`,
    totalPago: Math.round(totalPago * 100) / 100,
    pagamentosQtd: params.pagamentos.length,
    formasPagamento: params.pagamentos.map((p) => p.forma).join(','),
    desconto: params.aplicarDesconto ? params.desconto : undefined,
    descontoAnterior: params.descontoAnterior,
    deixarPendente: params.deixarPendente ?? false,
    pagamentos: params.pagamentos.map((p) => ({ forma: p.forma, valor: p.valor })),
  };
}
