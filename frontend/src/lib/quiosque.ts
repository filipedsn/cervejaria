export interface ProdutoQuiosque {
  id: string;
  nome: string;
  categoria: string | null;
  precoUnit: string;
  /** Preço do template quando turno/cardápio vinculado; senão igual ao catálogo. */
  precoEfetivo?: number;
  exigePreparo: boolean;
  controlaEstoque: boolean;
  ativo: boolean;
  ordem: number;
}

export interface CardapioQuiosqueItem {
  produtoId: string;
  precoUnit: number;
  produto?: ProdutoQuiosque;
}

export interface CardapioQuiosque {
  id: string;
  nome: string;
  ativo: boolean;
  cervejariaId: string;
  produtoIds: string[];
  itens?: CardapioQuiosqueItem[];
  produtos?: ProdutoQuiosque[];
  itemCount?: number;
}

export interface CardapioTurnoQuiosque {
  produtos: ProdutoQuiosque[];
  produtoIds: string[];
  catalogo: ProdutoQuiosque[];
  editavel: boolean;
}

export type TurnoCardapioModo = 'salvo' | 'montar' | 'depois';

export interface TurnoCardapioFormState {
  cardapioModo: TurnoCardapioModo;
  cardapioId: string;
  produtoIds: string[];
}

export function defaultTurnoCardapioForm(): TurnoCardapioFormState {
  return { cardapioModo: 'depois', cardapioId: '', produtoIds: [] };
}

export function buildTurnoCardapioAbrirPayload(form: TurnoCardapioFormState) {
  if (form.cardapioModo === 'salvo' && form.cardapioId) {
    return { cardapioId: form.cardapioId };
  }
  if (form.cardapioModo === 'montar' && form.produtoIds.length > 0) {
    return { produtoIds: form.produtoIds };
  }
  return {};
}

/** URL de produtos operacionais do turno (PDV/comanda). */
export function produtosOperacionaisUrl(pontoVendaId: string) {
  return `/api/quiosque/produtos?pontoVendaId=${encodeURIComponent(pontoVendaId)}`;
}

/** Categorias padrao do catalogo do quiosque (espelha backend). */
export const CATEGORIAS_PRODUTO_QUIOSQUE = [
  'Bebidas',
  'Cervejas',
  'Drinks',
  'Porções',
  'Lanches',
  'Salgados',
  'Doces e sobremesas',
  'Combos',
  'Outros',
] as const;

export type CategoriaProdutoQuiosque = (typeof CATEGORIAS_PRODUTO_QUIOSQUE)[number];

const categoriasSet = new Set<string>(CATEGORIAS_PRODUTO_QUIOSQUE);

export function isCategoriaProdutoQuiosque(value: string): value is CategoriaProdutoQuiosque {
  return categoriasSet.has(value);
}

