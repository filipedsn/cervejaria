import { createBrowserRouter, RouterProvider, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, restoreAppThemeFromStorage } from './contexts/ThemeContext';
import { EventoProvider, useEvento } from './contexts/EventoContext';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AdminCervejariasPage } from './pages/AdminCervejariasPage';
import { OperacaoLayout } from './pages/operacao/OperacaoLayout';
import { OperacaoComandasPage } from './pages/operacao/OperacaoComandasPage';
import { OperacaoCaixaPage } from './pages/operacao/OperacaoCaixaPage';
import { OperacaoContasPendentesPage } from './pages/operacao/OperacaoContasPendentesPage';
import { OperacaoNovaComandaPage } from './pages/operacao/OperacaoNovaComandaPage';
import { OperacaoVendaAvulsaPage } from './pages/operacao/OperacaoVendaAvulsaPage';
import { OperacaoComandaDetailPage } from './pages/operacao/OperacaoComandaDetailPage';
import { OperacaoCatalogoPage } from './pages/operacao/OperacaoCatalogoPage';
import { OperacaoAgendaPage } from './pages/operacao/OperacaoAgendaPage';
import { OperacaoCozinhaPage } from './pages/operacao/OperacaoCozinhaPage';
import { OperacaoCozinhaTvPage } from './pages/operacao/OperacaoCozinhaTvPage';
import { OperacaoCozinhaTvDemoPage } from './pages/operacao/OperacaoCozinhaTvDemoPage';
import { OperacaoEstoquePage } from './pages/operacao/OperacaoEstoquePage';
import { OperacaoDashboardPage } from './pages/operacao/OperacaoDashboardPage';
import { OperacaoTurnoResumoPage } from './pages/operacao/OperacaoTurnoResumoPage';
import { OperacaoConfiguracoesPage } from './pages/operacao/OperacaoConfiguracoesPage';
import { useOperacaoContexto } from './hooks/useOperacaoContexto';
import { AdminConfiguracoesPage } from './pages/AdminConfiguracoesPage';
import { SelecionarTrailerPage } from './pages/SelecionarTrailerPage';
import { EventoPage } from './pages/EventoPage';
import { ComandasPage } from './pages/ComandasPage';
import { EventoContasPendentesPage } from './pages/EventoContasPendentesPage';
import { ComandaDetailPage } from './pages/ComandaDetailPage';
import { NovaComandaPage } from './pages/NovaComandaPage';
import { VendaAvulsaPage } from './pages/VendaAvulsaPage';
import { RankingPage } from './pages/RankingPage';
import { RankingPdvPage } from './pages/RankingPdvPage';
import { RankingPeriodoPage } from './pages/RankingPeriodoPage';
import { RankingSeriePage } from './pages/RankingSeriePage';
import { RankingFullscreenPage } from './pages/RankingFullscreenPage';
import { RankingSerieFullscreenPage } from './pages/RankingSerieFullscreenPage';
import { RankingPeriodoFullscreenPage } from './pages/RankingPeriodoFullscreenPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResumoExecutivoPage } from './pages/ResumoExecutivoPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { ClientesPage } from './pages/ClientesPage';
import { NovoClientePage } from './pages/NovoClientePage';
import { ClienteDetailPage } from './pages/ClienteDetailPage';
import { CadastroLinkDescontinuadoPage } from './pages/CadastroLinkDescontinuadoPage';
import { PortalEventoRedirectPage } from './pages/PortalEventoRedirectPage';
import { PortalPdvPage } from './pages/PortalPdvPage';
import { Layout } from './components/Layout';
import { AdminLayout } from './components/AdminLayout';
import { InstallAppBanner } from './components/InstallAppBanner';
import { Loading } from './components/Loading';
import { ensureAppShellBranding } from './lib/app-branding';
import { resetBreweryTheme } from './lib/theme';
import { AuditTracker } from './components/AuditTracker';
import { AuditErrorBoundary } from './components/AuditErrorBoundary';
import { OnboardingProvider } from './contexts/OnboardingContext';
import { OnboardingSurface } from './components/OnboardingSurface';
import { OnboardingChecklist } from './components/OnboardingChecklist';
import { OperationalSetupWizard } from './components/OperationalSetupWizard';
import { getOperacaoEntryPath, getTenantCashEntryPath, type OperacaoEntryAccess } from './lib/tenant-entry';
import { OperacaoSemAcessoPage } from './pages/operacao/OperacaoSemAcessoPage';

