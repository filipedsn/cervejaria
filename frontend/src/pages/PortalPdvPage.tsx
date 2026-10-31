import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError, assetUrl, formatCurrency } from '../lib/api';
import { createCorrelationId } from '../lib/correlation-id';
import { formatPhone } from '../lib/phone';
import { formatPersonNameInput } from '../lib/person-name';
import { Loading } from '../components/Loading';
import { PortalBackground } from '../components/PortalBackground';
import { Modal } from '../components/Modal';
import { IconChefHat, IconClipboard, IconPackage, IconPlus } from '../components/NavIcons';
import { CATEGORIAS_PRODUTO_OPERACAO, normalizeCategoriaProduto, rotuloStatusPedido, type StatusPedido } from '../lib/operacao';

type Info = {
  cervejaria: { nome: string; logoUrl?: string | null; portalBackgroundUrl?: string | null };
  pontoVenda: { nome: string };
  disponivel: boolean;
};

type PdvProduct = {
  id: string;
  nome: string;
  descricao?: string | null;
  tipo: string;
  categoria?: string | null;
  precoEfetivo?: number;
  volumeMl?: number;
  gruposOpcionais?: Array<{ id: string; nome: string; opcoes: Array<{ id: string; nome: string; precoAdicional: number }> }>;
};

type PdvChope = {
  tapId: string;
  tapNumero: number;
  tapNome?: string | null;
  produto: { id: string; nome: string; precos: Array<{ volumeMl: number; preco: number }> };
};

type PdvCardapio = {
  produtos: PdvProduct[];
  chopes?: PdvChope[];
  ordemCategorias?: string[];
};

type PdvCardapioResponse = PdvCardapio | PdvProduct[];

type PdvComanda = {
  id: string;
  numero: number | null;
  cliente: { nome: string; telefone: string | null } | null;
  subtotal: number;
  total: number;
  desconto: number;
  valorEmAberto: number;
  solicitacaoPagamentoEm?: string | null;
  pedidos: Array<{ id: string; numero: number; status: StatusPedido | string; itens: Array<{ nome: string; quantidade: number; subtotal: number; cancelamentoPendenteEm?: string | null; canceladoEm?: string | null }> }>;
};

function rotuloStatusPortal(status: string): string {
  switch (status) {
    case 'RECEBIDO':
    case 'EM_PREPARO':
    case 'PRONTO':
    case 'ENTREGUE':
    case 'CANCELAMENTO_PENDENTE':
    case 'CANCELADO':
      return rotuloStatusPedido(status);
    default:
      return status;
  }
}

type PdvCartItem = {
  chave: string;
  produtoId: string;
  tapId?: string;
  volumeMl?: number;
  nome: string;
  quantidade: number;
  preco: number;
  paraViagem: boolean;
  observacao?: string;
  opcionais: Array<{ opcionalId: string; quantidade: number; nome: string; precoAdicional: number }>;
};

/** Chope comes once per volume with the same product id. */
const chaveProduto = (product: PdvProduct) => `${product.id}:${product.volumeMl ?? 0}`;
const nomeProduto = (product: PdvProduct) => ((product.volumeMl ?? 0) > 1 ? `${product.nome} ${product.volumeMl} ml` : product.nome);

function ReceiptIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-icon portal-login-icon--receipt"><path d="M9 4h14v23l-3.5-2.5L16 27l-3.5-2.5L9 27V4Z" /><path d="M12.5 10h7M12.5 14h7M12.5 18h5" /></svg>;
}

function UserIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-field-icon"><circle cx="16" cy="10" r="5" /><path d="M7 27c.8-5.2 3.7-8 9-8s8.2 2.8 9 8" /></svg>;
}

function PhoneIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-field-icon"><path d="M9 5.5 13 4l3 7-3 2c1.3 3 3 4.7 6 6l2-3 7 3-1.5 4c-.5 1.4-2 2.2-3.4 1.8C14 22.6 8.4 17 6.2 7.9 5.8 6.5 7.6 6 9 5.5Z" /></svg>;
}

function isPortalCaixaFechadoError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (error.body?.code === 'PORTAL_CAIXA_FECHADO') return true;
  return /não estamos aberto|abra o caixa|caixa não habilitado/i.test(error.message);
}

