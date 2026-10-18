import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, assetUrl, formatCurrency, logoAssetUrl } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type {
  PortalTrailerInfo,
  PortalCardapio,
  PortalComanda,
  PortalSessaoResponse,
  PortalClienteLookupResponse,
} from '../types';
import { Loading } from '../components/Loading';
import { PortalBackground } from '../components/PortalBackground';
import { connectClientePortalSocket } from '../lib/socket';
import { CATEGORIAS_PRODUTO_OPERACAO, normalizeCategoriaProduto } from '../lib/operacao';

type Tab = 'comanda' | 'pedir';

type LoginStep = 'telefone' | 'confirmar' | 'cadastro' | 'bloqueado';

type CartItem = {
  key: string;
  produtoId: string;
  produtoNome: string;
  volumeMl: number;
  quantidade: number;
  precoUnit: number;
  tapId?: string;
};

function ReceiptIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-icon portal-login-icon--receipt">
      <path d="M9 4h14v23l-3.5-2.5L16 27l-3.5-2.5L9 27V4Z" />
      <path d="M12.5 10h7M12.5 14h7M12.5 18h5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-field-icon">
      <circle cx="16" cy="10" r="5" />
      <path d="M7 27c.8-5.2 3.7-8 9-8s8.2 2.8 9 8" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="portal-login-field-icon">
      <path d="M9 5.5 13 4l3 7-3 2c1.3 3 3 4.7 6 6l2-3 7 3-1.5 4c-.5 1.4-2 2.2-3.4 1.8C14 22.6 8.4 17 6.2 7.9 5.8 6.5 7.6 6 9 5.5Z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden="true" className="portal-login-arrow">›</span>;
}

