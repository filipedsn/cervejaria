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
import { OperacaoContasPendentesPage } from './pages/operacao/OperacaoContasPendentesPage';
import { OperacaoNovaComandaPage } from './pages/operacao/OperacaoNovaComandaPage';
import { OperacaoVendaAvulsaPage } from './pages/operacao/OperacaoVendaAvulsaPage';
import { OperacaoComandaDetailPage } from './pages/operacao/OperacaoComandaDetailPage';
import { OperacaoCatalogoPage } from './pages/operacao/OperacaoCatalogoPage';
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
import { ComandaDetailPage } from './pages/ComandaDetailPage';
import { NovaComandaPage } from './pages/NovaComandaPage';
import { VendaAvulsaPage } from './pages/VendaAvulsaPage';
import { RankingPage } from './pages/RankingPage';
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
import { PortalClientePage } from './pages/PortalClientePage';
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

function TenantEntryRedirect() {
  const { needsTrailerSelection, evento, isLoading } = useEvento();
  const { contexto, isLoading: operacaoLoading } = useOperacaoContexto();
  if (isLoading || operacaoLoading) return <Loading fullScreen />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
  if (contexto.operationMode === 'CAIXA') return <Navigate to="/operacao/comandas" replace />;
  if (evento?.status === 'ABERTO') return <Navigate to="/comandas" replace />;
  return <Navigate to="/eventos" replace />;
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
  const { contexto, isLoading } = useOperacaoContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Operacao sem cozinha nao tem fila: a tela nao existe nem por URL direta. */
function RequireCozinhaOperacao() {
  const { contexto, isLoading } = useOperacaoContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to="/operacao/comandas" replace />;
  return <Outlet />;
}

function RequireEstoqueOperacao() {
  const { contexto, isLoading } = useOperacaoContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.controlaEstoque) return <Navigate to="/operacao/comandas" replace />;
  return <Outlet />;
}

function RequireModuloCervejaria() {
  return <Outlet />;
}

function RequireDono() {
  const { isDono, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isDono) return <Navigate to="/comandas" replace />;
  return <Outlet />;
}

function RequireDonoOperacao() {
  const { isDono, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isDono) return <Navigate to="/operacao/comandas" replace />;
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

function CozinhaTvShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const { contexto, isLoading: qLoading } = useOperacaoContexto();

  if (isLoading || qLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to="/operacao/comandas" replace />;

  return <div className="qt-tv qt-cozinha-tv">{children}</div>;
}

function CozinhaTvEntry() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('demo') === '1') {
    return <div className="qt-tv qt-cozinha-tv"><OperacaoCozinhaTvDemoPage /></div>;
  }

  return (
    <CozinhaTvShell>
      <OperacaoCozinhaTvPage />
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
      { path: '/c/:slug/t/:trailerId', element: <PortalClientePage /> },
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
                          { index: true, element: <Navigate to="comandas" replace /> },
                          { path: 'comandas', element: <OperacaoComandasPage /> },
                          { path: 'contas-pendentes', element: <OperacaoContasPendentesPage /> },
                          { path: 'comandas/nova', element: <OperacaoNovaComandaPage /> },
                          { path: 'comandas/venda-avulsa', element: <OperacaoVendaAvulsaPage /> },
                          { path: 'comandas/:id', element: <OperacaoComandaDetailPage /> },
                          { path: 'caixa', element: <Navigate to="/operacao/comandas" replace /> },
                          {
                            element: <RequireEstoqueOperacao />,
                            children: [{ path: 'estoque', element: <OperacaoEstoquePage /> }],
                          },
                          {
                            element: <RequireCozinhaOperacao />,
                            children: [{ path: 'cozinha', element: <OperacaoCozinhaPage /> }],
                          },
                          { path: 'catalogo', element: <OperacaoCatalogoPage /> },
                          {
                            element: <RequireDonoOperacao />,
                            children: [
                              { path: 'dashboard', element: <OperacaoDashboardPage /> },
                              { path: 'turnos/:sessaoId', element: <OperacaoTurnoResumoPage /> },
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
                      { path: 'eventos', element: <EventoPage /> },
                      { path: 'ranking/serie/:serieId', element: <RankingSeriePage /> },
                      { path: 'ranking/periodo/:eventoId', element: <RankingPeriodoPage /> },
                      { path: 'clientes', element: <ClientesPage /> },
                      { path: 'clientes/novo', element: <NovoClientePage /> },
                      { path: 'clientes/:id', element: <ClienteDetailPage /> },
                      {
                        element: <RequireTrailerContext />,
                        children: [
                          { path: 'comandas', element: <ComandasPage /> },
                          { path: 'comandas/nova', element: <NovaComandaPage /> },
                          { path: 'comandas/venda-avulsa', element: <VendaAvulsaPage /> },
                          { path: 'comandas/:id', element: <ComandaDetailPage /> },
                          { path: 'ranking/:eventoId?', element: <RankingPage /> },
                        ],
                      },
                      {
                        element: <RequireDono />,
                        children: [
                          { path: 'dashboard', element: <DashboardPage /> },
                          { path: 'eventos/:eventoId/resumo', element: <ResumoExecutivoPage /> },
                          { path: 'configuracoes', element: <Navigate to="/configuracoes/equipe" replace /> },
                          { path: 'configuracoes/:tab', element: <ConfiguracoesPage /> },
                          { path: 'catalogo', element: <Navigate to="/configuracoes/catalogo" replace /> },
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
