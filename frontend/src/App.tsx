import { createBrowserRouter, RouterProvider, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, restoreAppThemeFromStorage } from './contexts/ThemeContext';
import { EventoProvider, useEvento } from './contexts/EventoContext';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AdminCervejariasPage } from './pages/AdminCervejariasPage';
import { QuiosqueLayout } from './pages/quiosque/QuiosqueLayout';
import { QuiosqueComandasPage } from './pages/quiosque/QuiosqueComandasPage';
import { QuiosqueNovaComandaPage } from './pages/quiosque/QuiosqueNovaComandaPage';
import { QuiosqueVendaAvulsaPage } from './pages/quiosque/QuiosqueVendaAvulsaPage';
import { QuiosqueComandaDetailPage } from './pages/quiosque/QuiosqueComandaDetailPage';
import { QuiosqueCatalogoPage } from './pages/quiosque/QuiosqueCatalogoPage';
import { QuiosqueCozinhaPage } from './pages/quiosque/QuiosqueCozinhaPage';
import { QuiosqueCozinhaTvPage } from './pages/quiosque/QuiosqueCozinhaTvPage';
import { QuiosqueCaixaPage } from './pages/quiosque/QuiosqueCaixaPage';
import { QuiosqueEstoquePage } from './pages/quiosque/QuiosqueEstoquePage';
import { QuiosqueDashboardPage } from './pages/quiosque/QuiosqueDashboardPage';
import { QuiosqueTurnoResumoPage } from './pages/quiosque/QuiosqueTurnoResumoPage';
import { QuiosqueConfiguracoesPage } from './pages/quiosque/QuiosqueConfiguracoesPage';
import { useQuiosqueContexto } from './hooks/useQuiosqueContexto';
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
import { ClienteDetailPage } from './pages/ClienteDetailPage';
import { CadastroLinkDescontinuadoPage } from './pages/CadastroLinkDescontinuadoPage';
import { PortalClientePage } from './pages/PortalClientePage';
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
    pathname.startsWith('/quiosque/cozinha/tv') ||
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
  const { contexto: quiosque, isLoading: quiosqueLoading } = useQuiosqueContexto();
  if (isLoading || quiosqueLoading) return <Loading fullScreen />;
  // Empresa so de quiosque nao tem trailer nem evento para escolher.
  if (quiosque.ativo && quiosque.exclusivo) return <Navigate to="/quiosque/comandas" replace />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
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

function RequireModuloQuiosque() {
  const { contexto, isLoading } = useQuiosqueContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Quiosque sem cozinha nao tem fila: a tela nao existe nem por URL direta. */
function RequireCozinhaQuiosque() {
  const { contexto, isLoading } = useQuiosqueContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to="/quiosque/comandas" replace />;
  return <Outlet />;
}

function RequireEstoqueQuiosque() {
  const { contexto, isLoading } = useQuiosqueContexto();
  if (isLoading) return <Loading fullScreen />;
  if (!contexto.ativo || !contexto.controlaEstoque) return <Navigate to="/quiosque/comandas" replace />;
  return <Outlet />;
}

function RequireModuloCervejaria() {
  const { contexto, isLoading } = useQuiosqueContexto();
  if (isLoading) return <Loading fullScreen />;
  if (contexto.ativo && contexto.exclusivo) return <Navigate to="/quiosque/comandas" replace />;
  return <Outlet />;
}

function RequireDono() {
  const { isDono, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isDono) return <Navigate to="/comandas" replace />;
  return <Outlet />;
}

function RequireDonoQuiosque() {
  const { isDono, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isDono) return <Navigate to="/quiosque/comandas" replace />;
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
  const { contexto, isLoading: qLoading } = useQuiosqueContexto();

  if (isLoading || qLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  if (!contexto.ativo || !contexto.temCozinha) return <Navigate to="/quiosque/comandas" replace />;

  return <div className="qt-tv qt-cozinha-tv">{children}</div>;
}

function CozinhaTvEntry() {
  return (
    <CozinhaTvShell>
      <QuiosqueCozinhaTvPage />
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
      { path: '/quiosque/cozinha/tv', element: <CozinhaTvEntry /> },
      { path: '/c/:slug/cadastro', element: <CadastroLinkDescontinuadoPage /> },
      { path: '/c/:slug/t/:trailerId', element: <PortalClientePage /> },
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
                    element: <RequireModuloQuiosque />,
                    children: [
                      {
                        path: 'quiosque',
                        element: <QuiosqueLayout />,
                        children: [
                          { index: true, element: <Navigate to="comandas" replace /> },
                          { path: 'comandas', element: <QuiosqueComandasPage /> },
                          { path: 'comandas/nova', element: <QuiosqueNovaComandaPage /> },
                          { path: 'comandas/venda-avulsa', element: <QuiosqueVendaAvulsaPage /> },
                          { path: 'comandas/:id', element: <QuiosqueComandaDetailPage /> },
                          { path: 'caixa', element: <QuiosqueCaixaPage /> },
                          {
                            element: <RequireEstoqueQuiosque />,
                            children: [{ path: 'estoque', element: <QuiosqueEstoquePage /> }],
                          },
                          {
                            element: <RequireCozinhaQuiosque />,
                            children: [{ path: 'cozinha', element: <QuiosqueCozinhaPage /> }],
                          },
                          { path: 'catalogo', element: <QuiosqueCatalogoPage /> },
                          {
                            element: <RequireDonoQuiosque />,
                            children: [
                              { path: 'dashboard', element: <QuiosqueDashboardPage /> },
                              { path: 'turnos/:sessaoId', element: <QuiosqueTurnoResumoPage /> },
                              { path: 'configuracoes', element: <Navigate to="/quiosque/configuracoes/equipe" replace /> },
                              { path: 'configuracoes/:tab', element: <QuiosqueConfiguracoesPage /> },
                              { path: 'equipe', element: <Navigate to="/quiosque/configuracoes/equipe" replace /> },
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