const PEDIDO_STATUS_LABEL: Record<string, string> = {
  PENDENTE: 'Aguardando confirmação do atendente',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

function formatVolume(ml: number) {
  if (ml <= 1) return '';
  return ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`;
}

export function PortalClientePage() {
  const { slug, trailerId } = useParams<{ slug: string; trailerId: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('pedir');
  const [loginStep, setLoginStep] = useState<LoginStep>('telefone');
  const [nome, setNome] = useState('');
  const [lookupNome, setLookupNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [menuTab, setMenuTab] = useState<'chope' | 'bebidas' | 'comidas'>('chope');
  const [cancelandoPedidoId, setCancelandoPedidoId] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const nomeInputRef = useRef<HTMLInputElement>(null);

  const clearPortalSession = useCallback(async (message = '') => {
    try {
      await api.post('/api/public/cliente/logout', {});
    } catch {
      /* cookie pode já estar inválido */
    }
    setAuthenticated(false);
    setCart([]);
    setTab('pedir');
    setLoginStep('telefone');
    setNome('');
    setLookupNome('');
    setTelefone('');
    setError(message);
    queryClient.removeQueries({ queryKey: ['portal-comanda'] });
    queryClient.removeQueries({ queryKey: ['portal-cardapio'] });
  }, [queryClient]);

  const handlePortalAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        void clearPortalSession();
        return true;
      }
      return false;
    },
    [clearPortalSession],
  );

  const { data: info, isLoading, isError } = useQuery({
    queryKey: ['portal-info', slug, trailerId],
    queryFn: () =>
      api.get<PortalTrailerInfo>(`/api/public/cervejarias/${slug}/trailers/${trailerId}/info`),
    enabled: !!slug && !!trailerId,
    retry: false,
  });

  const comandaQuery = useQuery({
    queryKey: ['portal-comanda'],
    queryFn: () => api.get<PortalComanda>('/api/public/cliente/comanda'),
    enabled: authenticated,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const pedidos = query.state.data?.pedidos ?? [];
      return pedidos.some((p) => p.status === 'PENDENTE') ? 3000 : false;
    },
  });

  const { data: cardapio } = useQuery({
    queryKey: ['portal-cardapio'],
    queryFn: () => api.get<PortalCardapio>('/api/public/cliente/cardapio'),
    enabled: authenticated,
  });

  useEffect(() => {
    document.body.classList.add('auth-screen');
    return () => document.body.classList.remove('auth-screen');
  }, []);

  useEffect(() => {
    if (authenticated || loginStep !== 'telefone') return;
    phoneInputRef.current?.focus();
  }, [authenticated, loginStep]);

  useEffect(() => {
    if (loginStep === 'cadastro') {
      nomeInputRef.current?.focus();
    }
  }, [loginStep]);

  useEffect(() => {
    if (info && !info.disponivel) {
      void clearPortalSession();
    }
  }, [info, clearPortalSession]);

  useEffect(() => {
    if (comandaQuery.error) {
      handlePortalAuthError(comandaQuery.error);
    }
  }, [comandaQuery.error, handlePortalAuthError]);

  useEffect(() => {
    if (!cardapio) return;
    if (cardapio.comidas.length > 0) setMenuTab('comidas');
    else if (cardapio.bebidas.length > 0) setMenuTab('bebidas');
    else setMenuTab('chope');
  }, [cardapio]);

  useEffect(() => {
    if (!authenticated) return;

    const socket = connectClientePortalSocket();
    const refreshComanda = () => {
      queryClient.invalidateQueries({ queryKey: ['portal-comanda'] });
    };
    const onSessionExpired = () => {
      void clearPortalSession();
    };
    const onComandaClosed = () => {
      void clearPortalSession('Sua comanda foi fechada. Informe seus dados para abrir uma nova.');
    };

    socket.on('pedido:confirmed', refreshComanda);
    socket.on('pedido:recusado', refreshComanda);
    socket.on('pedido:cancelado', refreshComanda);
    socket.on('item:added', refreshComanda);
    socket.on('portal:session-expired', onSessionExpired);
    socket.on('comanda:closed', onComandaClosed);

    return () => {
      socket.off('pedido:confirmed', refreshComanda);
      socket.off('pedido:recusado', refreshComanda);
      socket.off('pedido:cancelado', refreshComanda);
      socket.off('item:added', refreshComanda);
      socket.off('portal:session-expired', onSessionExpired);
      socket.off('comanda:closed', onComandaClosed);
    };
  }, [authenticated, queryClient, clearPortalSession]);

  const lookupMutation = useMutation({
    mutationFn: (digits: string) =>
      api.get<PortalClienteLookupResponse>(
        `/api/public/cervejarias/${slug}/trailers/${trailerId}/cliente-por-telefone?telefone=${encodeURIComponent(digits)}`,
      ),
    onSuccess: (data) => {
      setError('');
      if (data.encontrado && data.nome) {
        setLookupNome(data.nome);
        setLoginStep('confirmar');
      } else {
        setLookupNome('');
        setLoginStep('cadastro');
      }
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível verificar o telefone');
    },
  });

  const sessaoMutation = useMutation({
    mutationFn: (body: { nome: string; telefone: string }) =>
      api.post<PortalSessaoResponse>(
        `/api/public/cervejarias/${slug}/trailers/${trailerId}/sessao`,
        body,
      ),
    onSuccess: (data) => {
      setAuthenticated(true);
      setNome(data.cliente.nome);
      setLookupNome(data.cliente.nome);
      setError('');
      queryClient.setQueryData(['portal-comanda'], data.comanda);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar');
    },
  });

  const pedidoMutation = useMutation({
    mutationFn: (itens: CartItem[]) =>
      api.post('/api/public/cliente/pedidos', {
        itens: itens.map((i) => ({
          produtoId: i.produtoId,
          volumeMl: i.volumeMl,
          quantidade: i.quantidade,
          tapId: i.tapId,
        })),
      }),
    onSuccess: () => {
      setCart([]);
      setTab('comanda');
      queryClient.invalidateQueries({ queryKey: ['portal-comanda'] });
    },
    onError: (err) => {
      if (handlePortalAuthError(err)) return;
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar pedido');
    },
  });

  const cancelarPedidoMutation = useMutation({
    mutationFn: (pedidoId: string) =>
      api.post(`/api/public/cliente/pedidos/${pedidoId}/cancelar`, {}),
    onSuccess: () => {
      setCancelandoPedidoId(null);
      queryClient.invalidateQueries({ queryKey: ['portal-comanda'] });
    },
    onError: (err) => {
      setCancelandoPedidoId(null);
      if (handlePortalAuthError(err)) return;
      setError(err instanceof ApiError ? err.message : 'Erro ao cancelar pedido');
    },
  });

  const cartTotal = useMemo(
    () => cart.reduce((s, i) => s + i.precoUnit * i.quantidade, 0),
    [cart],
  );

  const produtosPorCategoria = useMemo(() => {
    const produtosDaAba = menuTab === 'bebidas' ? cardapio?.bebidas ?? [] : menuTab === 'comidas' ? cardapio?.comidas ?? [] : [];
    const grupos = new Map<string, typeof produtosDaAba>();
    for (const produto of produtosDaAba) {
      const categoria = normalizeCategoriaProduto(produto.categoria);
      grupos.set(categoria, [...(grupos.get(categoria) ?? []), produto]);
    }
    return [...grupos.entries()].sort(
      ([a], [b]) => CATEGORIAS_PRODUTO_OPERACAO.indexOf(a as (typeof CATEGORIAS_PRODUTO_OPERACAO)[number])
        - CATEGORIAS_PRODUTO_OPERACAO.indexOf(b as (typeof CATEGORIAS_PRODUTO_OPERACAO)[number]),
    );
  }, [cardapio, menuTab]);

  const phoneDigits = telefone.replace(/\D/g, '');

  const resetLoginFlow = () => {
    setLoginStep('telefone');
    setLookupNome('');
    setNome('');
    setError('');
  };

  const handleContinuePhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneDigits.length < 10) {
      setError('Informe um telefone válido com DDD');
      return;
    }
    if (!nome.trim()) {
      setError('Informe seu nome');
      return;
    }
    lookupMutation.mutate(phoneDigits);
  };

  const handleConfirmYes = () => {
    if (!lookupNome.trim()) return;
    sessaoMutation.mutate({ nome: lookupNome.trim(), telefone: phoneDigits });
  };

  const handleConfirmNo = () => {
    setError('');
    setLoginStep('bloqueado');
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setError('Informe seu nome');
      return;
    }
    sessaoMutation.mutate({ nome: nome.trim(), telefone: phoneDigits });
  };

  const addToCart = (item: Omit<CartItem, 'key'>) => {
    const key = `${item.produtoId}-${item.volumeMl}-${item.tapId ?? 'unit'}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key);
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, quantidade: c.quantidade + 1 } : c));
      }
      return [...prev, { ...item, key }];
    });
  };

  const changeCartQuantity = (key: string, delta: number) => {
    setCart((current) => current
      .map((item) => item.key === key ? { ...item, quantidade: item.quantidade + delta } : item)
      .filter((item) => item.quantidade > 0));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <Loading />
      </div>
    );
  }

  if (isError || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="card max-w-md w-full text-center space-y-3">
          <h1 className="text-xl font-bold">Link inválido</h1>
          <p className="text-sm text-ink-muted">Este QR Code não está disponível.</p>
        </div>
      </div>
    );
  }

  const logo = logoAssetUrl(info.cervejaria);
  const portalBackground = assetUrl(info.cervejaria.portalBackgroundUrl);

  if (!info.disponivel || !info.evento) {
    return (
      <div className="portal-background-host min-h-screen bg-canvas px-4 py-8 safe-area-pt">
        <PortalBackground src={portalBackground} />
        <div className="portal-login-content">
          {logo && <img src={logo} alt="" className="portal-login-logo" />}
          <h1 className="text-xl font-bold">{info.cervejaria.nome}</h1>
          <p className="text-sm text-ink-muted">{info.trailer.nome}</p>
          <div className="portal-login-card">
            <p className="font-semibold">Evento indisponível</p>
            <p className="text-sm text-ink-muted mt-2">
              Não há evento aberto neste trailer no momento. Tente novamente mais tarde.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="portal-background-host min-h-screen bg-canvas px-4 py-8 safe-area-pt safe-area-pb">
        <PortalBackground src={portalBackground} />
        <div className="portal-login-content">
          <div className="portal-login-brand">
            {logo ? (
              <img src={logo} alt={info.cervejaria.nome} className="portal-login-logo" />
            ) : (
              <div className="portal-login-logo-fallback" aria-hidden="true">🍺</div>
            )}
          </div>

          {loginStep === 'telefone' && (
            <form onSubmit={handleContinuePhone} className="portal-login-card">
              <div className="portal-login-heading">
                <ReceiptIcon />
                <div>
                  <h1>Abrir comanda</h1>
                  <p>Informe seus dados para abrir sua comanda neste evento.</p>
                </div>
              </div>
              {error && <div className="alert-error">{error}</div>}
              <div className="portal-login-field">
                <label htmlFor="portal-telefone"><PhoneIcon />Telefone</label>
                <input
                  id="portal-telefone"
                  ref={phoneInputRef}
                  className="portal-login-input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhone(e.target.value))}
                  placeholder="(XX) XXXXX-XXXX"
                  required
                />
              </div>
              <div className="portal-login-field">
                <label htmlFor="portal-nome"><UserIcon />Nome</label>
                <input
                  id="portal-nome"
                  ref={nomeInputRef}
                  className="portal-login-input"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Digite seu nome"
                  required
                  autoComplete="name"
                />
              </div>
              <button
                type="submit"
                className="portal-login-submit"
                disabled={lookupMutation.isPending}
              >
                {lookupMutation.isPending ? 'Verificando...' : 'Abrir comanda'}
                {!lookupMutation.isPending && <ArrowRightIcon />}
              </button>
            </form>
          )}

          {loginStep === 'confirmar' && (
            <div className="portal-login-card space-y-4">
              <h2 className="font-bold">Confirmar identidade</h2>
              <p className="text-sm text-ink-muted">
                Telefone <span className="font-semibold text-ink">{formatPhone(telefone)}</span>
              </p>
              {error && <div className="alert-error">{error}</div>}
              <p className="text-base">
                Olá, <span className="font-bold">{lookupNome}</span>! É você?
              </p>
              <button
                type="button"
                className="touch-btn-primary w-full"
                disabled={sessaoMutation.isPending}
                onClick={handleConfirmYes}
              >
                {sessaoMutation.isPending ? 'Abrindo...' : 'Sim, sou eu'}
              </button>
              <button
                type="button"
                className="touch-btn-secondary w-full"
                disabled={sessaoMutation.isPending}
                onClick={handleConfirmNo}
              >
                Não sou eu
              </button>
              <button type="button" className="touch-btn-secondary w-full" onClick={resetLoginFlow}>
                Usar outro telefone
              </button>
            </div>
          )}

          {loginStep === 'cadastro' && (
            <form onSubmit={handleRegister} className="portal-login-card space-y-4">
              <h2 className="font-bold">Cadastro</h2>
              <p className="text-sm text-ink-muted">
                Telefone <span className="font-semibold text-ink">{formatPhone(telefone)}</span> ainda não está
                cadastrado. Informe seu nome para abrir a comanda.
              </p>
              {error && <div className="alert-error">{error}</div>}
              <div>
                <label className="label">Nome</label>
                <input
                  ref={nomeInputRef}
                  className="input"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Seu nome"
                  required
                  autoComplete="name"
                />
              </div>
              <button type="submit" className="touch-btn-primary w-full" disabled={sessaoMutation.isPending}>
                {sessaoMutation.isPending ? 'Abrindo...' : 'Abrir comanda'}
              </button>
              <button type="button" className="touch-btn-secondary w-full" onClick={resetLoginFlow}>
                Usar outro telefone
              </button>
            </form>
          )}

          {loginStep === 'bloqueado' && (
            <div className="portal-login-card space-y-4">
              <h2 className="font-bold">Cadastro não confere</h2>
              <p className="text-sm text-ink-muted">
                O telefone <span className="font-semibold text-ink">{formatPhone(telefone)}</span> está vinculado a
                outra pessoa em nosso cadastro.
              </p>
              <div className="notice-warn">
                Procure um atendente no balcão para regularizar seu cadastro antes de usar o portal.
              </div>
              <button type="button" className="touch-btn-secondary w-full" onClick={resetLoginFlow}>
                Usar outro telefone
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const comanda = comandaQuery.data;
  const pedidosPendentes = comanda?.pedidos.filter((p) => p.status === 'PENDENTE') ?? [];
  const pedidosRecusados = comanda?.pedidos.filter((p) => p.status === 'RECUSADO') ?? [];
  const comandaVazia =
    !comanda?.itens.length && pedidosPendentes.length === 0 && pedidosRecusados.length === 0;

  const quantidadeNoCarrinho = cart.reduce((total, item) => total + item.quantidade, 0);
  return (
    <main className="portal-background-host min-h-screen bg-canvas px-4 py-8 safe-area-pt">
      <PortalBackground src={portalBackground} />
      <div className="portal-login-content">
        <div className="portal-login-brand">
          {logo ? <img src={logo} alt={info.cervejaria.nome} className="portal-login-logo" /> : <div className="portal-login-logo-fallback" aria-hidden="true">🍺</div>}
        </div>
        {error && <div className="alert-error w-full" role="alert">{error}</div>}
        <section className={`portal-pdv-workspace ${tab === 'pedir' ? 'portal-pdv-workspace--orders' : ''}`}>
          <div className="portal-pdv-account">
            <div className="min-w-0"><h2 className="truncate">{lookupNome || nome}</h2><p>{formatPhone(telefone)}</p></div>
            <strong>{formatCurrency(comanda?.total ?? 0)}</strong>
            <button type="button" className="portal-pdv-summary-link" onClick={() => setTab(tab === 'comanda' ? 'pedir' : 'comanda')}>{tab === 'comanda' ? 'Pedir' : 'Resumo'}</button>
          </div>
          <p className="portal-pdv-status">Evento: {info.evento.nome}. Os pedidos aguardam confirmação do atendente.</p>
          {tab === 'pedir' ? (
            <div className="portal-pdv-orders">
              <h3>Escolha seus itens</h3>
              <nav className="portal-pdv-category-tabs" aria-label="Tipo de produto">
                {cardapio?.chopes.length ? <button type="button" className={menuTab === 'chope' ? 'active' : ''} aria-pressed={menuTab === 'chope'} onClick={() => setMenuTab('chope')}>Chopes</button> : null}
                {cardapio?.comidas.length ? <button type="button" className={menuTab === 'comidas' ? 'active' : ''} aria-pressed={menuTab === 'comidas'} onClick={() => setMenuTab('comidas')}>Comidas</button> : null}
                {cardapio?.bebidas.length ? <button type="button" className={menuTab === 'bebidas' ? 'active' : ''} aria-pressed={menuTab === 'bebidas'} onClick={() => setMenuTab('bebidas')}>Bebidas</button> : null}
              </nav>
              {menuTab === 'chope' && cardapio?.chopes.map((chope) => (
                <section className="portal-pdv-category" key={chope.tapId}>
                  <h4>Tap {chope.tapNumero}{chope.tapNome ? ` · ${chope.tapNome}` : ''}</h4>
                  <div className="portal-pdv-product-grid"><article className="portal-pdv-product">
                    <strong>{chope.produto.nome}</strong>
                    <div className="portal-event-price-options">{chope.produto.precos.map((preco) => {
                      const key = `${chope.produto.id}-${preco.volumeMl}-${chope.tapId}`;
                      const quantidade = cart.find((item) => item.key === key)?.quantidade ?? 0;
                      return <button type="button" key={preco.volumeMl} onClick={() => addToCart({ produtoId: chope.produto.id, produtoNome: chope.produto.nome, volumeMl: preco.volumeMl, quantidade: 1, precoUnit: preco.preco, tapId: chope.tapId })}>{formatVolume(preco.volumeMl) || 'Un'} · {formatCurrency(preco.preco)}{quantidade > 0 ? ` · ${quantidade} no pedido` : ''}</button>;
                    })}</div>
                  </article></div>
                </section>
              ))}
              {produtosPorCategoria.map(([categoria, produtos]) => (
                <section className="portal-pdv-category" key={categoria}><h4>{categoria}</h4><div className="portal-pdv-product-grid">
                  {produtos.map((produto) => <article className="portal-pdv-product" key={produto.id}>
                    <strong>{produto.nome}</strong>
                    <div className="portal-event-price-options">{produto.precos.map((preco) => {
                      const key = `${produto.id}-${preco.volumeMl}-unit`;
                      const quantidade = cart.find((item) => item.key === key)?.quantidade ?? 0;
                      return <button type="button" key={preco.volumeMl} onClick={() => addToCart({ produtoId: produto.id, produtoNome: produto.nome, volumeMl: preco.volumeMl, quantidade: 1, precoUnit: preco.preco })}>{formatVolume(preco.volumeMl) || 'Un'} · {formatCurrency(preco.preco)}{quantidade > 0 ? ` · ${quantidade} no pedido` : ''}</button>;
                    })}</div>
                  </article>)}
                </div></section>
              ))}
              {!cardapio && <p className="text-sm text-ink-muted">Carregando cardápio...</p>}
              {cardapio && !cardapio.chopes.length && !cardapio.comidas.length && !cardapio.bebidas.length && <p className="text-sm text-ink-muted">Nenhum item disponível neste evento.</p>}
            </div>
          ) : (
            <div className="portal-pdv-summary">
              <h3>Sua comanda</h3>
              <div className="portal-pdv-account-totals"><div><span>Saldo</span><strong>{formatCurrency(comanda?.total ?? 0)}</strong></div><div><span>Pedidos aguardando</span><strong>{pedidosPendentes.length}</strong></div></div>
              {comandaVazia && <p>Nenhum item na comanda ainda.</p>}
              {!!comanda?.itens.length && <section className="portal-pdv-category"><h4>Itens confirmados</h4>{comanda.itens.map((item) => <article key={item.id}><strong>{item.produto}</strong><span>{formatCurrency(item.subtotal)}</span><p>{item.quantidade}x {formatVolume(item.volumeMl) || 'Un'}</p></article>)}</section>}
              {pedidosPendentes.map((pedido) => <article className="card-notice-warn space-y-2" key={pedido.id}>
                <div className="flex justify-between gap-2"><strong>{PEDIDO_STATUS_LABEL[pedido.status]}</strong><strong>{formatCurrency(pedido.totalEstimado)}</strong></div>
                <ul className="text-sm text-ink-muted space-y-0.5">{pedido.itens.map((item) => <li key={item.id}>{item.quantidade}x {item.produto.nome} {item.volumeMl > 1 ? `(${formatVolume(item.volumeMl)})` : ''}</li>)}</ul>
                <button type="button" className="touch-btn-danger touch-btn-sm w-full" disabled={cancelarPedidoMutation.isPending} onClick={() => { setError(''); setCancelandoPedidoId(pedido.id); cancelarPedidoMutation.mutate(pedido.id); }}>{cancelandoPedidoId === pedido.id && cancelarPedidoMutation.isPending ? 'Cancelando...' : 'Cancelar pedido'}</button>
              </article>)}
              {pedidosRecusados.map((pedido) => <article className="card-notice-danger space-y-2" key={pedido.id}>
                <div className="flex justify-between gap-2"><strong>{PEDIDO_STATUS_LABEL[pedido.status]}</strong><strong>{formatCurrency(pedido.totalEstimado)}</strong></div>
                <ul className="text-sm text-ink-muted space-y-0.5">{pedido.itens.map((item) => <li key={item.id}>{item.quantidade}x {item.produto.nome} {item.volumeMl > 1 ? `(${formatVolume(item.volumeMl)})` : ''}</li>)}</ul>
                {pedido.recusadoMotivo && <p className="text-xs text-danger">Motivo: {pedido.recusadoMotivo}</p>}
              </article>)}
              <p className="portal-pdv-no-close">O fechamento e o pagamento são feitos pela equipe do evento.</p>
            </div>
          )}
          {tab === 'pedir' && <footer className="portal-pdv-order-footer">
            {cart.length > 0 && <div className="portal-pdv-footer-cart" aria-label="Itens selecionados">{cart.map((item) => <div className="portal-pdv-footer-cart-item" key={item.key}>
              <span>{item.produtoNome} {formatVolume(item.volumeMl)}{item.tapId ? ` · Tap ${cardapio?.chopes.find((chope) => chope.tapId === item.tapId)?.tapNumero ?? ''}` : ''}</span>
              <div className="portal-pdv-quantity" aria-label={`Quantidade de ${item.produtoNome}`}><button type="button" aria-label={`Diminuir ${item.produtoNome}`} onClick={() => changeCartQuantity(item.key, -1)}>−</button><strong>{item.quantidade}</strong><button type="button" aria-label={`Aumentar ${item.produtoNome}`} onClick={() => changeCartQuantity(item.key, 1)}>+</button></div>
            </div>)}</div>}
            <p>{quantidadeNoCarrinho} item{quantidadeNoCarrinho === 1 ? '' : 's'} selecionado{quantidadeNoCarrinho === 1 ? '' : 's'}{cart.length > 0 && <strong>{formatCurrency(cartTotal)}</strong>}</p>
            <button type="button" className="portal-pdv-submit" disabled={!cart.length || pedidoMutation.isPending} onClick={() => { setError(''); pedidoMutation.mutate(cart); }}>{pedidoMutation.isPending ? 'Enviando...' : 'Enviar pedido ao atendente'}</button>
            <button type="button" className="portal-pdv-back" onClick={() => setTab('comanda')}>Ver comanda</button>
          </footer>}
        </section>
      </div>
    </main>
  );
}