function PortalFechadoCard({ nomeEstabelecimento }: { nomeEstabelecimento: string }) {
  return (
    <div className="portal-login-card portal-login-card--closed text-center space-y-3" role="status">
      <div className="portal-login-heading justify-center">
        <ReceiptIcon />
        <div>
          <h1>No momento não estamos aberto</h1>
          <p>O atendimento neste caixa está encerrado agora.</p>
        </div>
      </div>
      <p className="portal-pdv-muted leading-relaxed">
        Volte mais tarde ou fale com a equipe de {nomeEstabelecimento}.
      </p>
    </div>
  );
}

export function PortalPdvPage() {
  const { slug, pontoVendaId } = useParams<{ slug: string; pontoVendaId: string }>();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [result, setResult] = useState<{ numero: number | null; reused: boolean; comanda: PdvComanda } | null>(null);
  const [menuTab, setMenuTab] = useState<'pedidos' | 'resumo'>('pedidos');
  const [catalogTab, setCatalogTab] = useState<string>('');
  const [tapSelecionadaId, setTapSelecionadaId] = useState('');
  const [volumeChopeMl, setVolumeChopeMl] = useState<number | undefined>(undefined);
  const [quantidadeChope, setQuantidadeChope] = useState(1);
  const [cart, setCart] = useState<PdvCartItem[]>([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState<PdvProduct | null>(null);
  const [quantidadeItem, setQuantidadeItem] = useState(1);
  const [paraViagem, setParaViagem] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [opcionais, setOpcionais] = useState<Record<string, number>>({});
  const [forceClosed, setForceClosed] = useState(false);
  const pedidoKey = useRef<string | null>(null);
  const lastLookupPhone = useRef('');

  const info = useQuery({
    queryKey: ['portal-pdv-info', slug, pontoVendaId],
    queryFn: () => api.get<Info>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/info`),
    enabled: Boolean(slug && pontoVendaId),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.disponivel ? false : 15_000),
  });

  // O cookie mantém a sessão do cliente mesmo se o navegador suspender ou
  // recriar a página ao minimizar o portal. O estado React, sozinho, não é
  // suficiente nesse cenário.
  const sessaoComanda = useQuery({
    queryKey: ['portal-pdv-sessao', slug, pontoVendaId],
    queryFn: () => api.get<PdvComanda>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/comanda`),
    enabled: Boolean(info.data?.disponivel && slug && pontoVendaId),
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (result || !sessaoComanda.data) return;
    setNome(sessaoComanda.data.cliente?.nome ?? '');
    setTelefone(formatPhone(sessaoComanda.data.cliente?.telefone ?? ''));
    setResult({ numero: sessaoComanda.data.numero, reused: true, comanda: sessaoComanda.data });
  }, [result, sessaoComanda.data]);

  const abrir = useMutation({
    mutationFn: () =>
      api.post<{
        comanda: PdvComanda;
        reused: boolean;
        pontoVenda: { nome: string };
      }>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/comandas`, { nome, telefone }),
    onSuccess: (data) => setResult({ numero: data.comanda.numero, reused: data.reused, comanda: data.comanda }),
    onError: (error) => {
      if (isPortalCaixaFechadoError(error)) {
        setForceClosed(true);
        void info.refetch();
      }
    },
  });

  const caixaFechado = forceClosed || info.data?.disponivel === false;

  const cardapio = useQuery({
    queryKey: ['portal-pdv-cardapio', result?.comanda.id],
    queryFn: () => api.get<PdvCardapioResponse>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/cardapio`),
    enabled: Boolean(result),
  });

  const categoriasCardapio = useQuery({
    queryKey: ['portal-pdv-cardapio-categorias', result?.comanda.id],
    queryFn: () => api.get<{ ordemCategorias: string[]; catalogoCanonico?: boolean }>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/cardapio/categorias`),
    enabled: Boolean(result),
    retry: false,
  });

  const comandaQuery = useQuery({
    queryKey: ['portal-pdv-comanda', result?.comanda.id],
    queryFn: () => api.get<PdvComanda>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/comanda`),
    enabled: Boolean(result),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  const enviarPedido = useMutation({
    mutationFn: (itens: PdvCartItem[]) => api.post<PdvComanda>(
      `/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/comanda/pedidos`,
      {
        // createCorrelationId funciona em HTTP por IP LAN; crypto.randomUUID não.
        idempotencyKey: pedidoKey.current ?? (pedidoKey.current = createCorrelationId()),
        itens: itens.map((item) => ({
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          ...(item.volumeMl ? { volumeMl: item.volumeMl } : {}),
          ...(item.tapId ? { tapId: item.tapId } : {}),
          paraViagem: item.paraViagem,
          observacao: item.observacao,
          opcionais: item.opcionais.map(({ opcionalId, quantidade }) => ({ opcionalId, quantidade })),
        })),
      },
    ),
    onSuccess: (data) => {
      setCart([]);
      pedidoKey.current = null;
      setResult((prev) => prev ? { ...prev, comanda: data } : prev);
      void comandaQuery.refetch();
    },
  });

  const solicitarPagamento = useMutation({
    mutationFn: () => api.post<{ pendente: boolean }>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/comanda/solicitar-pagamento`, {}),
    onSuccess: () => void comandaQuery.refetch(),
  });

  const displayedComanda = comandaQuery.data ?? result?.comanda;
  const itensValidos = (itens: PdvComanda['pedidos'][number]['itens']) =>
    itens.filter((item) => !item.cancelamentoPendenteEm && !item.canceladoEm);
  const totalConsumido = displayedComanda?.total ?? 0;
  const valorEmAberto = displayedComanda?.valorEmAberto ?? 0;
  const closeProductModal = () => {
    setProdutoSelecionado(null);
    setQuantidadeItem(1);
    setParaViagem(false);
    setObservacao('');
    setOpcionais({});
  };
  const addProduct = (product: PdvProduct) => {
    setProdutoSelecionado(product);
    setQuantidadeItem(1);
    setParaViagem(false);
    setObservacao('');
    setOpcionais({});
  };
  const confirmProduct = () => {
    const product = produtoSelecionado;
    if (!product) return;
    const chave = chaveProduto(product);
    const options = product.gruposOpcionais?.flatMap((group) => group.opcoes.filter((option) => opcionais[option.id]).map((option) => ({ opcionalId: option.id, nome: option.nome, precoAdicional: option.precoAdicional, quantidade: opcionais[option.id] }))) ?? [];
    const details = `${chave}:${paraViagem}:${observacao.trim()}:${JSON.stringify(options.map(({ opcionalId, quantidade }) => [opcionalId, quantidade]))}`;
    const volumeMl = (product.volumeMl ?? 0) > 1 ? product.volumeMl : undefined;
    const base = product.precoEfetivo ?? 0;
    const name = nomeProduto(product);
    const unitPrice = base + options.reduce((sum, option) => sum + option.precoAdicional * option.quantidade, 0);
    setCart((current) => {
      const existing = current.find((item) => item.chave === details);
      if (existing) {
        return current.map((item) =>
          item.chave === details ? { ...item, quantidade: item.quantidade + quantidadeItem } : item,
        );
      }
      return [...current, {
        chave: details,
        produtoId: product.id,
        volumeMl,
        nome: name,
        quantidade: quantidadeItem,
        preco: unitPrice,
        paraViagem,
        observacao: observacao.trim() || undefined,
        opcionais: options,
      }];
    });
    closeProductModal();
  };
  const changeQuantity = (chave: string, delta: number) => {
    setCart((current) => current
      .map((item) => item.chave === chave ? { ...item, quantidade: item.quantidade + delta } : item)
      .filter((item) => item.quantidade > 0));
  };
  const cartTotal = cart.reduce((total, item) => total + item.preco * item.quantidade, 0);

  const produtosCardapio = Array.isArray(cardapio.data) ? cardapio.data : (cardapio.data?.produtos ?? []);
  const chopesCardapio = Array.isArray(cardapio.data) ? [] : (cardapio.data?.chopes ?? []);
  const ordemCategorias = categoriasCardapio.data?.ordemCategorias
    ?? (Array.isArray(cardapio.data) ? CATEGORIAS_PRODUTO_OPERACAO : (cardapio.data?.ordemCategorias ?? CATEGORIAS_PRODUTO_OPERACAO));
  const ABA_CHOPES = '__chopes__';

  const produtosPorCategoria = (() => {
    const grupos = new Map<string, PdvProduct[]>();
    for (const product of produtosCardapio) {
      const categoria = categoriasCardapio.data?.catalogoCanonico
        ? product.categoria?.trim() || 'Outros'
        : normalizeCategoriaProduto(product.categoria);
      if (categoria.trim().toLocaleLowerCase('pt-BR') === 'chope') continue;
      grupos.set(categoria, [...(grupos.get(categoria) ?? []), product]);
    }
    const prioridade = new Map<string, number>(ordemCategorias.map((categoria, index) => [categoria, index]));
    return [...grupos.entries()].sort(([a], [b]) => (prioridade.get(a) ?? Infinity) - (prioridade.get(b) ?? Infinity));
  })();

  const catalogTabs = [
    ...(chopesCardapio.length > 0 ? [{ id: ABA_CHOPES, label: 'Chopes' }] : []),
    ...produtosPorCategoria.map(([categoria]) => ({ id: categoria, label: categoria })),
  ];
  const catalogTabsKey = catalogTabs.map((tab) => tab.id).join('\u001f');
  useEffect(() => {
    if (!catalogTabs.length) {
      setCatalogTab('');
      return;
    }
    setCatalogTab((current) => (catalogTabs.some((tab) => tab.id === current) ? current : catalogTabs[0]!.id));
  }, [catalogTabsKey]);

  const catalogTabAtiva = catalogTabs.some((tab) => tab.id === catalogTab) ? catalogTab : catalogTabs[0]?.id;
  const tapSelecionada = chopesCardapio.find((chope) => chope.tapId === tapSelecionadaId);
  const volumeChopeSelecionado = tapSelecionada?.produto.precos.find((preco) => preco.volumeMl === volumeChopeMl);
  const podeAdicionarChope = Boolean(tapSelecionada && volumeChopeSelecionado && volumeChopeSelecionado.preco > 0 && quantidadeChope > 0);

  const selecionarTapPortal = (tapId: string) => {
    setTapSelecionadaId(tapId);
    setVolumeChopeMl(undefined);
    setQuantidadeChope(1);
  };

  const adicionarChopeAoCarrinho = () => {
    if (!tapSelecionada || !volumeChopeSelecionado) return;
    const volumeMl = volumeChopeSelecionado.volumeMl;
    const preco = volumeChopeSelecionado.preco;
    const nome = `${tapSelecionada.produto.nome} ${volumeMl} ml`;
    const chave = `chope:${tapSelecionada.tapId}:${tapSelecionada.produto.id}:${volumeMl}`;
    setCart((current) => {
      const existing = current.find((item) => item.chave === chave);
      if (existing) {
        return current.map((item) =>
          item.chave === chave ? { ...item, quantidade: item.quantidade + quantidadeChope } : item,
        );
      }
      return [...current, {
        chave,
        produtoId: tapSelecionada.produto.id,
        tapId: tapSelecionada.tapId,
        volumeMl,
        nome,
        quantidade: quantidadeChope,
        preco,
        paraViagem: false,
        opcionais: [],
      }];
    });
    setVolumeChopeMl(undefined);
    setQuantidadeChope(1);
  };

  const buscarCliente = useMutation({
    mutationFn: (phone: string) =>
      api.get<{ encontrado: boolean; nome?: string }>(
        `/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/cliente-por-telefone?telefone=${encodeURIComponent(phone)}`,
      ),
    onSuccess: (data) => {
      setNome(data.encontrado && data.nome ? data.nome : '');
    },
  });

  const background = assetUrl(info.data?.cervejaria.portalBackgroundUrl);

  if (info.isLoading) return <Loading fullScreen />;
  if (!info.data) {
    return (
      <div className="portal-background-host portal-shell min-h-screen grid place-items-center p-4">
        <PortalBackground />
        <p className="portal-login-card text-center">Este QR Code não é válido.</p>
      </div>
    );
  }

  const cartDockVisible = Boolean(result && menuTab === 'pedidos' && cart.length > 0);

  return (
    <main className="portal-background-host portal-shell min-h-screen px-4 py-8 safe-area-pt safe-area-pb">
      <PortalBackground src={background} />
      <div className="portal-login-content">
        <div className="portal-login-brand">
          {info.data.cervejaria.logoUrl ? (
            <img
              src={assetUrl(info.data.cervejaria.logoUrl) ?? undefined}
              alt={info.data.cervejaria.nome}
              className="portal-login-logo"
            />
          ) : (
            <div className="portal-login-logo-fallback">{info.data.cervejaria.nome}</div>
          )}
        </div>

        {caixaFechado ? (
          <PortalFechadoCard nomeEstabelecimento={info.data.cervejaria.nome} />
        ) : result ? (
          <section className={`portal-pdv-workspace${cartDockVisible ? ' portal-pdv-workspace--with-cart' : ''}`}>
            <div className="portal-pdv-account">
              <div>
                <h2>{displayedComanda?.cliente?.nome ?? nome}</h2>
                <p>{telefone}</p>
              </div>
              <strong>R$ {totalConsumido.toFixed(2).replace('.', ',')}</strong>
            </div>
            <p className="portal-pdv-status">
              {result.reused ? 'Comanda já está aberta.' : `Comanda aberta · senha ${result.numero ?? '—'}.`} O atendente confirma e prepara seus pedidos.
            </p>
            <div className="portal-pdv-tabs">
              <button type="button" className={menuTab === 'pedidos' ? 'active' : ''} onClick={() => setMenuTab('pedidos')}>Pedidos ({cart.length})</button>
              <button type="button" className={menuTab === 'resumo' ? 'active' : ''} onClick={() => setMenuTab('resumo')}>Resumo da conta</button>
            </div>
            {menuTab === 'pedidos' && (
              <div className="portal-pdv-orders">
                <h3>Escolha seus itens</h3>
                {catalogTabs.length > 0 ? (
                  <div
                    className="segmented-control grid mb-4"
                    style={{ gridTemplateColumns: `repeat(${catalogTabs.length}, minmax(0, 1fr))` }}
                  >
                    {catalogTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`segmented-control-btn ${catalogTabAtiva === tab.id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
                        onClick={() => {
                          setCatalogTab(tab.id);
                          if (tab.id !== ABA_CHOPES) {
                            setTapSelecionadaId('');
                            setVolumeChopeMl(undefined);
                            setQuantidadeChope(1);
                          }
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {catalogTabAtiva === ABA_CHOPES && chopesCardapio.length > 0 ? (
                  <div className="portal-pdv-chope">
                    <section>
                      <h4 className="portal-pdv-section-label">Escolha a Tap</h4>
                      <div className="portal-pdv-chope-taps">
                        {chopesCardapio.map((chope) => {
                          const selecionada = tapSelecionada?.tapId === chope.tapId;
                          return (
                            <button
                              key={chope.tapId}
                              type="button"
                              aria-pressed={selecionada}
                              aria-label={`Selecionar Tap ${String(chope.tapNumero).padStart(2, '0')}, ${chope.produto.nome}`}
                              className="portal-pdv-chope-tap"
                              onClick={() => selecionarTapPortal(chope.tapId)}
                            >
                              <span className="portal-pdv-chope-tap-badge">
                                {String(chope.tapNumero).padStart(2, '0')}
                              </span>
                              <span className="portal-pdv-chope-tap-name">{chope.produto.nome}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                    {tapSelecionada ? (
                      <>
                        <section>
                          <h4 className="portal-pdv-section-label">Volume</h4>
                          <div className="portal-pdv-chope-volumes">
                            {tapSelecionada.produto.precos.map((opcao) => {
                              const ativo = volumeChopeMl === opcao.volumeMl;
                              return (
                                <button
                                  key={`${tapSelecionada.tapId}-${opcao.volumeMl}`}
                                  type="button"
                                  aria-pressed={ativo}
                                  className="portal-pdv-chope-volume"
                                  onClick={() => setVolumeChopeMl(opcao.volumeMl)}
                                >
                                  <span className="portal-pdv-chope-volume-ml">{opcao.volumeMl} ml</span>
                                  <span className="portal-pdv-chope-volume-price">{formatCurrency(opcao.preco)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                        {volumeChopeSelecionado ? (
                          <div className="portal-pdv-chope-preview">
                            <div className="portal-pdv-chope-preview-copy">
                              <strong>
                                {tapSelecionada.produto.nome} {volumeChopeSelecionado.volumeMl} ml
                              </strong>
                              <small>Tap {tapSelecionada.tapNumero}</small>
                              <small>{formatCurrency(volumeChopeSelecionado.preco)} cada</small>
                            </div>
                            <div className="portal-pdv-chope-preview-total">
                              <span>Total</span>
                              <strong>{formatCurrency(volumeChopeSelecionado.preco * quantidadeChope)}</strong>
                            </div>
                          </div>
                        ) : null}
                        <section className="portal-pdv-chope-qty">
                          <span>Quantidade</span>
                          <div className="portal-pdv-chope-qty-controls">
                            <button
                              type="button"
                              aria-label="Diminuir quantidade"
                              onClick={() => setQuantidadeChope((atual) => Math.max(1, atual - 1))}
                            >
                              −
                            </button>
                            <strong>{quantidadeChope}</strong>
                            <button
                              type="button"
                              aria-label="Aumentar quantidade"
                              onClick={() => setQuantidadeChope((atual) => atual + 1)}
                            >
                              +
                            </button>
                          </div>
                        </section>
                        <button
                          type="button"
                          className="portal-pdv-chope-add"
                          disabled={!podeAdicionarChope}
                          onClick={adicionarChopeAoCarrinho}
                        >
                          Adicionar ao pedido
                        </button>
                      </>
                    ) : (
                      <p className="portal-pdv-muted">Toque em uma Tap para escolher o volume.</p>
                    )}
                  </div>
                ) : catalogTabAtiva ? (
                  <div className="portal-pdv-product-grid">
                    {(produtosPorCategoria.find(([categoria]) => categoria === catalogTabAtiva)?.[1] ?? []).map((product) => (
                      <button type="button" key={chaveProduto(product)} className="portal-pdv-product" onClick={() => addProduct(product)}>
                        <span><strong>{nomeProduto(product)}</strong>{product.descricao && <small>{product.descricao}</small>}</span>
                        <b>+ R$ {(product.precoEfetivo ?? 0).toFixed(2).replace('.', ',')}</b>
                      </button>
                    ))}
                  </div>
                ) : null}
                {cardapio.isLoading && <p className="portal-pdv-muted">Carregando cardápio...</p>}
                {!cardapio.isLoading && !produtosCardapio.length && !chopesCardapio.length && (
                  <p className="portal-pdv-muted">Nenhum item disponível neste caixa.</p>
                )}
                {cartDockVisible ? (
                  <div className="portal-pdv-cart portal-pdv-cart--dock">
                    <div>
                      <strong>Novo pedido</strong>
                      <span>R$ {cartTotal.toFixed(2).replace('.', ',')}</span>
                    </div>
                    {cart.map((item) => {
                      const detalhes = [...item.opcionais.map((option) => option.nome), item.paraViagem ? 'Para levar' : '', item.observacao].filter(Boolean).join(' · ');
                      return (
                        <div className="portal-pdv-cart-item" key={item.chave}>
                          <span className="portal-pdv-cart-item-copy">
                            <strong>{item.nome}</strong>
                            {detalhes ? <small>{detalhes}</small> : null}
                          </span>
                          <div className="portal-pdv-quantity" aria-label={`Quantidade de ${item.nome}`}>
                            <button type="button" aria-label={`Diminuir ${item.nome}`} onClick={() => changeQuantity(item.chave, -1)}>−</button>
                            <strong>{item.quantidade}</strong>
                            <button type="button" aria-label={`Aumentar ${item.nome}`} onClick={() => changeQuantity(item.chave, 1)}>+</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="portal-pdv-cart-actions">
                      <button type="button" className="portal-pdv-cart-cancel" onClick={() => setCart([])} disabled={enviarPedido.isPending}>
                        Cancelar
                      </button>
                      <button type="button" onClick={() => enviarPedido.mutate(cart)} disabled={enviarPedido.isPending}>
                        {enviarPedido.isPending ? 'Enviando...' : 'Enviar pedido'}
                      </button>
                    </div>
                    {enviarPedido.error && (
                      <div role="alert" className="alert-error">
                        {enviarPedido.error instanceof ApiError
                          ? enviarPedido.error.message
                          : 'Não foi possível enviar o pedido. Atualize a página e tente de novo; se continuar, fale com a equipe do caixa.'}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {menuTab === 'resumo' && (
              <div className="portal-pdv-summary">
                <h3>Pedidos enviados</h3>
                <div className="portal-pdv-account-totals">
                  <div><span>Consumido</span><strong>R$ {totalConsumido.toFixed(2).replace('.', ',')}</strong></div>
                  <div><span>Valor em aberto</span><strong>R$ {valorEmAberto.toFixed(2).replace('.', ',')}</strong></div>
                </div>
                {displayedComanda?.pedidos?.length ? displayedComanda.pedidos.map((pedido) => (
                  <article key={pedido.id}>
                    <strong>Pedido #{pedido.numero}</strong>
                    <span>{rotuloStatusPortal(pedido.status)}</span>
                    {itensValidos(pedido.itens).map((item, index) => (
                      <p key={`${item.nome}-${index}`}>{item.quantidade}x {item.nome}<small>R$ {item.subtotal.toFixed(2).replace('.', ',')}</small></p>
                    ))}
                  </article>
                )) : <p>Nenhum pedido enviado ainda.</p>}
                <p className="portal-pdv-no-close">O fechamento e o pagamento são feitos pela equipe do caixa.</p>
                <button
                  type="button"
                  className="portal-pdv-payment-request"
                  disabled={Boolean(displayedComanda?.solicitacaoPagamentoEm) || solicitarPagamento.isPending}
                  onClick={() => solicitarPagamento.mutate()}
                >
                  {displayedComanda?.solicitacaoPagamentoEm
                    ? 'Pagamento solicitado · aguarde a equipe'
                    : solicitarPagamento.isPending
                      ? 'Solicitando...'
                      : 'Solicitar pagamento'}
                </button>
                {solicitarPagamento.error && <div role="alert" className="alert-error">Não foi possível solicitar atendimento.</div>}
              </div>
            )}
          </section>
        ) : (
          <form
            className="portal-login-card"
            onSubmit={(e) => {
              e.preventDefault();
              abrir.mutate();
            }}
          >
            <div className="portal-login-heading">
              <ReceiptIcon />
              <div>
                <h1>Abrir comanda</h1>
                <p>Informe seus dados para abrir sua comanda neste caixa.</p>
              </div>
            </div>
            {abrir.error && !isPortalCaixaFechadoError(abrir.error) && (
              <div className="alert-error" role="alert">
                {abrir.error instanceof ApiError && !/abra o caixa|caixa não habilitado/i.test(abrir.error.message)
                  ? abrir.error.message
                  : 'Não foi possível abrir a comanda. Tente de novo ou fale com a equipe.'}
              </div>
            )}
            <label htmlFor="portal-pdv-telefone" className="portal-login-field">
              <span><PhoneIcon />Telefone</span>
              <input
                id="portal-pdv-telefone"
                className="portal-login-input"
                type="tel"
                inputMode="numeric"
                placeholder="(XX) XXXXX-XXXX"
                value={telefone}
                onChange={(e) => {
                  const formatted = formatPhone(e.target.value);
                  const digits = formatted.replace(/\D/g, '');
                  setTelefone(formatted);
                  if (digits.length < 10) {
                    lastLookupPhone.current = '';
                    setNome('');
                  } else if ((digits.length === 10 || digits.length === 11) && digits !== lastLookupPhone.current) {
                    lastLookupPhone.current = digits;
                    buscarCliente.mutate(digits);
                  }
                }}
                required
                autoComplete="tel"
              />
            </label>
            <label htmlFor="portal-pdv-nome" className="portal-login-field">
              <span><UserIcon />Nome</span>
              <input
                id="portal-pdv-nome"
                className="portal-login-input"
                placeholder={buscarCliente.isPending ? 'Buscando cliente...' : 'Digite seu nome'}
                value={nome}
                onChange={(e) => setNome(formatPersonNameInput(e.target.value))}
                required
                autoComplete="name"
              />
            </label>
            <button className="portal-login-submit" disabled={abrir.isPending}>
              {abrir.isPending ? 'Abrindo...' : 'Abrir comanda'}
              {!abrir.isPending && <span aria-hidden="true" className="portal-login-arrow">›</span>}
            </button>
          </form>
        )}
      </div>
      <Modal
        open={Boolean(produtoSelecionado)}
        onClose={closeProductModal}
        title=""
        hideHeaderClose
        footer={(
          <>
            <button type="button" className="touch-btn-primary w-full flex items-center justify-center gap-2" onClick={confirmProduct}>
              <IconPlus className="h-5 w-5" />
              Adicionar item
            </button>
            <button type="button" className="touch-btn-orange w-full flex items-center justify-center gap-2" onClick={closeProductModal}>
              Voltar
            </button>
          </>
        )}
      >
        {produtoSelecionado && (
          <div className="space-y-6 rounded-2xl border border-line bg-surface-lighter p-5 sm:p-7">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-ink">{nomeProduto(produtoSelecionado)}</h2>
              <p className="mt-1 text-sm text-ink-muted">{formatCurrency(produtoSelecionado.precoEfetivo ?? 0)} por unidade</p>
            </div>

            <section className="space-y-3 border-b border-line pb-5">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
                  <IconChefHat className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Opcionais</h3>
                  <p className="text-sm text-ink-muted">Selecione os opcionais que desejar</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {produtoSelecionado.gruposOpcionais?.flatMap((group) => group.opcoes).map((option) => (
                  <label
                    key={option.id}
                    className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        className="h-5 w-5 accent-brand-500"
                        type="checkbox"
                        checked={Boolean(opcionais[option.id])}
                        onChange={() => setOpcionais((current) => (
                          current[option.id]
                            ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== option.id))
                            : { ...current, [option.id]: 1 }
                        ))}
                      />
                      <span className="font-semibold">{option.nome}</span>
                    </span>
                    <span className="text-sm text-ink-muted">
                      {option.precoAdicional > 0 ? `+${formatCurrency(option.precoAdicional)}` : 'Grátis'}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="flex items-center justify-between gap-4 border-b border-line pb-5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
                  <IconPackage className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Quantidade</h3>
                  <p className="text-sm text-ink-muted">Escolha a quantidade deste item</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-3 py-2">
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  className="min-h-10 min-w-10 rounded-xl bg-surface-lighter text-xl font-bold"
                  onClick={() => setQuantidadeItem((value) => Math.max(1, value - 1))}
                >
                  −
                </button>
                <span className="min-w-8 text-center text-2xl font-bold">{quantidadeItem}</span>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  className="min-h-10 min-w-10 rounded-xl bg-brand-600 text-xl font-bold text-white"
                  onClick={() => setQuantidadeItem((value) => value + 1)}
                >
                  <IconPlus className="mx-auto h-5 w-5" />
                </button>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
                  <IconChefHat className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Para viagem</h3>
                  <p className="text-sm text-ink-muted">A cozinha deve embalar este item</p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand-500"
                  checked={paraViagem}
                  onChange={(event) => setParaViagem(event.target.checked)}
                />
                <span className="font-semibold">Marcar item para viagem</span>
              </label>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
                  <IconClipboard className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Observação do item</h3>
                  <p className="text-sm text-ink-muted">Adicione alguma observação, se necessário</p>
                </div>
              </div>
              <textarea
                value={observacao}
                onChange={(event) => setObservacao(event.target.value)}
                maxLength={280}
                rows={2}
                placeholder="Ex.: sem cebola"
                className="w-full rounded-2xl border border-line bg-surface px-4 py-3"
              />
            </section>
          </div>
        )}
      </Modal>
    </main>
  );
}
