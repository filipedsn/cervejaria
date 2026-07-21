export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: 'ADMIN' | 'DONO' | 'ATENDENTE';
}

export interface BrandPalette {
  '50': string;
  '100': string;
  '200': string;
  '300': string;
  '400': string;
  '500': string;
  '600': string;
  '700': string;
  '800': string;
  '900': string;
}

export interface BrandTheme {
  v: 2;
  brand: BrandPalette;
  surface: {
    base: string;
    light: string;
    lighter: string;
  };
  corSecundaria: string | null;
}

export interface Cervejaria {
  id: string;
  nome: string;
  slug: string;
  logoUrl?: string | null;
  corPrimaria?: string | null;
  corSecundaria?: string | null;
  corPaleta?: BrandTheme | null;
}

export interface AuthResponse {
  token: string;
  usuario: Usuario;
  cervejaria: Cervejaria | null;
}

export type ProdutoTipo = 'BEBIDA' | 'COMIDA';

export type FormatoBebida = 'CHOPE' | 'LATA' | 'LONGNECK' | 'GARRAFA' | 'OUTRO';

export const FOOD_UNIT_ML = 1;

export const FORMATO_BEBIDA_LABELS: Record<FormatoBebida, string> = {
  CHOPE: 'Chope',
  LATA: 'Lata',
  LONGNECK: 'Long neck',
  GARRAFA: 'Garrafa',
  OUTRO: 'Outro',
};

export const FORMATOS_EMBALAGEM: FormatoBebida[] = ['LATA', 'LONGNECK', 'GARRAFA', 'OUTRO'];

export function isBebidaChope(produto: Pick<Produto, 'tipo' | 'formato'>): boolean {
  return produto.tipo === 'BEBIDA' && (produto.formato ?? 'CHOPE') === 'CHOPE';
}

export function isVendaUnitaria(produto: Pick<Produto, 'tipo' | 'formato'>): boolean {
  return produto.tipo === 'COMIDA' || (produto.tipo === 'BEBIDA' && !isBebidaChope(produto));
}

export interface Preco {
  id: string;
  volumeMl: number;
  preco: string;
}

export interface Produto {
  id: string;
  nome: string;
  descricao?: string | null;
  cor?: string | null;
  estilo?: string | null;
  tipo: ProdutoTipo;
  formato?: FormatoBebida | null;
  ativo: boolean;
  precos: Preco[];
}

export interface Trailer {
  id: string;
  nome: string;
  identificador?: string | null;
  ativo: boolean;
}

export function formatTrailerLabel(trailer: Pick<Trailer, 'nome' | 'identificador'>): string {
  return trailer.identificador ? `${trailer.nome} (${trailer.identificador})` : trailer.nome;
}

export interface Tap {
  id: string;
  numero: number;
  nome?: string | null;
  produtoId?: string | null;
  trailerId: string;
  ativo: boolean;
  produto?: Produto | null;
}

/** Tap do trailer com o chope posicionado no evento (montagem operacional). */
export interface TapComChope {
  id: string;
  numero: number;
  nome?: string | null;
  trailerId: string;
  ativo: boolean;
  produtoId?: string | null;
  chopeAtual: Produto | null;
  chopeCadastro: Produto | null;
  temMontagemAtiva: boolean;
  trocadoNoEvento: boolean;
  montagemPrevista?: boolean;
}

export interface TapMontagemResponse {
  taps: TapComChope[];
  message: string;
}

export interface EventoCardapio {
  produtos: Produto[];
  produtoIds: string[];
  catalogo: Produto[];
  editavel: boolean;
}

export interface Cardapio {
  id: string;
  nome: string;
  ativo: boolean;
  cervejariaId: string;
  produtoIds: string[];
  produtos?: Produto[];
  itemCount?: number;
}

export interface Evento {
  id: string;
  nome: string;
  local: string;
  data: string | null;
  horaInicio: string;
  horaFim?: string | null;
  recorrencia: 'NENHUMA' | 'SEMANAL';
  diaSemana?: number | null;
  serieId?: string | null;
  trailerId: string;
  status: 'ABERTO' | 'FECHADO';
  encerradoEm?: string | null;
  trailer?: Pick<Trailer, 'id' | 'nome' | 'identificador' | 'ativo'> | null;
  serie?: { id: string; nome: string; diaSemana: number | null } | null;
  _count?: { comandas: number; ocorrencias?: number };
}

export interface EventosResponse {
  series: Evento[];
  sessoes: Evento[];
  agendamentoExclusoes?: AgendamentoExclusao[];
}

export interface AgendamentoExclusao {
  serieId: string;
  data: string;
}

export interface TrailerOperacional extends Trailer {
  eventoAberto: Evento | null;
}

