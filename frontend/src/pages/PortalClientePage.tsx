import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, assetUrl, formatCurrency } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type {
  PortalTrailerInfo,
  PortalCardapio,
  PortalComanda,
  PortalSessaoResponse,
  PortalClienteLookupResponse,
} from '../types';
import { Loading } from '../components/Loading';
import { connectClientePortalSocket } from '../lib/socket';
import { applyAppTheme, getAppTheme, setAppTheme, type AppTheme } from '../lib/app-theme';

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
  const [tab, setTab] = useState<Tab>('comanda');
  const [theme, setThemeState] = useState<AppTheme>(() => getAppTheme());
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

  const clearPortalSession = useCallback(async () => {
    try {
      await api.post('/api/public/cliente/logout', {});
    } catch {
      /* cookie pode já estar inválido */
    }
    setAuthenticated(false);
    setCart([]);
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

  const setTheme = useCallback((next: AppTheme) => {
    setAppTheme(next);
    applyAppTheme(next);
    setThemeState(next);
  }, []);

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
    if (cardapio.chopes.length > 0) setMenuTab('chope');
    else if (cardapio.bebidas.length > 0) setMenuTab('bebidas');
    else setMenuTab('comidas');
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

    socket.on('pedido:confirmed', refreshComanda);
    socket.on('pedido:recusado', refreshComanda);
    socket.on('pedido:cancelado', refreshComanda);
    socket.on('item:added', refreshComanda);
    socket.on('portal:session-expired', onSessionExpired);

    return () => {
      socket.off('pedido:confirmed', refreshComanda);
      socket.off('pedido:recusado', refreshComanda);
      socket.off('pedido:cancelado', refreshComanda);
      socket.off('item:added', refreshComanda);
      socket.off('portal:session-expired', onSessionExpired);
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
        setNome('');
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

  const logo = assetUrl(info.cervejaria.logoUrl);

  if (!info.disponivel || !info.evento) {
    return (
      <div className="min-h-screen bg-canvas px-4 py-8 safe-area-pt">
        <div className="max-w-md mx-auto text-center space-y-4">
          {logo && <img src={logo} alt="" className="h-14 mx-auto rounded-xl" />}
          <h1 className="text-xl font-bold">{info.cervejaria.nome}</h1>
          <p className="text-sm text-ink-muted">{info.trailer.nome}</p>
          <div className="card">
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
      <div className="min-h-screen bg-canvas px-4 py-8 safe-area-pt safe-area-pb">
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2">
            {logo ? (
              <img src={logo} alt="" className="h-14 mx-auto rounded-xl object-contain" />
            ) : (
              <div className="text-3xl">🍺</div>
            )}
            <h1 className="text-xl font-bold">{info.cervejaria.nome}</h1>
            <p className="text-sm text-ink-muted">
              {info.trailer.nome} · {info.evento.nome}
            </p>
          </div>

          {loginStep === 'telefone' && (
            <form onSubmit={handleContinuePhone} className="card space-y-4">
              <h2 className="font-bold">Abrir comanda</h2>
              <p className="text-sm text-ink-muted">
                Informe seu telefone. Se já estiver cadastrado, confirmamos seu nome na sequência.
              </p>
              {error && <div className="alert-error">{error}</div>}
              <div>
                <label className="label">Telefone</label>
                <input
                  ref={phoneInputRef}
                  className="input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  required
                />
              </div>
              <button
                type="submit"
                className="touch-btn-primary w-full"
                disabled={lookupMutation.isPending}
              >
                {lookupMutation.isPending ? 'Verificando...' : 'Continuar'}
              </button>
            </form>
          )}

          {loginStep === 'confirmar' && (
            <div className="card space-y-4">
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
                className="touch-btn-danger w-full"
                disabled={sessaoMutation.isPending}
                onClick={handleConfirmNo}
              >
                Não sou eu
              </button>
              <button type="button" className="touch-btn-warning w-full" onClick={resetLoginFlow}>
                Usar outro telefone
              </button>
            </div>
          )}

          {loginStep === 'cadastro' && (
            <form onSubmit={handleRegister} className="card space-y-4">
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
              <button type="button" className="touch-btn-warning w-full" onClick={resetLoginFlow}>
                Usar outro telefone
              </button>
            </form>
          )}

          {loginStep === 'bloqueado' && (
            <div className="card space-y-4">
              <h2 className="font-bold">Cadastro não confere</h2>
              <p className="text-sm text-ink-muted">
                O telefone <span className="font-semibold text-ink">{formatPhone(telefone)}</span> está vinculado a
                outra pessoa em nosso cadastro.
              </p>
              <div className="notice-warn">
                Procure um atendente no balcão para regularizar seu cadastro antes de usar o portal.
              </div>
              <button type="button" className="touch-btn-warning w-full" onClick={resetLoginFlow}>
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

  return (
    <div className="min-h-screen bg-canvas pb-24 safe-area-pt">
      <header className="app-shell-header px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {logo && <img src={logo} alt="" className="h-9 w-9 rounded-lg object-contain" />}
          <div className="min-w-0">
            <p className="font-bold truncate">{info.cervejaria.nome}</p>
            <p className="text-xs text-ink-muted truncate">{info.evento.nome}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-ink-muted">Saldo</p>
            <p className="font-bold text-brand-600">{formatCurrency(comanda?.total ?? 0)}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && <div className="alert-error">{error}</div>}

        {tab === 'comanda' && (
          <section className="space-y-4">
            <div>
              <h2 className="font-bold text-lg">Sua comanda</h2>
              <p className="text-sm text-ink-muted mt-1">
                Itens confirmados entram no saldo. Pedidos enviados aguardam o atendente.
              </p>
            </div>

            {comandaVazia && (
              <p className="text-sm text-ink-muted">Nenhum item na comanda ainda.</p>
            )}

            {!!comanda?.itens.length && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Na comanda
                </p>
                {comanda.itens.map((item) => (
                  <div key={item.id} className="card flex justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.produto}</p>
                      <p className="text-xs text-ink-muted">
                        {item.quantidade}x {formatVolume(item.volumeMl)}
                      </p>
                    </div>
                    <p className="font-semibold">{formatCurrency(item.subtotal)}</p>
                  </div>
                ))}
              </div>
            )}

            {pedidosPendentes.length > 0 && (
              <div className="space-y-2">
                <p className="notice-warn-label">
                  Aguardando confirmação
                </p>
                {pedidosPendentes.map((pedido) => (
                  <article
                    key={pedido.id}
                    className="card-notice-warn space-y-2"
                  >
                    <div className="flex justify-between gap-2">
                      <p className="font-semibold text-warn">
                        {PEDIDO_STATUS_LABEL[pedido.status]}
                      </p>
                      <p className="text-sm font-medium">{formatCurrency(pedido.totalEstimado)}</p>
                    </div>
                    <ul className="text-sm text-ink-muted space-y-0.5">
                      {pedido.itens.map((i) => (
                        <li key={i.id}>
                          {i.quantidade}x {i.produto.nome}{' '}
                          {i.volumeMl > 1 ? `(${formatVolume(i.volumeMl)})` : ''}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="touch-btn-danger touch-btn-sm w-full"
                      disabled={cancelarPedidoMutation.isPending}
                      onClick={() => {
                        setError('');
                        setCancelandoPedidoId(pedido.id);
                        cancelarPedidoMutation.mutate(pedido.id);
                      }}
                    >
                      {cancelandoPedidoId === pedido.id && cancelarPedidoMutation.isPending
                        ? 'Cancelando...'
                        : 'Cancelar pedido'}
                    </button>
                  </article>
                ))}
              </div>
            )}

            {pedidosRecusados.length > 0 && (
              <div className="space-y-2">
                <p className="notice-danger-label">
                  Recusados
                </p>
                {pedidosRecusados.map((pedido) => (
                  <article key={pedido.id} className="card-notice-danger">
                    <div className="flex justify-between gap-2">
                      <p className="notice-danger-title">
                        {PEDIDO_STATUS_LABEL[pedido.status]}
                      </p>
                      <p className="text-sm font-medium">{formatCurrency(pedido.totalEstimado)}</p>
                    </div>
                    <ul className="text-sm text-ink-muted space-y-0.5">
                      {pedido.itens.map((i) => (
                        <li key={i.id}>
                          {i.quantidade}x {i.produto.nome}{' '}
                          {i.volumeMl > 1 ? `(${formatVolume(i.volumeMl)})` : ''}
                        </li>
                      ))}
                    </ul>
                    {pedido.recusadoMotivo && (
                      <p className="text-xs text-danger">Motivo: {pedido.recusadoMotivo}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'pedir' && cardapio && (
          <section className="space-y-4">
            <p className="text-sm text-ink-muted">
              Monte seu pedido. O atendente confirma antes de lançar na comanda.
            </p>
            <div className="segmented-control">
              {cardapio.chopes.length > 0 && (
                <button
                  type="button"
                  className={`segmented-control-btn ${menuTab === 'chope' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
                  onClick={() => setMenuTab('chope')}
                >
                  Chopes
                </button>
              )}
              {cardapio.bebidas.length > 0 && (
                <button
                  type="button"
                  className={`segmented-control-btn ${menuTab === 'bebidas' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
                  onClick={() => setMenuTab('bebidas')}
                >
                  Bebidas
                </button>
              )}
              {cardapio.comidas.length > 0 && (
                <button
                  type="button"
                  className={`segmented-control-btn ${menuTab === 'comidas' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
                  onClick={() => setMenuTab('comidas')}
                >
                  Comidas
                </button>
              )}
            </div>

            {menuTab === 'chope' &&
              cardapio.chopes.map((chope) => (
                <div key={chope.tapId} className="card space-y-2">
                  <p className="font-bold">
                    Tap {chope.tapNumero} — {chope.produto.nome}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {chope.produto.precos.map((p) => (
                      <button
                        key={p.volumeMl}
                        type="button"
                        className="touch-btn-secondary touch-btn-sm"
                        onClick={() =>
                          addToCart({
                            produtoId: chope.produto.id,
                            produtoNome: chope.produto.nome,
                            volumeMl: p.volumeMl,
                            quantidade: 1,
                            precoUnit: p.preco,
                            tapId: chope.tapId,
                          })
                        }
                      >
                        {formatVolume(p.volumeMl) || 'Un'} — {formatCurrency(p.preco)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

            {(menuTab === 'bebidas' ? cardapio.bebidas : menuTab === 'comidas' ? cardapio.comidas : []).map(
              (produto) => (
                <div key={produto.id} className="card flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{produto.nome}</p>
                    <p className="text-sm text-brand-600">
                      {formatCurrency(produto.precos[0]?.preco ?? 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="touch-btn-primary touch-btn-sm"
                    onClick={() =>
                      addToCart({
                        produtoId: produto.id,
                        produtoNome: produto.nome,
                        volumeMl: produto.precos[0]?.volumeMl ?? 1,
                        quantidade: 1,
                        precoUnit: produto.precos[0]?.preco ?? 0,
                      })
                    }
                  >
                    Adicionar
                  </button>
                </div>
              ),
            )}

            {cart.length > 0 &&
              createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                  <button
                    type="button"
                    className="overlay-backdrop"
                    aria-label="Fechar carrinho"
                    onClick={() => setCart([])}
                  />
                  <div
                    role="dialog"
                    aria-modal
                    aria-labelledby="portal-cart-title"
                    className="relative card shadow-xl w-full max-w-sm space-y-3 p-4"
                  >
                    <p id="portal-cart-title" className="font-bold">
                      Carrinho ({cart.length})
                    </p>
                    {cart.map((item) => (
                      <div key={item.key} className="flex justify-between text-sm">
                        <span>
                          {item.quantidade}x {item.produtoNome} {formatVolume(item.volumeMl)}
                        </span>
                        <span>{formatCurrency(item.precoUnit * item.quantidade)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold pt-1 border-t border-line">
                      <span>Total estimado</span>
                      <span>{formatCurrency(cartTotal)}</span>
                    </div>
                    <button
                      type="button"
                      className="touch-btn-primary w-full"
                      disabled={pedidoMutation.isPending}
                      onClick={() => {
                        setError('');
                        pedidoMutation.mutate(cart);
                      }}
                    >
                      {pedidoMutation.isPending ? 'Enviando...' : 'Enviar pedido ao atendente'}
                    </button>
                    <button
                      type="button"
                      className="touch-btn-danger w-full"
                      disabled={pedidoMutation.isPending}
                      onClick={() => setCart([])}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>,
                document.body,
              )}
          </section>
        )}

      </main>

      <nav className="app-bottom-nav safe-area-pb">
        <div className="max-w-lg mx-auto flex items-stretch">
          {(
            [
              ['comanda', `Comanda${pedidosPendentes.length ? ` (${pedidosPendentes.length})` : ''}`],
              ['pedir', 'Pedir'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`flex-1 py-3 text-sm font-semibold ${tab === id ? 'text-brand-600' : 'text-ink-faint'}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="shrink-0 px-4 py-3 text-ink-muted flex items-center justify-center"
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