function RootLayout() {
  const { pathname } = useLocation();
  const hideInstallBanner =
    pathname.startsWith('/ranking/tv') ||
    pathname.startsWith('/operacao/cozinha/tv') ||
    pathname.startsWith('/c/');

  return (
    <AuditErrorBoundary>
      {!hideInstallBanner && <InstallAppBanner />}
      <AuditTracker />
      <Outlet />
    </AuditErrorBoundary>
  );
}

function PublicAuthShell() {
  useEffect(() => {
    resetBreweryTheme();
    ensureAppShellBranding();

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute('content', '#040a12');
    document.body.classList.add('auth-screen');

    return () => {
      document.body.classList.remove('auth-screen');
      restoreAppThemeFromStorage();
    };
  }, []);

  return <Outlet />;
}

function useOperacaoEntry() {
  const { canPermission, isLoading: authLoading } = useAuth();
  const { contexto, isLoading: operacaoLoading } = useOperacaoContexto();
  const access: OperacaoEntryAccess = {
    can: canPermission,
    kitchenEnabled: contexto.ativo && contexto.temCozinha,
    inventoryEnabled: contexto.ativo && contexto.controlaEstoque,
  };
  return {
    isLoading: authLoading || operacaoLoading,
    entryPath: getOperacaoEntryPath(access),
    cashEntryPath: getTenantCashEntryPath(contexto.operationMode, contexto.pontosVenda.length, access),
  };
}

function TenantEntryRedirect() {
  const { needsTrailerSelection, evento, isLoading } = useEvento();
  const { cashEntryPath, isLoading: entryLoading } = useOperacaoEntry();
  if (isLoading || entryLoading) return <Loading fullScreen />;
  if (cashEntryPath) return <Navigate to={cashEntryPath} replace />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
  if (evento?.status === 'ABERTO') return <Navigate to="/comandas" replace />;
  return <Navigate to="/eventos" replace />;
}

function OperacaoEntryRedirect() {
  const { entryPath, isLoading } = useOperacaoEntry();
  if (isLoading) return <Loading fullScreen />;
  return <Navigate to={entryPath} replace />;
}

/** Evita que um PWA restaurado em /eventos ignore o modo CAIXA da empresa. */
function RequireEventoMode() {
  const { cashEntryPath, isLoading } = useOperacaoEntry();
  if (isLoading) return <Loading fullScreen />;
  if (cashEntryPath) return <Navigate to={cashEntryPath} replace />;
  return <Outlet />;
}

function PublicOnly() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (isAuthenticated) return <Navigate to={isAdmin ? '/admin/cervejarias' : '/'} replace />;
  return <Outlet />;
}

function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAdmin) return <Navigate to="/eventos" replace />;
  return <Outlet />;
}

function RequireTenant() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  return <Outlet />;
}