export interface Cliente {
  id: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  dataNascimento?: string | null;
  optInMarketing?: boolean;
  optInEm?: string | null;
  cadastradoVia?: 'STAFF' | 'AUTO_ATENDIMENTO' | 'COMANDA';
  observacoes?: string | null;
  ativo?: boolean;
  createdAt?: string;
  updatedAt?: string;
  estatisticas?: ClienteEstatisticas | null;
  totalGasto?: number;
  podeExcluir?: boolean;
  motivoExclusao?: string | null;
  comandasAbertas?: number;
  comandasFechadas?: number;
}

export interface ClienteEstatisticas {
  clienteId: string;
  totalComandasFechadas: number;
  totalGasto: number;
  totalMlChope: number;
  primeiraVisitaEm: string | null;
  ultimaVisitaEm: string | null;
  updatedAt: string;
}

export interface ClienteListResponse {
  items: Cliente[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface UnirClientesResponse extends Cliente {
  comandasMovidas: number;
  pedidosMovidos: number;
}

export interface ClienteHistoricoItem {
  id: string;
  total: number;
  fechadaEm: string;
  evento: { id: string; nome: string; local: string; data: string | null };
  itens: {
    id: string;
    produto: string;
    volumeMl: number;
    quantidade: number;
    precoUnit: number;
    subtotal: number;
  }[];
  pagamentos: { forma: string; valor: number }[];
}

export interface ClienteHistoricoResponse {
  items: ClienteHistoricoItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface PublicCervejariaInfo {
  nome: string;
  slug: string;
  logoUrl?: string | null;
  corPrimaria?: string | null;
  corPaleta?: BrandTheme | null;
}

export interface PortalTrailerInfo {
  cervejaria: PublicCervejariaInfo;
  trailer: { id: string; nome: string; identificador?: string | null };
  evento: {
    id: string;
    nome: string;
    local: string;
    data: string | null;
    horaInicio?: string;
    horaFim?: string | null;
  } | null;
  disponivel: boolean;
}

export interface PortalCardapioChope {
  tapId: string;
  tapNumero: number;
  tapNome?: string | null;
  produto: {
    id: string;
    nome: string;
    cor?: string | null;
    estilo?: string | null;
    precos: { volumeMl: number; preco: number }[];
  };
}

export interface PortalCardapioProduto {
  id: string;
  nome: string;
  descricao?: string | null;
  tipo: string;
  formato?: string | null;
  precos: { volumeMl: number; preco: number }[];
}

export interface PortalCardapio {
  chopes: PortalCardapioChope[];
  bebidas: PortalCardapioProduto[];
  comidas: PortalCardapioProduto[];
}

export interface PortalComandaItem {
  id: string;
  produto: string;
  volumeMl: number;
  quantidade: number;
  precoUnit: number;
  subtotal: number;
}

export interface PedidoClienteItem {
  id: string;
  produtoId: string;
  tapId?: string | null;
  volumeMl: number;
  quantidade: number;
  precoUnit: number;
  produto: { id: string; nome: string };
}

export type PedidoClienteStatus = 'PENDENTE' | 'CONFIRMADO' | 'RECUSADO' | 'CANCELADO';

export interface PedidoCliente {
  id: string;
  status: PedidoClienteStatus;
  observacao?: string | null;
  recusadoMotivo?: string | null;
  totalEstimado: number;
  createdAt: string;
  confirmadoEm?: string | null;
  itens: PedidoClienteItem[];
  cliente?: { id: string; nome: string; telefone?: string | null };
}

export interface PortalComanda {
  id: string;
  status: string;
  total: number;
  itens: PortalComandaItem[];
  pedidos: PedidoCliente[];
}

export interface PortalClienteLookupResponse {
  encontrado: boolean;
  nome?: string;
}

export interface PortalSessaoResponse {
  cliente: { id: string; nome: string };
  evento: NonNullable<PortalTrailerInfo['evento']>;
  trailer: PortalTrailerInfo['trailer'];
  cervejaria: PublicCervejariaInfo;
  comanda: PortalComanda;
}

export interface ItemComanda {
  id: string;
  produtoId: string;
  volumeMl: number;
  quantidade: number;
  precoUnit: string;
  produto: Produto;
  createdAt: string;
}

export interface Pagamento {
  id: string;
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';
  valor: string;
  pagoEm: string;
}

export interface Comanda {
  id: string;
  eventoId: string;
  clienteId: string;
  status: 'ABERTA' | 'FECHADA' | 'CANCELADA';
  tipo?: 'COMANDA' | 'AVULSA';
  total: string;
  cliente: Cliente;
  itens: ItemComanda[];
  pagamentos: Pagamento[];
  createdAt: string;
  updatedAt: string;
}

export interface FecharGrupoResponse {
  totalGrupo: number;
  comandas: Comanda[];
  canceladas: Comanda[];
}

export interface EventoDashboardProduto {
  produtoId: string;
  nome: string;
  tipo: ProdutoTipo;
  formato?: FormatoBebida | null;
  volumeMl: number;
  quantidade: number;
  valor: number;
}

export interface EventoDashboard {
  evento: Pick<Evento, 'id' | 'nome' | 'local' | 'data' | 'horaInicio' | 'horaFim' | 'status'>;
  resumo: {
    comandasAbertas: number;
    comandasFechadas: number;
    vendasAvulsas: number;
    valorAberto: number;
    valorFechado: number;
    receitaAvulsa: number;
  };
  porProduto: {
    aberto: EventoDashboardProduto[];
    fechado: EventoDashboardProduto[];
  };
}

export interface RankingEntry {
  posicao: number;
  clienteId: string;
  nome: string;
  telefone?: string | null;
  totalMl: number;
  totalValor: number;
  pedidos: number;
}

export interface RankingSerieResponse {
  serie: {
    id: string;
    nome: string;
    local: string;
    diaSemana: number | null;
  };
  escopo: 'mensal' | 'geral';
  mes: string | null;
  mesesDisponiveis: string[];
  entries: RankingEntry[];
}

export interface RankingPeriodoResponse {
  evento: {
    id: string;
    nome: string;
    local: string;
    data: string;
    trailerId: string;
    trailer?: Pick<Trailer, 'id' | 'nome' | 'identificador'> | null;
  };
  escopo: 'mensal' | 'geral';
  mes: string | null;
  mesesDisponiveis: string[];
  entries: RankingEntry[];
}

export interface CervejariaDashboard {
  periodo: { ano: number; mes: number; label: string };
  resumo: {
    receitaTotal: number;
    comandasAtendidas: number;
    vendasAvulsas: number;
    receitaAvulsa: number;
    ticketMedio: number;
    chopeMl: number;
    variacaoReceitaMesAnterior: number | null;
  };
  evolucaoSemanal: Array<{
    semana: number;
    label: string;
    receita: number;
    comandas: number;
  }>;
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
  eventosRecentes: Array<{
    eventoId: string;
    nome: string;
    local: string;
    data: string;
    horaInicio: string;
    receitaTotal: number;
    comandasAtendidas: number;
    vendasAvulsas: number;
    receitaAvulsa: number;
    ticketMedio: number;
    chopeMl: number;
    duracaoHoras: number;
    receitaPorHora: number;
    chopeLitrosPorHora: number;
  }>;
  receitaAnual: Array<{
    mes: number;
    label: string;
    receita: number;
    comandas: number;
  }>;
  anoVigente: number;
}

export interface EventoResumoExecutivo {
  evento: Pick<Evento, 'id' | 'nome' | 'local' | 'data' | 'horaInicio' | 'horaFim' | 'status'>;
  resumo: {
    receitaTotal: number;
    comandasAtendidas: number;
    comandasRegulares: number;
    vendasAvulsas: number;
    receitaAvulsa: number;
    ticketMedio: number;
    chopeMl: number;
    clientesUnicos: number;
  };
  vendasPorIntervalo: Array<{
    intervalo: string;
    inicio: string;
    receita: number;
    comandas: number;
  }>;
  fluxoPorIntervalo: Array<{
    intervalo: string;
    inicio: string;
    pedido: number;
    fechado: number;
    fechadoAvulsa: number;
    aberto: number;
    chopeMl: number;
    itens: number;
    comandasFechadas: number;
    comandasAvulsas: number;
  }>;
  tempoComanda: {
    mediaMinutos: number;
    distribuicao: Array<{ faixa: string; comandas: number }>;
  };
  porPagamento: Array<{ forma: string; valor: number; percentual: number }>;
  porProduto: Array<{
    produtoId: string;
    nome: string;
    tipo: string;
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
  rankingTop: Array<{
    posicao: number;
    clienteId: string;
    nome: string;
    totalMl: number;
    totalValor: number;
    pedidos: number;
  }>;
  temOutrosProdutos: boolean;
  topClientes: Array<{
    posicao: number;
    clienteId: string;
    nome: string;
    receita: number;
    comandas: number;
  }>;
}

export const VOLUMES = [300, 500, 700] as const;
export type VolumeMl = (typeof VOLUMES)[number];

export const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO: 'Cartão',
  CARTAO_DEBITO: 'Cartão débito',
  CARTAO_CREDITO: 'Cartão crédito',
};

export function formatItemDetail(item: Pick<ItemComanda, 'volumeMl' | 'quantidade' | 'produto'>): string {
  if (isVendaUnitaria(item.produto)) {
    if (item.produto.tipo === 'BEBIDA' && item.produto.formato && item.produto.formato !== 'CHOPE') {
      const label = FORMATO_BEBIDA_LABELS[item.produto.formato];
      return item.quantidade > 1 ? `${item.quantidade}× ${label}` : label;
    }
    return item.quantidade > 1 ? `${item.quantidade} unidades` : '1 unidade';
  }
  return `${item.volumeMl}ml × ${item.quantidade}`;
}