export function normalizeCategoriaProduto(value: string | null | undefined): CategoriaProdutoQuiosque {
  if (!value?.trim()) return 'Outros';
  const trimmed = value.trim();
  const exact = CATEGORIAS_PRODUTO_QUIOSQUE.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  if (lower.includes('cervej')) return 'Cervejas';
  if (lower.includes('drink') || lower.includes('coquetel')) return 'Drinks';
  if (lower.includes('porç') || lower.includes('porc')) return 'Porções';
  if (lower.includes('lanche') || lower.includes('hamb')) return 'Lanches';
  if (lower.includes('salg') || lower.includes('pastel') || lower.includes('coxinh')) return 'Salgados';
  if (lower.includes('doce') || lower.includes('sobremesa') || lower.includes('sobremesas')) return 'Doces e sobremesas';
  if (lower.includes('combo') || lower.includes('promo')) return 'Combos';
  if (lower.includes('beb')) return 'Bebidas';

  return 'Outros';
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

export type StatusPedido = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';

export interface PedidoQuiosque {
  id: string;
  numero: number;
  status: StatusPedido;
  observacao: string | null;
  createdAt: string;
  itens: ItemPedido[];
}

/** O pedido como a cozinha ve: so os itens de preparo e de quem e a conta. */
export interface PedidoCozinha {
  id: string;
  numero: number;
  status: StatusPedido;
  observacao: string | null;
  createdAt: string;
  /** Inicio do status atual — cronometro reinicia a cada transicao na cozinha. */
  statusDesde: string;
  /** Preenchido ao marcar entregue; congela o tempo total do pedido. */
  entregueEm: string | null;
  comanda: {
    id: string;
    tipo: TipoComanda;
    identificador: string | null;
    numero?: number | null;
  };
  itens: Array<{
    id: string;
    nome: string;
    quantidade: number;
    precoUnit: number;
  }>;
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
  numero?: number | null;
  status: 'ABERTA' | 'FECHADA' | 'CANCELADA';
  pontoVendaId: string;
  createdAt: string;
  fechadaEm: string | null;
  subtotal: number;
  desconto: number;
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

export function rotuloComanda(
  comanda: Pick<ComandaQuiosque, 'tipo' | 'identificador' | 'numero'>,
): string {
  if (comanda.tipo === 'AVULSA') return 'Venda avulsa';
  const prefixo = comanda.tipo === 'MESA' ? 'Mesa' : comanda.tipo === 'FICHA' ? 'Ficha' : '';
  const base = prefixo ? `${prefixo} ${comanda.identificador}` : (comanda.identificador ?? '');
  if (comanda.numero != null && base) return `${comanda.numero} - ${base}`;
  return base;
}

export function totalItensComanda(comanda: ComandaQuiosque): number {
  return comanda.pedidos
    .filter((pedido) => pedido.status !== 'CANCELADO')
    .reduce(
      (soma, pedido) => soma + pedido.itens.reduce((acc, item) => acc + item.quantidade, 0),
      0,
    );
}

const STATUS_COZINHA_PENDENTE: StatusPedido[] = ['RECEBIDO', 'EM_PREPARO', 'PRONTO'];

export function pedidoVaiParaCozinha(itens: Array<{ exigePreparo: boolean }>): boolean {
  return itens.some((item) => item.exigePreparo);
}

/** Pedido da cozinha so entra no total da comanda apos ENTREGUE. */
export function pedidoConfirmadoNaComanda(pedido: PedidoQuiosque): boolean {
  if (pedido.status === 'CANCELADO') return false;
  if (pedido.itens.some((item) => item.exigePreparo)) return pedido.status === 'ENTREGUE';
  return true;
}

export function temPedidoCozinhaPendente(comanda: Pick<ComandaQuiosque, 'pedidos'>): boolean {
  return comanda.pedidos.some(
    (pedido) =>
      pedidoVaiParaCozinha(pedido.itens) && STATUS_COZINHA_PENDENTE.includes(pedido.status),
  );
}

export function rotuloStatusPedido(status: StatusPedido): string {
  switch (status) {
    case 'RECEBIDO':
      return 'Na cozinha';
    case 'EM_PREPARO':
      return 'Preparando';
    case 'PRONTO':
      return 'Pronto para entregar';
    case 'ENTREGUE':
      return 'Entregue';
    case 'CANCELADO':
      return 'Cancelado';
  }
}

/** Comandas fechadas a partir da abertura do turno de caixa (praia de dia, rua à noite). */
export function comandasFechadasNoTurno(comandas: ComandaQuiosque[], abertoEm: string): ComandaQuiosque[] {
  const inicio = new Date(abertoEm).getTime();
  return comandas.filter(
    (comanda) => comanda.fechadaEm != null && new Date(comanda.fechadaEm).getTime() >= inicio,
  );
}

export const RESUMO_TURNO_VAZIO = {
  comandasAbertas: 0,
  comandasFechadas: 0,
  vendasAvulsas: 0,
  receitaAvulsa: 0,
  valorAberto: 0,
  valorFechado: 0,
} as const;

/** Data operacional (America/Sao_Paulo) para filtros da API. */
export function diaOperacionalQuery(referencia = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(referencia);
}

export interface FecharGrupoQuiosqueResponse {
  comandas: ComandaQuiosque[];
  canceladas: ComandaQuiosque[];
  totalGrupo: number;
}

export type StatusCaixa = 'ABERTO' | 'FECHADO';
export type TipoMovimentoCaixa = 'SANGRIA' | 'SUPRIMENTO';

export interface MovimentoCaixa {
  id: string;
  tipo: TipoMovimentoCaixa;
  valor: number;
  observacao: string | null;
  registradoPorId: string;
  createdAt: string;
}

export interface ResumoCaixa {
  id: string;
  pontoVendaId: string;
  diaOperacional: string;
  status: StatusCaixa;
  trocoInicial: number;
  abertoPorId: string;
  abertoEm: string;
  fechadoPorId: string | null;
  fechadoEm: string | null;
  observacaoFechamento: string | null;
  gaveta: {
    trocoInicial: number;
    entradasDinheiro: number;
    suprimentos: number;
    sangrias: number;
    esperadoDinheiro: number;
  };
  esperado: {
    dinheiro: number;
    pix: number;
    cartaoDebito: number;
    cartaoCredito: number;
    totalVendas: number;
  };
  contado: {
    dinheiro: number;
    pix: number;
    cartaoDebito: number;
    cartaoCredito: number;
  } | null;
  diferencas: {
    dinheiro: number;
    pix: number;
    cartaoDebito: number;
    cartaoCredito: number;
  } | null;
  movimentos: MovimentoCaixa[];
}

export interface RelatorioTurnoCaixa {
  caixa: ResumoCaixa;
  pontoNome: string;
  abertoPorNome: string;
  fechadoPorNome: string | null;
  comandasAtendidas: number;
  vendasAvulsas: number;
  itensVendidos: number;
  porProduto: Array<{
    produtoId: string;
    nome: string;
    quantidade: number;
    receita: number;
    percentual: number;
  }>;
  ticketMedio: number;
  duracaoMinutos: number;
  receitaPorHora: number;
}

export function formatTurnoTitulo(abertoEm: string, fechadoEm: string): string {
  const d = new Date(fechadoEm);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} · ${fmt(abertoEm)} – ${fmt(fechadoEm)}`;
}

export function formatDuracaoTurnoMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return `${horas}h`;
  return `${horas}h ${String(resto).padStart(2, '0')}min`;
}

export function pluralComandasQuiosque(qtd: number): string {
  return qtd === 1 ? '1 comanda' : `${qtd} comandas`;
}

export interface CaixaResposta {
  sessao: ResumoCaixa | null;
  comandasAbertas?: number;
}

export type TipoSaidaEstoque = 'PERDA' | 'CORTESIA' | 'CONSUMO_INTERNO';

export interface SaldoEstoque {
  produtoId: string;
  nome: string;
  categoria: string | null;
  quantidade: number;
}

/** Mapa produtoId → saldo disponível no ponto de venda. */
export function mapSaldosEstoque(itens: SaldoEstoque[]): Map<string, number> {
  return new Map(itens.map((item) => [item.produtoId, item.quantidade]));
}

/** Máximo que ainda pode entrar no carrinho desta rodada. null = sem controle de estoque. */
export function limiteEstoqueCarrinho(
  produto: Pick<ProdutoQuiosque, 'id' | 'controlaEstoque'>,
  saldos: Map<string, number> | undefined,
  moduloControlaEstoque: boolean,
): number | null {
  if (!moduloControlaEstoque || !produto.controlaEstoque || !saldos) return null;
  return Math.max(0, saldos.get(produto.id) ?? 0);
}

export function podeIncrementarLinhaCarrinho(
  produto: Pick<ProdutoQuiosque, 'id' | 'controlaEstoque'>,
  quantidadeAtual: number,
  saldos: Map<string, number> | undefined,
  moduloControlaEstoque: boolean,
): boolean {
  const limite = limiteEstoqueCarrinho(produto, saldos, moduloControlaEstoque);
  if (limite === null) return true;
  return quantidadeAtual < limite;
}

export const TIPOS_SAIDA_ESTOQUE: Array<{ valor: TipoSaidaEstoque; label: string }> = [
  { valor: 'PERDA', label: 'Perda' },
  { valor: 'CORTESIA', label: 'Cortesia' },
  { valor: 'CONSUMO_INTERNO', label: 'Consumo interno' },
];

export interface QuiosqueDashboard {
  periodo: { ano: number; mes: number; label: string };
  resumo: {
    receitaTotal: number;
    comandasAtendidas: number;
    vendasAvulsas: number;
    receitaAvulsa: number;
    ticketMedio: number;
    itensVendidos: number;
    turnosCaixa: number;
    variacaoReceitaMesAnterior: number | null;
  };
  evolucaoSemanal: Array<{ semana: number; label: string; receita: number; comandas: number }>;
  porPagamento: Array<{ forma: string; valor: number; percentual: number }>;
  porProduto: Array<{
    produtoId: string;
    nome: string;
    quantidade: number;
    receita: number;
    percentual: number;
  }>;
  porFuncionario: Array<{
    usuarioId: string | null;
    nome: string;
    comandas: number;
    receita: number;
  }>;
  turnosRecentes: Array<{
    sessaoId: string;
    pontoVendaId: string;
    pontoNome: string;
    diaOperacional: string;
    turnoDoDia: number;
    turnosNoDia: number;
    abertoPorNome: string;
    abertoEm: string;
    fechadoEm: string;
    receitaTotal: number;
    comandasAtendidas: number;
    vendasAvulsas: number;
    receitaAvulsa: number;
    ticketMedio: number;
    duracaoHoras: number;
    receitaPorHora: number;
  }>;
  comparativoPontos: Array<{
    pontoVendaId: string;
    nome: string;
    turnos: number;
    receitaTotal: number;
    mediaPorTurno: number;
    ticketMedio: number;
    comandasAtendidas: number;
    vendasAvulsas: number;
  }>;
  receitaAnual: Array<{ mes: number; label: string; receita: number; comandas: number }>;
  anoVigente: number;
}