function RequireModuloOperacao() {
  const { contexto, isLoading, isResolved } = useOperacaoContexto();
  const { pathname } = useLocation();
  if (isLoading) return <Loading fullScreen />;
  if (!isResolved) return <div className="alert-error" role="alert">Não foi possível validar o contexto do PDV.</div>;
  // O catálogo também atende eventos sem ponto de venda operacional ativo.
  const catalogoEvento = contexto.operationMode === 'EVENTO' && pathname === '/operacao/catalogo';
  if (!contexto.ativo && !catalogoEvento) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Telas de caixa/turno são exclusivas do modo CAIXA; EVENTO volta ao fluxo de eventos. */
function RequireCaixaMode() {
  const { contexto, isLoading } = useOperacaoContexto();
  if (isLoading) return <Loading fullScreen />;
  if (contexto.operationMode === 'EVENTO') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Operacao sem cozinha nao tem fila: a tela nao existe nem por URL direta. */
function RequireCozinhaOperacao() {
  const { contexto, isLoading } = useOperacaoContexto();
  const { entryPath, isLoading: entryLoading } = useOperacaoEntry();
  if (isLoading || entryLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to={entryPath} replace />;
  return <Outlet />;
}

function RequireEstoqueOperacao() {
  const { contexto, isLoading } = useOperacaoContexto();
  const { entryPath, isLoading: entryLoading } = useOperacaoEntry();
  if (isLoading || entryLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.controlaEstoque) return <Navigate to={entryPath} replace />;
  return <Outlet />;
}

function RequireModuloCervejaria() {
  return <Outlet />;
}

function RequireDono() {
  const { isDono, isLoading, hasPermission } = useAuth();
  const location = useLocation();
  if (isLoading) return <Loading fullScreen />;
  const allowed = isDono || (location.pathname === '/dashboard' && hasPermission('dashboard.read'))
    || (/^\/eventos\/[^/]+\/resumo$/.test(location.pathname) && hasPermission('reports.read'));
  if (!allowed) return <Navigate to="/comandas" replace />;
  return <Outlet />;
}

/** Without an explicit fallback, a denied user goes to the first operational screen they can use. */
function RequirePermissionRoute({ permission, fallback }: { permission: string; fallback?: string }) {
  const { isLoading, canPermission } = useAuth();
  const { entryPath, isLoading: entryLoading } = useOperacaoEntry();
  if (isLoading || (!fallback && entryLoading)) return <Loading fullScreen />;
  if (!canPermission(permission)) return <Navigate to={fallback ?? entryPath} replace />;
  return <Outlet />;
}

function RequireDonoOperacao() {
  const { isDono, isLoading, hasPermission } = useAuth();
  const { entryPath, isLoading: entryLoading } = useOperacaoEntry();
  const location = useLocation();
  if (isLoading || entryLoading) return <Loading fullScreen />;
  if (!isDono && !(location.pathname === '/operacao/dashboard' && hasPermission('dashboard.read'))) return <Navigate to={entryPath} replace />;
  return <Outlet />;
}

function RequireTrailerContext() {
  const { needsTrailerSelection, isLoading } = useEvento();
  if (isLoading) return <Loading fullScreen />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
  return <Outlet />;
}

function TenantShell() {
  return (
    <OnboardingProvider>
      <EventoProvider>
        <Layout />
      </EventoProvider>
      <OnboardingSurface />
      <OnboardingChecklist />
      <OperationalSetupWizard />
    </OnboardingProvider>
  );
}

function CatchAll() {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? '/admin/cervejarias' : '/'} replace />;
}

function RankingTvShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;

  if (isDemo) {
    return <div className="qt-tv">{children}</div>;
  }

  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;

  return (
    <div className="qt-tv">
      <EventoProvider>{children}</EventoProvider>
    </div>
  );
}

function RankingTvEntry() {
  return (
    <RankingTvShell>
      <RankingFullscreenPage />
    </RankingTvShell>
  );
}

function RankingSerieTvEntry() {
  return (
    <RankingTvShell>
      <RankingSerieFullscreenPage />
    </RankingTvShell>
  );
}

function RankingPeriodoTvEntry() {
  return (
    <RankingTvShell>
      <RankingPeriodoFullscreenPage />
    </RankingTvShell>
  );
}

function RankingPdvRedirectToTv() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/operacao/ranking/tv', search: location.search }} replace />;
}

function RankingPdvTvEntry() {
  const { isAuthenticated, isLoading: authLoading, isAdmin, canPermission } = useAuth();
  const { contexto, isLoading: operationLoading, isResolved } = useOperacaoContexto();
  if (authLoading || operationLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  if (!canPermission('command.read')) return <Navigate to="/operacao/comandas" replace />;
  if (!isResolved || !contexto.ativo || contexto.operationMode !== 'CAIXA' || !contexto.tapsEnabled) {
    return <Navigate to="/operacao/comandas" replace />;
  }
  return <div className="qt-tv"><RankingPdvPage tv /></div>;
}

function CozinhaTvShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isAdmin, canPermission } = useAuth();
  const { contexto, isLoading: qLoading } = useOperacaoContexto();

  if (isLoading || qLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to="/operacao/comandas" replace />;
  if (!canPermission('kitchen.read')) return <Navigate to="/operacao/caixa" replace />;

  return <div className="qt-tv qt-cozinha-tv">{children}</div>;
}

