import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError, assetUrl } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { Loading } from '../components/Loading';
import { PortalBackground } from '../components/PortalBackground';
import { CATEGORIAS_PRODUTO_OPERACAO, normalizeCategoriaProduto } from '../lib/operacao';

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

type PdvCardapio = {
  produtos: PdvProduct[];
  ordemCategorias: string[];
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
  pedidos: Array<{ id: string; numero: number; status: string; itens: Array<{ nome: string; quantidade: number; subtotal: number; cancelamentoPendenteEm?: string | null; canceladoEm?: string | null }> }>;
};

type PdvCartItem = { chave: string; produtoId: string; volumeMl?: number; nome: string; quantidade: number; preco: number };

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

export function PortalPdvPage() {
  const { slug, pontoVendaId } = useParams<{ slug: string; pontoVendaId: string }>();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [result, setResult] = useState<{ numero: number | null; reused: boolean; comanda: PdvComanda } | null>(null);
  const [menuTab, setMenuTab] = useState<'pedidos' | 'resumo'>('pedidos');
  const [cart, setCart] = useState<PdvCartItem[]>([]);
  const lastLookupPhone = useRef('');

  const info = useQuery({
    queryKey: ['portal-pdv-info', slug, pontoVendaId],
    queryFn: () => api.get<Info>(`/api/public/cervejarias/${slug}/pontos-venda/${pontoVendaId}/info`),
    enabled: Boolean(slug && pontoVendaId),
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
  });

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
      { itens: itens.map((item) => ({ produtoId: item.produtoId, quantidade: item.quantidade, ...(item.volumeMl ? { volumeMl: item.volumeMl } : {}) })) },
    ),
    onSuccess: (data) => {
      setCart([]);
      setResult((prev) => prev ? { ...prev, comanda: data } : prev);
      void comandaQuery.refetch();
    },
  });

  const displayedComanda = comandaQuery.data ?? result?.comanda;
  const itensValidos = (itens: PdvComanda['pedidos'][number]['itens']) =>
    itens.filter((item) => !item.cancelamentoPendenteEm && !item.canceladoEm);
  const totalConsumido = displayedComanda?.total ?? 0;
  const valorEmAberto = displayedComanda?.valorEmAberto ?? 0;
  const addProduct = (product: PdvProduct) => {
    const chave = chaveProduto(product);
    setCart((current) => {
      const existing = current.find((item) => item.chave === chave);
      if (existing) return current.map((item) => item.chave === chave ? { ...item, quantidade: item.quantidade + 1 } : item);
      const volumeMl = (product.volumeMl ?? 0) > 1 ? product.volumeMl : undefined;
      return [...current, { chave, produtoId: product.id, volumeMl, nome: nomeProduto(product), quantidade: 1, preco: product.precoEfetivo ?? 0 }];
    });
  };
  const changeQuantity = (chave: string, delta: number) => {
    setCart((current) => current
      .map((item) => item.chave === chave ? { ...item, quantidade: item.quantidade + delta } : item)
      .filter((item) => item.quantidade > 0));
  };
  const cartTotal = cart.reduce((total, item) => total + item.preco * item.quantidade, 0);

  const produtosCardapio = Array.isArray(cardapio.data) ? cardapio.data : (cardapio.data?.produtos ?? []);
  const ordemCategorias = categoriasCardapio.data?.ordemCategorias
    ?? (Array.isArray(cardapio.data) ? CATEGORIAS_PRODUTO_OPERACAO : (cardapio.data?.ordemCategorias ?? CATEGORIAS_PRODUTO_OPERACAO));

  const produtosPorCategoria = (() => {
    const grupos = new Map<string, PdvProduct[]>();
    for (const product of produtosCardapio) {
      const categoria = categoriasCardapio.data?.catalogoCanonico
        ? product.categoria?.trim() || 'Outros'
        : normalizeCategoriaProduto(product.categoria);
      grupos.set(categoria, [...(grupos.get(categoria) ?? []), product]);
    }
    const prioridade = new Map<string, number>(ordemCategorias.map((categoria, index) => [categoria, index]));
    return [...grupos.entries()].sort(([a], [b]) => (prioridade.get(a) ?? Infinity) - (prioridade.get(b) ?? Infinity));
  })();

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
      <div className="min-h-screen grid place-items-center p-4">
        <p className="card">Este QR Code não é válido.</p>
      </div>
    );
  }

  return (
    <main className="portal-background-host min-h-screen bg-canvas px-4 py-8 safe-area-pt">
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
            <div className="portal-login-logo-fallback" aria-hidden="true">🍺</div>
          )}
        </div>

        {!info.data.disponivel ? (
          <div className="card text-center space-y-2">
            <h2 className="font-bold">Caixa indisponível</h2>
            <p className="text-sm text-ink-muted">
              Este ponto de venda não está atendendo agora. Procure a equipe.
            </p>
          </div>
        ) : result ? (
          <section className="portal-pdv-workspace">
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
                {cart.length > 0 && (
                  <div className="portal-pdv-cart">
                    <div>
                      <strong>Novo pedido</strong>
                      <span>R$ {cartTotal.toFixed(2).replace('.', ',')}</span>
                    </div>
                    {cart.map((item) => (
                      <div className="portal-pdv-cart-item" key={item.chave}>
                        <span>{item.nome}</span>
                        <div className="portal-pdv-quantity" aria-label={`Quantidade de ${item.nome}`}>
                          <button type="button" aria-label={`Diminuir ${item.nome}`} onClick={() => changeQuantity(item.chave, -1)}>−</button>
                          <strong>{item.quantidade}</strong>
                          <button type="button" aria-label={`Aumentar ${item.nome}`} onClick={() => changeQuantity(item.chave, 1)}>+</button>
                        </div>
                      </div>
                    ))}
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
                          : 'Não foi possível enviar o pedido. Procure a equipe do ponto de venda.'}
                      </div>
                    )}
                  </div>
                )}
                <h3>Escolha seus itens</h3>
                {produtosPorCategoria.map(([categoria, produtos]) => (
                  <section className="portal-pdv-category" key={categoria}>
                    <h4>{categoria}</h4>
                    <div className="portal-pdv-product-grid">
                      {produtos.map((product) => (
                        <button type="button" key={chaveProduto(product)} className="portal-pdv-product" onClick={() => addProduct(product)}>
                          <span><strong>{nomeProduto(product)}</strong>{product.descricao && <small>{product.descricao}</small>}</span>
                          <b>+ R$ {(product.precoEfetivo ?? 0).toFixed(2).replace('.', ',')}</b>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {cardapio.isLoading && <p className="text-sm text-ink-muted">Carregando cardápio...</p>}
                {!cardapio.isLoading && !produtosCardapio.length && <p className="text-sm text-ink-muted">Nenhum item disponível neste caixa.</p>}
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
                  <article key={pedido.id}><strong>Pedido #{pedido.numero}</strong><span>{pedido.status}</span>{itensValidos(pedido.itens).map((item, index) => <p key={`${item.nome}-${index}`}>{item.quantidade}x {item.nome}<small>R$ {item.subtotal.toFixed(2).replace('.', ',')}</small></p>)}</article>
                )) : <p>Nenhum pedido enviado ainda.</p>}
                <p className="portal-pdv-no-close">O fechamento e o pagamento são feitos pela equipe do caixa.</p>
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
            {abrir.error && (
              <div className="alert-error">
                {abrir.error instanceof ApiError
                  ? abrir.error.message
                  : 'Não foi possível abrir a comanda'}
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
                onChange={(e) => setNome(e.target.value)}
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
    </main>
  );
}