function CozinhaTvEntry() {
  const [searchParams] = useSearchParams();
  const maxColunasParam = Number.parseInt(searchParams.get('maxColunas') ?? '', 10);
  const maxColunas = Number.isFinite(maxColunasParam) && maxColunasParam > 0 ? maxColunasParam : undefined;
  // maxColunas na demo implica layout tablet no PC (senão o teto não entra no grid).
  const forceTabletLayout = searchParams.get('tablet') === '1' || maxColunas !== undefined;
  const pedidosParam = Number.parseInt(searchParams.get('pedidos') ?? '', 10);
  const pedidoCount = Number.isFinite(pedidosParam) && pedidosParam > 0 ? pedidosParam : undefined;

  if (searchParams.get('demo') === '1') {
    return (
      <div className="qt-tv qt-cozinha-tv">
        <OperacaoCozinhaTvDemoPage
          tabletFixture={forceTabletLayout}
          pedidoCount={pedidoCount}
          maxColunas={maxColunas}
        />
      </div>
    );
  }

  return (
    <CozinhaTvShell>
      <OperacaoCozinhaTvPage forceTabletLayout={forceTabletLayout} />
    </CozinhaTvShell>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/ranking/tv/serie/:serieId', element: <RankingSerieTvEntry /> },
      { path: '/ranking/tv/periodo/:eventoId', element: <RankingPeriodoTvEntry /> },
      { path: '/ranking/tv/:eventoId', element: <RankingTvEntry /> },
      { path: '/operacao/cozinha/tv', element: <CozinhaTvEntry /> },
      { path: '/c/:slug/cadastro', element: <CadastroLinkDescontinuadoPage /> },
      { path: '/c/:slug/t/:trailerId', element: <PortalEventoRedirectPage /> },
      { path: '/c/:slug/p/:pontoVendaId', element: <PortalPdvPage /> },
      {
        element: <PublicOnly />,
        children: [
          {
            element: <PublicAuthShell />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
              { path: '/reset-password', element: <ResetPasswordPage /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireAdmin />,
            children: [
              {
                path: '/admin/cervejarias',
                element: (
                  <AdminLayout>
                    <AdminCervejariasPage />
                  </AdminLayout>
                ),
              },
              {
                path: '/admin/configuracoes',
                element: (
                  <AdminLayout>
                    <AdminConfiguracoesPage />
                  </AdminLayout>
                ),
              },
              { path: '/admin/*', element: <Navigate to="/admin/cervejarias" replace /> },
            ],
          },
          {
            element: <RequireTenant />,
            children: [
          { path: '/operacao/ranking/tv', element: <RankingPdvTvEntry /> },
              {
                path: '/',
                element: <TenantShell />,
                children: [
                  { index: true, element: <TenantEntryRedirect /> },
                  {
                    element: <RequireModuloOperacao />,
                    children: [
                      {
                        path: 'operacao',
                        element: <OperacaoLayout />,
                        children: [
                          { index: true, element: <OperacaoEntryRedirect /> },
                          { path: 'sem-acesso', element: <OperacaoSemAcessoPage /> },
                          {
                            element: <RequireCaixaMode />,
                            children: [
                              { path: 'comandas', element: <RequirePermissionRoute permission="command.read" />, children: [{ index: true, element: <OperacaoComandasPage /> }] },
                              { path: 'contas-pendentes', element: <RequirePermissionRoute permission="debt.receive" />, children: [{ index: true, element: <OperacaoContasPendentesPage /> }] },
                              { path: 'comandas/nova', element: <RequirePermissionRoute permission="command.operate" />, children: [{ index: true, element: <OperacaoNovaComandaPage /> }] },
                              { path: 'comandas/venda-avulsa', element: <RequirePermissionRoute permission="command.operate" />, children: [{ index: true, element: <OperacaoVendaAvulsaPage /> }] },
                              { path: 'comandas/:id', element: <RequirePermissionRoute permission="command.read" />, children: [{ index: true, element: <OperacaoComandaDetailPage /> }] },
                              {
                                path: 'ranking',
                                element: <RequirePermissionRoute permission="command.read" />,
                                children: [{ index: true, element: <RankingPdvRedirectToTv /> }],
                              },
                              { path: 'caixa', element: <OperacaoCaixaPage /> },
                            ],
                          },
                          {
                            element: <RequireEstoqueOperacao />,
                            children: [{ path: 'estoque', element: <RequirePermissionRoute permission="inventory.read" />, children: [{ index: true, element: <OperacaoEstoquePage /> }] }],
                          },
                          {
                            element: <RequireCozinhaOperacao />,
                            children: [{ path: 'cozinha', element: <RequirePermissionRoute permission="kitchen.read" />, children: [{ index: true, element: <OperacaoCozinhaPage /> }] }],
                          },
                          { path: 'catalogo', element: <RequirePermissionRoute permission="catalog.manage" />, children: [{ index: true, element: <OperacaoCatalogoPage /> }] },
                          { path: 'agenda', element: <RequirePermissionRoute permission="agenda.manage" />, children: [{ index: true, element: <OperacaoAgendaPage /> }] },
                          {
                            element: <RequireDonoOperacao />,
                            children: [
                              { path: 'dashboard', element: <OperacaoDashboardPage /> },
                              {
                                element: <RequireCaixaMode />,
                                children: [{ path: 'turnos/:sessaoId', element: <OperacaoTurnoResumoPage /> }],
                              },
                              { path: 'configuracoes', element: <Navigate to="/operacao/configuracoes/equipe" replace /> },
                              { path: 'configuracoes/:tab', element: <OperacaoConfiguracoesPage /> },
                              { path: 'equipe', element: <Navigate to="/operacao/configuracoes/equipe" replace /> },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    element: <RequireModuloCervejaria />,
                    children: [
                      { path: 'trailer', element: <SelecionarTrailerPage /> },
                      {
                        element: <RequireEventoMode />,
                        children: [
                          { path: 'eventos', element: <EventoPage /> },
                          { path: 'eventos/:eventoId/contas-pendentes', element: <EventoContasPendentesPage /> },
                        ],
                      },
                      { path: 'ranking/serie/:serieId', element: <RankingSeriePage /> },
                      { path: 'ranking/periodo/:eventoId', element: <RankingPeriodoPage /> },
                      { path: 'clientes', element: <RequirePermissionRoute permission="clients.manage" fallback="/eventos" />, children: [{ index: true, element: <ClientesPage /> }] },
                      { path: 'clientes/novo', element: <RequirePermissionRoute permission="clients.manage" fallback="/eventos" />, children: [{ index: true, element: <NovoClientePage /> }] },
                      { path: 'clientes/:id', element: <RequirePermissionRoute permission="clients.manage" fallback="/eventos" />, children: [{ index: true, element: <ClienteDetailPage /> }] },
                      {
                        element: <RequireEventoMode />,
                        children: [
                          {
                            element: <RequireTrailerContext />,
                            children: [
                      { path: 'comandas', element: <RequirePermissionRoute permission="command.read" fallback="/eventos" />, children: [{ index: true, element: <ComandasPage /> }] },
                              { path: 'comandas/nova', element: <RequirePermissionRoute permission="command.operate" fallback="/eventos" />, children: [{ index: true, element: <NovaComandaPage /> }] },
                              { path: 'comandas/venda-avulsa', element: <RequirePermissionRoute permission="command.operate" fallback="/eventos" />, children: [{ index: true, element: <VendaAvulsaPage /> }] },
                              { path: 'comandas/:id', element: <RequirePermissionRoute permission="command.read" fallback="/eventos" />, children: [{ index: true, element: <ComandaDetailPage /> }] },
                              { path: 'ranking/:eventoId?', element: <RankingPage /> },
                            ],
                          },
                        ],
                      },
                      {
                        element: <RequireDono />,
                        children: [
                          { path: 'dashboard', element: <DashboardPage /> },
                          { path: 'eventos/:eventoId/resumo', element: <ResumoExecutivoPage /> },
                          { path: 'configuracoes', element: <Navigate to="/configuracoes/equipe" replace /> },
                          { path: 'configuracoes/:tab', element: <ConfiguracoesPage /> },
                          { path: 'catalogo', element: <Navigate to="/operacao/catalogo" replace /> },
                          { path: 'funcionarios', element: <Navigate to="/configuracoes/equipe" replace /> },
                          { path: 'aparencia', element: <Navigate to="/configuracoes/aparencia" replace /> },
                          { path: 'relatorios', element: <Navigate to="/dashboard" replace /> },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <CatchAll /> },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}
